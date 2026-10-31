import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { GROUP_HISTORY_TOOL, GroupHistorySearchQuerySchema } from '../packages/contracts/src/group-history-search.js';
import type { PublicGroupMessage } from '../packages/contracts/src/group-conversation.js';
import { AuthorizationService, conversationKey } from '../packages/core/src/authorization.js';
import { GroupHistorySearchService } from '../packages/core/src/group-history-search.js';
import { RuntimeStore } from '../packages/core/src/storage.js';

function input(store: RuntimeStore, auth: AuthorizationService, options: { sender?: string; group?: string; agent?: string; platform?: string; generation?: number; timestamp?: number; messageId?: string } = {}): EngineInput {
  const agent = AgentDefinitionSchema.parse({ id: options.agent ?? 'assistant', displayName: 'Bot', capabilities: ['chat'], resources: { tools: [GROUP_HISTORY_TOOL] } });
  const message = MessageEventSchema.parse({ platform: options.platform ?? 'qq', platformType: 'napcat', sessionType: 'group', sessionId: options.group ?? 'group', senderId: options.sender ?? 'alice', senderName: options.sender ?? 'Alice', messageId: options.messageId ?? randomUUID(), timestamp: options.timestamp ?? 1000, parts: [{ type: 'text', text: 'public text' }], botId: 'bot' });
  const principal = { platform: message.platform, sessionType: message.sessionType, sessionId: message.sessionId, senderId: message.senderId };
  return { agent, message, context: { runId: RunIdSchema.parse(randomUUID()), turnId: 'turn', principal, agentId: agent.id, generation: options.generation ?? store.generation(conversationKey(principal, agent.id)), configRevision: 1, flowRevision: 1, ...auth.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 }, additionalContext: 'PRIVATE DYNAMIC CONTEXT', session: { engine: 'agents_sdk', version: 'test', id: randomUUID() } };
}
function record(service: GroupHistorySearchService, event: EngineInput, text: string): void {
  service.recordInbound({ ...event.message, parts: [{ type: 'text', text }] }, event.agent.id, event.context.generation);
}
function setup(): { store: RuntimeStore; auth: AuthorizationService; service: GroupHistorySearchService } {
  const store = new RuntimeStore(':memory:'); const auth = new AuthorizationService([], store);
  return { store, auth, service: new GroupHistorySearchService(store, auth) };
}

void test('group history searches plain text and sender literally across senders, then paginates older results', () => {
  const { store, auth, service } = setup();
  try {
    for (let i = 1; i <= 6; i++) record(service, input(store, auth, { sender: i % 2 ? 'ALICE' : 'bob', timestamp: i }), `Earlier Monitor ${i} 100%_ok`);
    const current = input(store, auth); service.recordInbound(current.message, current.agent.id, 0);
    const first = service.search(current, { keyword: 'mOnItOr', limit: 2 });
    assert.deepEqual(first.messages.map(message => message.text), ['Earlier Monitor 5 100%_ok', 'Earlier Monitor 6 100%_ok']);
    assert.equal(first.has_more, true); assert.ok(first.next_before_id);
    const second = service.search(current, { keyword: 'MONITOR', limit: 2, before_id: first.next_before_id });
    assert.deepEqual(second.messages.map(message => message.text), ['Earlier Monitor 3 100%_ok', 'Earlier Monitor 4 100%_ok']);
    assert.equal(service.search(current, { sender: 'alice', keyword: '%_' }).messages.length, 3);
    assert.equal(service.search(current, { keyword: 'missing' }).messages.length, 0);
    assert.equal(service.search(current, { keyword: "' OR 1=1 --" }).messages.length, 0);
    assert.match(first.notice, /untrusted data/);
  } finally { store.close(); }
});
void test('queries exclude the current and later records even if callers pass a future cursor', () => {
  const { store, auth, service } = setup();
  try {
    record(service, input(store, auth, { timestamp: 10 }), 'before');
    const current = input(store, auth, { timestamp: 20 }); record(service, current, 'current');
    record(service, input(store, auth, { timestamp: 30 }), 'future');
    record(service, input(store, auth, { timestamp: 5 }), 'late arriving older timestamp');
    assert.deepEqual(service.search(current, { before_id: Number.MAX_SAFE_INTEGER }).messages.map(message => message.text), ['before']);
    const absent = input(store, auth, { timestamp: 10 });
    assert.deepEqual(service.search(absent, {}).messages, []);
    assert.match(service.search(absent, {}).notice, /safe search boundary cannot be established/);
    assert.equal(service.search(input(store, auth, { timestamp: 5 }), {}).messages.length, 0);
  } finally { store.close(); }
});
void test('current-group isolation rejects private, forged principal, revoked and unmounted callers', () => {
  const { store, auth, service } = setup();
  try {
    record(service, input(store, auth, { timestamp: 1 }), 'GROUP A ONLY');
    for (const options of [{ group: 'other-group' }, { platform: 'other-qq' }, { agent: 'other-agent' }]) {
      const other = input(store, auth, options); record(service, other, 'other current');
      assert.equal(service.search(other, {}).messages.length, 0);
    }
    const current = input(store, auth);
    assert.throws(() => service.search({ ...current, message: { ...current.message, sessionType: 'private' }, context: { ...current.context, principal: { ...current.context.principal, sessionType: 'private' } } }, {}), /current group/);
    assert.throws(() => service.search({ ...current, message: { ...current.message, senderId: 'forged' } }, {}), /current group/);
    assert.throws(() => service.search({ ...current, context: { ...current.context, resources: { ...current.context.resources, tools: [] } } }, {}), /not authorized/);
    assert.throws(() => service.search({ ...current, context: { ...current.context, signal: AbortSignal.abort() } }, {}), /cancelled/);
    assert.equal(service.recordInbound({ ...current.message, sessionType: 'private' }, current.agent.id, 0), false);
    auth.replaceGrants([]);
    assert.throws(() => service.search(current, {}), /Authorization changed/);
  } finally { store.close(); }
});
void test('generation reset, deletion and delegated scopes never revive earlier public history', () => {
  const { store, auth, service } = setup();
  try {
    const current = input(store, auth); record(service, input(store, auth, { timestamp: 1 }), 'old');
    store.reset(conversationKey(current.context.principal, current.agent.id));
    assert.throws(() => service.search(current, {}), /generation superseded/);
    assert.equal(service.recordInbound(current.message, current.agent.id, 0), false);
    const fresh = input(store, auth); record(service, fresh, 'fresh current');
    assert.equal(service.search(fresh, {}).messages.length, 0);
    record(service, input(store, auth, { timestamp: 2 }), 'fresh');
    const child = input(store, auth, { agent: 'child', generation: 1 });
    assert.equal(service.search({ ...child, context: { ...child.context, generationAgentId: fresh.agent.id, depth: 1 } }, {}).messages.length, 0);
    const childOwner = input(store, auth, { agent: 'child', timestamp: 3 }); record(service, childOwner, 'child root private to agent');
    assert.equal(service.search({ ...child, context: { ...child.context, generationAgentId: fresh.agent.id, depth: 1 } }, {}).messages.length, 0);
    const id = createHash('sha256').update(JSON.stringify([fresh.message.platform, 'group', fresh.message.sessionId, fresh.agent.id, 1])).digest('hex');
    store.put('management-tombstones', id, { id, deletedAt: Date.now() });
    assert.throws(() => service.search(fresh, {}), /scope is unavailable/);
    assert.equal(service.recordInbound(fresh.message, fresh.agent.id, 1), false);
    assert.equal(service.seed(fresh, []), 0);
  } finally { store.close(); }
});
void test('only confirmed root replies are searchable; record identity is idempotent by role and message ID', () => {
  const { store, auth, service } = setup();
  try {
    const original = input(store, auth, { timestamp: 1, messageId: 'platform-id' });
    assert.equal(service.recordInbound(original.message, original.agent.id, 0), true);
    assert.equal(service.recordInbound(original.message, original.agent.id, 0), false);
    assert.equal(service.recordReply(original, 'not delivered'), false);
    store.saveDelivery({ id: original.context.runId, runId: original.context.runId, status: 'uncertain', updatedAt: Date.now() });
    assert.equal(service.recordReply(original, 'uncertain'), false);
    store.saveDelivery({ id: original.context.runId, runId: original.context.runId, status: 'confirmed', updatedAt: Date.now() });
    assert.equal(service.recordReply({ ...original, context: { ...original.context, depth: 1 } }, 'child result'), false);
    assert.equal(service.recordReply(original, 'confirmed public answer', original.message.messageId), true);
    assert.equal(service.recordReply(original, 'duplicate', original.message.messageId), false);
    const current = input(store, auth, { timestamp: Date.now() + 1 }); record(service, current, 'current');
    const results = service.search(current, {});
    assert.equal(results.messages.length, 2); assert.equal(results.messages[1]?.role, 'bot');
    assert.doesNotMatch(JSON.stringify(results), /not delivered|uncertain|child result|PRIVATE DYNAMIC CONTEXT/);
  } finally { store.close(); }
});
void test('text and output limits preserve pagination, attachment metadata never retains media bytes or URLs', () => {
  const { store, auth, service } = setup();
  try {
    const media = input(store, auth, { timestamp: 1 });
    const message = MessageEventSchema.parse({ ...media.message, parts: [
      { type: 'image', url: 'data:image/png;base64,SECRET_PIXELS', mimeType: 'image/png' },
      { type: 'file', name: 'report.pdf', url: 'https://secret.invalid/token', mimeType: 'application/pdf', extractedText: 'PRIVATE EXTRACTED CONTENT' },
      { type: 'quote', messageId: 'quoted', senderId: 'carol', text: 'quoted words', attachments: [{ type: 'image', url: 'https://secret.invalid/pixels', mimeType: 'image/png' }] },
    ] });
    service.recordInbound(message, media.agent.id, 0);
    const initial = input(store, auth); record(service, initial, 'current');
    const result = service.search(initial, {});
    assert.match(result.messages[0]?.text ?? '', /\[Image\].*\n\[File: report.pdf\]/);
    assert.match(result.messages[0]?.text ?? '', /sender_id=carol/);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_PIXELS|secret.invalid|EXTRACTED CONTENT/);
    for (let i = 2; i <= 16; i++) record(service, input(store, auth, { timestamp: i }), `${i}:` + '\u0001'.repeat(8000));
    const current = input(store, auth); record(service, current, 'current');
    const bounded = service.search(current, { limit: 50 });
    assert.ok(JSON.stringify(bounded).length <= 24_000); assert.equal(bounded.has_more, true); assert.ok(bounded.next_before_id);
    assert.ok(bounded.messages.every(item => item.truncated && item.text.length <= 4000));
    assert.ok(service.search(current, { before_id: bounded.next_before_id }).messages.length > 0);
  } finally { store.close(); }
});
void test('history persists on disk and retains only the latest 700 records per scope', () => {
  const directory = mkdtempSync(join(tmpdir(), 'group-history-')); const path = join(directory, 'history.sqlite');
  let store = new RuntimeStore(path);
  try {
    let auth = new AuthorizationService([], store); let service = new GroupHistorySearchService(store, auth);
    for (let i = 1; i <= 705; i++) record(service, input(store, auth, { timestamp: i }), `entry-${i}`);
    store.close(); store = new RuntimeStore(path); auth = new AuthorizationService([], store); service = new GroupHistorySearchService(store, auth);
    const current = input(store, auth); record(service, current, 'current');
    assert.equal(service.search(current, { keyword: 'entry-1' }).messages.some(message => message.text === 'entry-1'), false);
    let cursor: number | null = null; let count = 0;
    do { const page = service.search(current, { limit: 50, before_id: cursor }); count += page.messages.length; cursor = page.next_before_id; } while (cursor !== null);
    assert.equal(count, 699, 'the retained 700 rows include the current boundary row');
    assert.equal(service.search(current, { keyword: 'entry-705' }).messages.length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
void test('an evicted request boundary cannot reveal later arrivals with backdated timestamps', () => {
  const { store, auth, service } = setup();
  try {
    const current = input(store, auth, { timestamp: 1000 }); record(service, current, 'current');
    for (let i = 0; i < 700; i++) record(service, input(store, auth, { timestamp: i }), 'arrived after current despite older timestamp');
    const result = service.search(current, {});
    assert.deepEqual(result.messages, []); assert.equal(result.has_more, false); assert.equal(result.next_before_id, null);
    assert.match(result.notice, /current request is not retained/);
  } finally { store.close(); }
});
void test('empty current messages still establish a search boundary and persist an explicit marker', () => {
  const { store, auth, service } = setup();
  try {
    record(service, input(store, auth, { timestamp: 1 }), 'earlier');
    const blank = input(store, auth, { timestamp: 2 }); record(service, blank, '   ');
    assert.deepEqual(service.search(blank, {}).messages.map(message => message.text), ['earlier']);
    const next = input(store, auth, { timestamp: 3 }); record(service, next, 'current');
    assert.deepEqual(service.search(next, {}).messages.map(message => message.text), ['earlier', '[Empty message]']);
  } finally { store.close(); }
});
void test('verified public snapshots seed once before live records and preserve historical ordering', () => {
  const { store, auth, service } = setup();
  try {
    const current = input(store, auth, { timestamp: 100 });
    const snapshot: PublicGroupMessage[] = [
      { role: 'assistant', text: 'seed answer', messageId: 'answer', senderId: 'bot', senderName: 'Bot', timestamp: 20 },
      { role: 'user', text: 'seed question', messageId: 'question', senderId: 'alice', senderName: 'Alice', timestamp: 10 },
      { role: 'user', text: 'future seed', messageId: 'future', senderId: 'alice', senderName: 'Alice', timestamp: 200 },
    ];
    assert.equal(service.seed(current, snapshot), 2); record(service, current, 'current question');
    assert.equal(service.seed(current, snapshot), 0);
    assert.deepEqual(service.search(current, {}).messages.map(message => message.text), ['seed question', 'seed answer']);
    const existing = input(store, auth, { group: 'already-live', timestamp: 100 }); record(service, existing, 'live');
    assert.equal(service.seed(existing, snapshot), 0);
    assert.equal(service.search(existing, {}).messages.length, 0);
    const empty = input(store, auth, { group: 'empty' }); assert.equal(service.seed(empty, []), 0); assert.equal(service.seed(empty, snapshot), 0);
  } finally { store.close(); }
});
void test('query schema rejects unsafe cursors and excessive limits; no arbitrary group parameter exists', () => {
  assert.equal(GroupHistorySearchQuerySchema.parse({}).limit, 20);
  for (const query of [{ limit: 51 }, { limit: 0 }, { before_id: 0 }, { before_id: -1 }, { before_id: 1.2 }, { before_id: Number.MAX_SAFE_INTEGER + 1 }, { group_id: 'another-group' }]) assert.equal(GroupHistorySearchQuerySchema.safeParse(query).success, false);
});
