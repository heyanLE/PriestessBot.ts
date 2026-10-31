import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { z } from 'zod';
import { defaultConfiguration } from '../apps/server/src/runtime.js';
import { HistoryContinuationService } from '../packages/core/src/history-continuation.js';
import { ManagementService } from '../packages/core/src/management.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { AuthorizationService, conversationKey, historyKey } from '../packages/core/src/authorization.js';
import { AgentIdSchema, MessageEventSchema, RunIdSchema, type EngineInput, type RunContext } from '../packages/contracts/src/index.js';
import { type ContinuedConversation } from '../packages/contracts/src/management.js';
function fixture(database = ':memory:') {
  const store = new RuntimeStore(database); const config = defaultConfiguration(); const management = new ManagementService(store); const authorization = new AuthorizationService(config.grants, store); const service = new HistoryContinuationService(store, management, authorization, () => config);
  const message = MessageEventSchema.parse({ platform: 'qq-import', platformType: 'napcat', sessionId: 'old-group', sessionType: 'group', senderId: 'unknown-source-sender', senderName: '', messageId: 'history-1', timestamp: 1, parts: [{ type: 'text', text: '我叫小何。' }], botId: 'old-bot' });
  const captured = management.captureInbound(message, 'assistant', 0, 'old-run', conversationKey(message, 'assistant')); if (!captured) throw new Error('Missing conversation'); management.captureReply('old-run', [{ type: 'text', text: '记住了。历史工具描述 delete_file 属于过去的记录。' }]); const source = management.patchConversation(captured.id, { title: '旧群聊', folderId: null, archived: true, expectedRevision: captured.revision });
  const request = { agentId: 'assistant', expectedRevision: source.revision, requestId: randomUUID() };
  function input(result: ContinuedConversation, senderId = result.conversation.ownerId): EngineInput {
    const agent = config.agents[0]; if (!agent) throw new Error('Missing Agent');
    const principal = { platform: result.conversation.platform, sessionType: result.conversation.sessionType, sessionId: result.conversation.sessionId, senderId };
    const context: RunContext = { runId: RunIdSchema.parse(randomUUID()), turnId: 'turn', principal, agentId: AgentIdSchema.parse(agent.id), generation: 0, configRevision: config.revision, flowRevision: config.flow.revision, ...authorization.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
    return { context, agent, message: { ...message, ...principal }, additionalContext: '', session: { engine: 'agents_sdk', version: '1', id: historyKey(context) } };
  }
  return { store, config, management, authorization, service, source, request, input };
}
void test('archived mixed-sender history creates isolated Dashboard continuation with roles and source provenance', () => {
  const f = fixture();
  try { const before = f.management.detail(f.source.id); const result = f.service.create(f.source.id, f.request); assert.equal(result.importedEntries, 2); assert.equal(result.conversation.platform, 'dashboard'); assert.equal(result.conversation.ownerId, 'dashboard-user'); assert.notEqual(result.conversation.sessionId, f.source.sessionId); assert.deepEqual(f.management.detail(f.source.id), before); const input = f.input(result);
    assert.equal(f.service.consumeHistorySeed(input, items => { assert.deepEqual(items.map(i => i.role), ['user', 'assistant']); assert.match(items[0]?.text ?? '', /unknown-source-sender/); assert.match(items[0]?.text ?? '', /\/export/); assert.match(items[1]?.text ?? '', /no tool calls are replayed/); f.store.put('sdk-history', input.session.id, items); }), true);
    assert.equal(f.service.consumeHistorySeed(input, () => { throw new Error('Duplicate seed'); }), false);
    assert.equal(f.management.detail(result.conversation.id).entries.length, 2);
  } finally { f.store.close(); }
});
void test('seed requires exact principal, generation, runtime state and authorization version', () => {
  const f = fixture();
  try { const result = f.service.create(f.source.id, f.request); const input = f.input(result); let writes = 0; const apply = (): void => { writes++; };
    assert.throws(() => f.service.consumeHistorySeed(f.input(result, 'other-user'), apply), /different authorization scope/);
    assert.throws(() => f.service.consumeHistorySeed({ ...input, context: { ...input.context, generation: 1 } }, apply), /generation superseded/);
    assert.throws(() => f.service.consumeHistorySeed({ ...input, session: { ...input.session, id: 'forged' } }, apply), /different authorization scope/);
    f.authorization.replaceGrants([]); assert.throws(() => f.service.consumeHistorySeed(input, apply), /Authorization changed/); assert.equal(writes, 0);
  } finally { f.store.close(); }
});
void test('creation is idempotent and refuses stale sources and reused keys with different input', () => {
  const f = fixture();
  try { const result = f.service.create(f.source.id, f.request); assert.deepEqual(f.service.create(f.source.id, f.request), result); assert.throws(() => f.service.create(f.source.id, { ...f.request, agentId: 'missing' }), /already used/); assert.throws(() => f.service.create(f.source.id, { ...f.request, requestId: randomUUID(), expectedRevision: 0 }), /Source conversation changed/); assert.equal(f.management.conversations().length, 1);
  } finally { f.store.close(); }
});
void test('seed persistence and consumption commit atomically and survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'priestess-history-')); const path = join(dir, 'runtime.sqlite'); const f = fixture(path);
  try { const result = f.service.create(f.source.id, f.request); const input = f.input(result);
    assert.throws(() => f.service.consumeHistorySeed(input, items => { f.store.put('sdk-history', input.session.id, items); throw new Error('simulated interruption'); }), /simulated interruption/); assert.equal(f.store.get('sdk-history', input.session.id, z.unknown()), undefined); f.store.close();
    const store = new RuntimeStore(path);
    try { const service = new HistoryContinuationService(store, new ManagementService(store), new AuthorizationService([], store), () => f.config); assert.equal(service.consumeHistorySeed(input, items => store.put('sdk-history', input.session.id, items)), true); assert.equal(service.consumeHistorySeed(input, () => { throw new Error('duplicate'); }), false); assert.ok(store.get('sdk-history', input.session.id, z.unknown())); assert.equal(new ManagementService(store).detail(f.source.id).conversation.archived, true); }
    finally { store.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
