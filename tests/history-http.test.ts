import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { MessageEventSchema, RunDetailSchema } from '../packages/contracts/src/index.js';
import { ContinuedConversationSchema } from '../packages/contracts/src/management.js';
import { conversationKey } from '../packages/core/src/authorization.js';
class ContinuationModel implements Model {
  readonly requests: ModelRequest[] = [];
  getResponse(): Promise<ModelResponse> { throw new Error('Expected streaming'); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request); await Promise.resolve();
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `reply-${this.requests.length}`, usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 }, output: [{ role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: '继续对话。' }] }] } });
  }
}
void test('authenticated history continuation reaches SDK as scoped text without replay or duplicate history', async () => {
  const model = new ContinuationModel(); const runtime = new PriestessRuntime({ database: ':memory:', config: defaultConfiguration(), model }); const server = createRuntimeServer(runtime, { token: 'history-test', artifacts: '/tmp/priestess-history-test' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}/api/ts/`;
  async function post(path: string, value: unknown, auth = true): Promise<Response> { return fetch(base + path, { method: 'POST', headers: { ...(auth ? { Authorization: 'Bearer history-test' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); }
  try {
    const message = MessageEventSchema.parse({ platform: 'astrbotx:napcat', platformType: 'napcat', sessionId: 'archive-group', sessionType: 'group', senderId: 'old-user', messageId: 'imported-message', timestamp: 1, parts: [{ type: 'text', text: '历史唯一暗号 pinecone-42' }], botId: 'old-bot' });
    const captured = runtime.management.captureInbound(message, 'assistant', 0, 'archive-run', conversationKey(message, 'assistant')); if (!captured) throw new Error('No archive'); runtime.management.captureReply('archive-run', [{ type: 'text', text: '已记住这个暗号。' }]); const source = runtime.management.patchConversation(captured.id, { title: 'Archive', folderId: null, archived: true, expectedRevision: captured.revision });
    const action = { agentId: 'assistant', expectedRevision: source.revision, requestId: randomUUID() };
    assert.equal((await post(`conversations/${source.id}/continue`, action, false)).status, 401);
    const response = await post(`conversations/${source.id}/continue`, action); assert.equal(response.status, 201); const raw: unknown = await response.json(); const result = ContinuedConversationSchema.parse(raw);
    const again = await post(`conversations/${source.id}/continue`, action); assert.equal(again.status, 201); const repeated: unknown = await again.json(); assert.equal(ContinuedConversationSchema.parse(repeated).conversation.id, result.conversation.id);
    for (const text of ['历史暗号是什么？', '再说一次']) {
      const send = await post('chat', { conversationId: result.conversation.id, message: { ...message, messageId: randomUUID(), parts: [{ type: 'text', text }] } }); assert.equal(send.status, 202); const runRaw: unknown = await send.json(); const run = RunDetailSchema.parse(runRaw); await runtime.idle(); assert.equal(runtime.detail(run.run.id).run.status, 'completed', runtime.detail(run.run.id).run.summary);
    }
    assert.equal(model.requests.length, 2); const first = JSON.stringify(model.requests[0]?.input); assert.match(first, /pinecone-42/); assert.match(first, /old-user/); assert.match(first, /Imported historical message/); assert.equal((JSON.stringify(model.requests[1]?.input).match(/pinecone-42/g) ?? []).length, 1);
    const isolated = await post('chat', { message: { ...message, platform: 'dashboard', sessionId: 'separate', senderId: 'other-user', sessionType: 'private', messageId: randomUUID(), parts: [{ type: 'text', text: '普通新聊天' }] } }); assert.equal(isolated.status, 202); await runtime.idle(); assert.doesNotMatch(JSON.stringify(model.requests.at(-1)?.input), /pinecone-42/); assert.equal(runtime.management.detail(source.id).conversation.archived, true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await runtime.stop(); }
});
