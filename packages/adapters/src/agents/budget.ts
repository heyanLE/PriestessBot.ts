import { Usage, type Model, type ModelRequest, type ModelResponse, type protocol } from '@openai/agents';

export class RunBudgetError extends Error {
  override readonly name = 'RunBudgetError';
  constructor(readonly used: number, readonly limit: number) { super(`Run token budget exhausted (used ${used}, limit ${limit})`); }
}
/** Provider usage shape accepted by the SDK's Usage constructor. */
export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly requests?: number | undefined;
  readonly inputTokensDetails?: protocol.TokenDetails | protocol.TokenDetails[] | undefined;
  readonly outputTokensDetails?: protocol.TokenDetails | protocol.TokenDetails[] | undefined;
}
/**
 * Rebuild a Usage without dropping the provider's per-request details.
 * Cache-hit counters live in `input_tokens_details`.
 */
export function toBudgetUsage(usage: ProviderUsage): Usage {
  const base = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, requests: usage.requests ?? 1 };
  return new Usage({
    ...base,
    ...(usage.inputTokensDetails === undefined ? {} : { inputTokensDetails: usage.inputTokensDetails }),
    ...(usage.outputTokensDetails === undefined ? {} : { outputTokensDetails: usage.outputTokensDetails }),
  });
}
export interface BudgetedModelOptions {
  readonly mode?: 'cumulative' | 'context';
  /** Estimated next input plus tokens kept aside for a tool-free final answer. */
  readonly reserveTokens?: () => number;
  /** Called before any response containing tool calls can reach the SDK. */
  readonly onUsage?: (usage: Usage) => void;
}
/** Every provider response is accounted even when it exhausts the cumulative limit. */
export class BudgetedModel implements Model {
  private used = 0;
  constructor(private readonly model: Model, private readonly budget: number, private readonly externalUsage: () => number = () => 0, private readonly options: BudgetedModelOptions = {}) {}
  private request(request: ModelRequest): ModelRequest {
    request.signal?.throwIfAborted();
    if (this.options.mode === 'context') return request;
    const used = Math.max(this.used, this.externalUsage()); const remaining = this.budget - used - (this.options.reserveTokens?.() ?? 0);
    if (remaining <= 0) throw new RunBudgetError(used, this.budget);
    return { ...request, modelSettings: { ...request.modelSettings, maxTokens: Math.min(request.modelSettings.maxTokens ?? remaining, remaining) } };
  }
  private consume(usage: Usage): void {
    this.used = Math.max(this.used, this.externalUsage()) + usage.inputTokens + usage.outputTokens;
    this.options.onUsage?.(usage);
    // Gate before returning tool calls: exhausted responses cannot cause effects.
    if (this.options.mode !== 'context' && this.used >= this.budget) throw new RunBudgetError(this.used, this.budget);
  }
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.model.getResponse(this.request(request));
    this.consume(response.usage);
    return response;
  }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    for await (const event of this.model.getStreamedResponse(this.request(request))) {
      if (event.type === 'response_done') {
        // Details carry the provider's cache-hit counters; never drop them here.
        this.consume(toBudgetUsage(event.response.usage));
      }
      yield event;
    }
  }
}
