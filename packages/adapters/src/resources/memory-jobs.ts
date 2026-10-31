import { OpenAIProvider, type Model } from '@openai/agents';
import type { EngineInput, RuntimeConfig } from '../../../contracts/src/index.js';
import type { MemoryService } from '../../../core/src/memory.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import { AgentsMemoryExtractor } from './extraction.js';

export class MemoryJobs {
  private readonly controllers = new Set<AbortController>();
  constructor(private readonly store: RuntimeStore, private readonly memory: MemoryService, private readonly config: () => RuntimeConfig, private readonly secret: (key: string) => string | undefined, private readonly model?: Model) {}
  async extract(input: EngineInput, reply: string): Promise<void> {
    const policy = input.agent.memoryExtraction;
    if (!policy.enabled || !policy.libraryId || input.message.sessionType !== 'private' || !input.context.resources.memoryLibraries.includes(policy.libraryId) || !input.context.effectiveCapabilities.includes('memory.write')) return;
    const id = `memory:${input.context.runId}`;
    if (!this.store.claimEvent(id, 86_400_000)) return;
    const controller = new AbortController(); this.controllers.add(controller);
    const context = { ...input.context, signal: AbortSignal.any([input.context.signal, controller.signal, AbortSignal.timeout(20_000)]) };
    const started = Date.now();
    const record = (status: 'running' | 'completed' | 'failed' | 'cancelled', summary: string): void => this.store.put('jobs', id, { id, kind: 'memory_extraction', runId: input.context.runId, status, createdAt: started, updatedAt: Date.now(), summary });
    record('running', 'Extracting private sender memories');
    let provider: OpenAIProvider | undefined;
    try {
      const connection = this.config().connections.find(item => item.id === input.agent.connectionId);
      if (!connection) throw new Error('Extraction model connection unavailable');
      if (!this.model) { const apiKey = this.secret(connection.apiKeyEnv); if (!apiKey) throw new Error('Extraction credential unavailable'); provider = new OpenAIProvider({ apiKey, ...(connection.baseUrl ? { baseURL: connection.baseUrl } : {}), useResponses: connection.protocol === 'responses', strictFeatureValidation: true }); }
      const extractor = new AgentsMemoryExtractor({ model: this.model ?? input.agent.model, ...(provider ? { modelProvider: provider } : {}), principal: context.principal, protocol: connection.protocol });
      const text = input.message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const records = await this.memory.extract(context, input.agent, policy.libraryId, `turn:${context.runId}`, `Current sender: ${text}\nAssistant: ${reply.slice(0, 4000)}`, extractor);
      this.memory.consolidate(context, input.agent, policy.libraryId, 100);
      record('completed', `Saved ${records.length} private memories`);
    } catch { record(context.signal.aborted ? 'cancelled' : 'failed', 'Extraction did not complete; no broader scope was granted'); }
    finally { this.controllers.delete(controller); await provider?.close(); }
  }
  stop(): void { for (const controller of this.controllers) controller.abort(new Error('Runtime stopping')); }
}
