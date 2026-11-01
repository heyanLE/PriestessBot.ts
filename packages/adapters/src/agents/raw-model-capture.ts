import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import { OpenAIProvider } from '@openai/agents';

export type RawModelPayloadKind = 'sdk_request' | 'sdk_response' | 'provider_request' | 'provider_response';
export interface RawModelCaptureIdentity {
  readonly callId: string;
  readonly modelCall: number;
  readonly model: string;
  readonly source: 'model' | 'compression' | 'finalization';
}
export interface RawModelPayloadMetadata extends RawModelCaptureIdentity {
  readonly kind: RawModelPayloadKind;
  /** SDK snapshots use zero. HTTP attempts start at one and include SDK retries. */
  readonly attempt: number;
  readonly contentType: string;
  readonly httpStatus?: number;
}
export interface RawModelCaptureWriter {
  write(chunk: string): Promise<void>;
  close(): Promise<void>;
  fail(message: string): Promise<void>;
}
/** The caller binds the run identity and owns storage outside the model workspace. */
export interface RawModelCaptureSink { open(metadata: RawModelPayloadMetadata): Promise<RawModelCaptureWriter>; }
export interface RawModelCaptureScope { readonly sink: RawModelCaptureSink; readonly identity: RawModelCaptureIdentity; attempt: number; }
const scopes = new AsyncLocalStorage<RawModelCaptureScope>();

/** Preserve the transport even when diagnostic storage fails. */
class OptionalWriter {
  private enabled = true;
  private constructor(private readonly writer: RawModelCaptureWriter | undefined) {}
  static async open(scope: RawModelCaptureScope, kind: RawModelPayloadKind, attempt: number, contentType: string, httpStatus?: number): Promise<OptionalWriter> {
    try { return new OptionalWriter(await scope.sink.open({ ...scope.identity, kind, attempt, contentType, ...(httpStatus === undefined ? {} : { httpStatus }) })); }
    catch { return new OptionalWriter(undefined); }
  }
  async write(chunk: string): Promise<void> {
    if (!this.enabled || !this.writer || !chunk) return;
    try { await this.writer.write(chunk); }
    catch { await this.fail('The payload could not be written completely.'); }
  }
  async close(): Promise<void> {
    if (!this.enabled || !this.writer) return;
    try { await this.writer.close(); this.enabled = false; }
    catch { await this.fail('The payload could not be completed.'); }
  }
  async fail(message: string): Promise<void> {
    if (!this.enabled || !this.writer) return;
    this.enabled = false;
    try { await this.writer.fail(message); } catch { /* Capture failures must not replace the model result. */ }
  }
}

export function withRawModelCapture<T>(scope: RawModelCaptureScope | undefined, operation: () => T): T {
  return scope ? scopes.run(scope, operation) : operation();
}
export async function captureModelJson(scope: RawModelCaptureScope | undefined, kind: 'sdk_request' | 'sdk_response', value: unknown): Promise<void> {
  if (!scope) return;
  const writer = await OptionalWriter.open(scope, kind, 0, 'application/json');
  try { const body = JSON.stringify(value); if (body === undefined) throw new Error('Empty payload'); await writer.write(body); await writer.close(); }
  catch { await writer.fail('The SDK payload could not be serialized.'); }
}

export interface RawSdkStreamCapture { event(value: unknown): Promise<void>; finish(complete: boolean): Promise<void>; }
export async function openSdkStreamCapture(scope: RawModelCaptureScope | undefined): Promise<RawSdkStreamCapture | undefined> {
  if (!scope) return undefined;
  const writer = await OptionalWriter.open(scope, 'sdk_response', 0, 'application/json');
  await writer.write('{"events":['); let first = true; let finished = false;
  return {
    async event(value) { if (finished) return; try { await writer.write(`${first ? '' : ','}${JSON.stringify(value)}`); first = false; } catch { await writer.fail('The SDK stream event could not be serialized.'); } },
    async finish(complete) { if (finished) return; finished = true; await writer.write(`],"complete":${complete ? 'true' : 'false'}}`); if (complete) await writer.close(); else await writer.fail('The SDK stream ended before a complete response.'); },
  };
}

/** Capture provider bodies as decoded UTF-8 text. Authentication and other HTTP headers are never payload fields. */
export function createModelCaptureFetch(transport: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const scope = scopes.getStore();
    if (!scope) return transport(input, init);
    const attempt = ++scope.attempt;
    const requestWriter = await OptionalWriter.open(scope, 'provider_request', attempt, 'application/json');
    try {
      const body = init?.body;
      if (typeof body === 'string') await requestWriter.write(body);
      else if (body instanceof URLSearchParams) await requestWriter.write(body.toString());
      else if (body instanceof Uint8Array) await requestWriter.write(new TextDecoder().decode(body));
      else if (body instanceof ArrayBuffer) await requestWriter.write(new TextDecoder().decode(body));
      else if (input instanceof Request && body === undefined) await requestWriter.write(await input.clone().text());
      else if (body !== undefined && body !== null) throw new Error('Unsupported request body');
      await requestWriter.close();
    } catch { await requestWriter.fail('The outgoing request body could not be captured.'); }
    let response: Response;
    try { response = await transport(input, init); }
    catch (error) {
      const failure = await OptionalWriter.open(scope, 'provider_response', attempt, 'application/json');
      await failure.fail('The provider connection failed before a response body was received.');
      throw error;
    }
    const writer = await OptionalWriter.open(scope, 'provider_response', attempt, response.headers.get('content-type') ?? 'application/octet-stream', response.status);
    if (!response.body) { await writer.close(); return response; }
    const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { ignoreBOM: true }); let completed = false;
    // No clone/tee: the file writer applies bounded backpressure to the original
    // response, so an unconsumed branch cannot accumulate the full SSE stream.
    const captured = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { completed = true; await writer.write(decoder.decode()); await writer.close(); controller.close(); return; }
          await writer.write(decoder.decode(next.value, { stream: true }));
          controller.enqueue(next.value);
        } catch (error) { await writer.fail('The response body ended before completion.'); controller.error(error); }
      },
      async cancel(reason: unknown) {
        if (!completed) await writer.fail('The response body was not consumed completely.');
        await reader.cancel(reason);
      },
    });
    const wrapped = new Response(captured, { status: response.status, statusText: response.statusText, headers: response.headers });
    for (const key of ['url', 'redirected', 'type'] as const) Object.defineProperty(wrapped, key, { value: response[key] });
    return wrapped;
  };
}

export function capturedOpenAIProvider(options: { readonly apiKey: string; readonly baseURL?: string; readonly useResponses: boolean }): OpenAIProvider {
  const client = new OpenAI({ apiKey: options.apiKey, ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }), fetch: createModelCaptureFetch() });
  return new OpenAIProvider({ openAIClient: client, useResponses: options.useResponses, strictFeatureValidation: true });
}
