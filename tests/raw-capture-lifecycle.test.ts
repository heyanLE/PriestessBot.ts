import assert from 'node:assert/strict';
import test from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AuditedModel } from '../packages/adapters/src/agents/model-audit.js';
import type { RawModelCaptureSink, RawModelCaptureWriter, RawModelPayloadMetadata } from '../packages/adapters/src/agents/raw-model-capture.js';

interface Captured { metadata: RawModelPayloadMetadata; text: string; state: 'writing' | 'complete' | 'failed'; }
class CaptureLifecycle implements RawModelCaptureSink {
  readonly values: Captured[] = [];
  open(metadata: RawModelPayloadMetadata): Promise<RawModelCaptureWriter> {
    const value: Captured = { metadata, text: '', state: 'writing' }; this.values.push(value);
    return Promise.resolve({ write: chunk => { value.text += chunk; return Promise.resolve(); }, close: () => { value.state = 'complete'; return Promise.resolve(); }, fail: () => { value.state = 'failed'; return Promise.resolve(); } });
  }
}
function request(): ModelRequest { return { systemInstructions: 'Fixture instructions', input: 'Fixture request', tools: [], handoffs: [], outputType: 'text', modelSettings: {}, tracing: false }; }
function observed(wrapped: Model, capture: RawModelCaptureSink): AuditedModel { return new AuditedModel(wrapped, { model: 'fixture', source: () => 'model', nextCall: () => 1, knownSecrets: [], emit: () => undefined, rawCapture: capture }); }
function unused(): Promise<ModelResponse> { return Promise.reject(new Error('Non-streaming operation is not used')); }

await test('synchronous model stream creation failure closes the already opened payload writer', async () => {
  const capture = new CaptureLifecycle();
  const wrapped: Model = { getResponse: unused, getStreamedResponse(): AsyncIterable<protocol.StreamEvent> { throw new Error('fixture stream creation failure'); } };
  await assert.rejects(async () => { for await (const event of observed(wrapped, capture).getStreamedResponse(request())) void event; }, /fixture stream creation failure/);
  const response = capture.values.find(value => value.metadata.kind === 'sdk_response'); assert.ok(response);
  assert.equal(response.state, 'failed');
  assert.equal(capture.values.filter(value => value.state === 'writing').length, 0);
});

await test('a throwing underlying iterator cleanup cannot leave raw capture pending', async () => {
  const capture = new CaptureLifecycle();
  const delta = protocol.StreamEvent.parse({ type: 'output_text_delta', delta: 'Partial output' });
  const iterator: AsyncIterableIterator<protocol.StreamEvent> = {
    next: () => Promise.resolve({ done: false, value: delta }),
    return: () => Promise.reject(new Error('fixture iterator cleanup failure')),
    [Symbol.asyncIterator]() { return this; },
  };
  const wrapped: Model = { getResponse: unused, getStreamedResponse: () => iterator };
  await assert.rejects(async () => { for await (const event of observed(wrapped, capture).getStreamedResponse(request())) { assert.equal(event.type, 'output_text_delta'); break; } }, /fixture iterator cleanup failure/);
  const response = capture.values.find(value => value.metadata.kind === 'sdk_response'); assert.ok(response);
  assert.equal(response.state, 'failed');
  assert.deepEqual(JSON.parse(response.text), { events: [delta], complete: false });
  assert.equal(capture.values.filter(value => value.state === 'writing').length, 0);
});

await test('capture open failure never prevents the custom model from yielding its response', async () => {
  const capture: RawModelCaptureSink = { open: () => Promise.reject(new Error('fixture storage unavailable')) };
  const delta = protocol.StreamEvent.parse({ type: 'output_text_delta', delta: 'Model output still arrives' });
  const wrapped: Model = { getResponse: unused, async *getStreamedResponse() { yield await Promise.resolve(delta); } };
  const events: protocol.StreamEvent[] = [];
  for await (const event of observed(wrapped, capture).getStreamedResponse(request())) events.push(event);
  assert.deepEqual(events, [delta]);
});

await test('SDK events after response_done remain in the complete captured stream', async () => {
  const capture = new CaptureLifecycle();
  const terminal = protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'response', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [] } });
  const tail = protocol.StreamEvent.parse({ type: 'model', event: { type: 'response.completed', sentinel: 'raw terminal event' } });
  const wrapped: Model = { getResponse: unused, async *getStreamedResponse() { yield await Promise.resolve(terminal); yield tail; } };
  const events: protocol.StreamEvent[] = [];
  for await (const event of observed(wrapped, capture).getStreamedResponse(request())) events.push(event);
  assert.deepEqual(events, [terminal, tail]);
  const response = capture.values.find(value => value.metadata.kind === 'sdk_response'); assert.ok(response);
  assert.equal(response.state, 'complete');
  assert.deepEqual(JSON.parse(response.text), { events, complete: true });
});

await test('a stream error after response_done marks the SDK event body incomplete', async () => {
  const capture = new CaptureLifecycle();
  const terminal = protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'response', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [] } });
  const wrapped: Model = { getResponse: unused, async *getStreamedResponse() { yield await Promise.resolve(terminal); throw new Error('fixture invalid trailing provider event'); } };
  await assert.rejects(async () => { for await (const event of observed(wrapped, capture).getStreamedResponse(request())) void event; }, /fixture invalid trailing provider event/);
  const response = capture.values.find(value => value.metadata.kind === 'sdk_response'); assert.ok(response);
  assert.equal(response.state, 'failed');
  assert.deepEqual(JSON.parse(response.text), { events: [terminal], complete: false });
});
