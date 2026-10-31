import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Model, ModelResponse, protocol } from '@openai/agents';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { MessageEventSchema, type ReplyPlan } from '../packages/contracts/src/index.js';
import type { PlatformAdapter } from '../packages/adapters/src/platforms/types.js';

class FailingModel implements Model {
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('upstream private response')); }
  getStreamedResponse(): AsyncIterable<protocol.StreamEvent> { return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('upstream private response')) }) }; }
}
void test('bound persona custom error reaches IM on model failure without exposing provider diagnostics', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:', config: defaultConfiguration(), model: new FailingModel() });
  const replies: ReplyPlan[] = [];
  const adapter: PlatformAdapter = { id: 'test', capabilities: { edit: false, images: false, files: false, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: (_target, reply) => { replies.push(reply); return Promise.resolve({ status: 'confirmed', messageIds: ['reply'] }); }, edit: () => Promise.reject(new Error('Unused')), downloadMedia: () => Promise.reject(new Error('Unused')) };
  try {
    const persona = runtime.management.savePersona({ name: 'Friendly', instructions: '', customErrorMessage: '稍等一下，我稍后再试。' });
    runtime.management.bindPersona('assistant', persona.id, 0);
    const run = runtime.submit(MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'private', sessionType: 'private', senderId: 'user', messageId: 'request', timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text: 'hello' }] }), adapter);
    await runtime.idle();
    assert.equal(runtime.detail(run.id).run.status, 'failed');
    assert.deepEqual(replies, [{ parts: [{ type: 'text', text: '稍等一下，我稍后再试。' }] }]);
    assert.doesNotMatch(JSON.stringify(runtime.detail(run.id)), /upstream private response/);
  } finally { await runtime.stop(); }
});
