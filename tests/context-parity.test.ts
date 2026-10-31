import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type AgentInputItem } from '@openai/agents';
import { ContextPolicySchema } from '../packages/contracts/src/context-policy.js';
import { prepareSummaryHistory } from '../packages/adapters/src/agents/context-summary.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { SqliteAgentSession, CompactionRecordSchema } from '../packages/adapters/src/agents/session.js';
import { estimateContextTokens, countContextTokens, UsageAnchorSchema, historyHash } from '../packages/adapters/src/agents/token-count.js';
const reply = (text: string): AgentInputItem => protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
const turn = (text: string): AgentInputItem[] => [{ role: 'user', content: text }, reply('Done')];
const policy = ContextPolicySchema.parse({ contextWindowTokens: 16_000, compactAtTokens: 2048, targetTokens: 1024, summaryMaxTokens: 128 });
void test('AstrBotX fallback counts Chinese, Unicode and image allowances', () => {
  assert.equal(estimateContextTokens('中文abcd'), 2);
  assert.equal(estimateContextTokens([{ type: 'input_image', image: 'https://example.org/i.png' }]), 765);
  assert.equal(estimateContextTokens([{ type: 'input_image', image: 'data:image/png;base64,abcd' }]), 765);
  assert.equal(estimateContextTokens([{ role: 'user', content: 'abcde' }]), 1);
});
void test('provider usage covers identical prefix; tail counted once and stale hashes rejected', () => {
  const input = turn('first'); const anchor = UsageAnchorSchema.parse({ prefixHash: historyHash(input), prefixItems: input.length, inputTokens: 1200, reservedTokens: 200, observedAt: 1 });
  const tail: AgentInputItem[] = [{ role: 'user', content: 'a'.repeat(100) }];
  assert.equal(countContextTokens([...input, ...tail], anchor), 1030);
  const changed = [...turn('other'), ...tail]; assert.equal(countContextTokens(changed, anchor), estimateContextTokens(changed));
});
void test('usage anchor survives reconstruction and remains session scoped', async () => {
  const store = new RuntimeStore(':memory:'); const input: AgentInputItem[] = [...turn('first'), { role: 'user', content: 'active' }]; let summaries = 0;
  const processing = { policy, summarize: () => { summaries++; return Promise.resolve({ text: 'Earlier task completed.', model: 'test' }); } };
  try {
    new SqliteAgentSession(store, 'alice', () => {}, undefined, processing).observeUsage(input, { inputTokens: 12_000 });
    await new SqliteAgentSession(store, 'alice', () => {}, undefined, processing).processInput(input); assert.equal(summaries, 1);
    await new SqliteAgentSession(store, 'bob', () => {}, undefined, processing).processInput(input); assert.equal(summaries, 1);
    assert.equal(store.get('sdk-context-usage', 'alice', UsageAnchorSchema), undefined);
  } finally { store.close(); }
});
void test('later model and storage operations retain prefix below hard limit', async () => {
  const store = new RuntimeStore(':memory:'); const input: AgentInputItem[] = [...turn('old '.repeat(1900)), { role: 'user', content: 'continue' }]; let calls = 0;
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy, summarize: () => { calls++; return Promise.resolve({ text: 'Old work completed', model: 'test' }); } });
  try {
    session.setInFlight(true); await session.addItems(input); assert.deepEqual(await session.getItems(), input);
    assert.deepEqual(await session.processInput(input, 0, { hardLimitOnly: true }), input); assert.equal(calls, 0);
    session.setInFlight(false); assert.notDeepEqual(await session.processInput(input), input); assert.equal(calls, 1);
  } finally { store.close(); }
});
void test('finished-turn ceiling is independent and preserves in-flight tools', async () => {
  const store = new RuntimeStore(':memory:'); const active = protocol.ModelItem.array().parse([{ role: 'user', content: 'active' }, { type: 'function_call', name: 'read', callId: 'pending', arguments: '{}', status: 'completed' }]);
  const input = [...turn('old1'), ...turn('old2'), ...turn('recent'), ...active];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy: { ...policy, maxTurns: 2, trimTurns: 2 }, summarize: () => { throw new Error('Not required'); } });
  try { assert.deepEqual(await session.processInput(input), [...turn('recent'), ...active]); } finally { store.close(); }
});
void test('semantic ratio retains exact opening checkpoint and newest whole round', async () => {
  const store = new RuntimeStore(':memory:'); const first = turn('Goal: build the compiler'); const latest = turn('Latest checkpoint');
  const active: AgentInputItem[] = [{ role: 'user', content: 'next step' }]; const input = [...first, ...turn('huge '.repeat(2000)), ...latest, ...active];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy, summarize: () => Promise.resolve({ text: 'Compiler middle work completed', model: 'test' }) });
  try { const result = await session.processInput(input); assert.deepEqual(result.slice(0, 2), first); assert.deepEqual(result.slice(-3), [...latest, ...active]); assert.ok(result.length < input.length + 2); } finally { store.close(); }
});
void test('configured turn dropping preserves current prompt and skips summarizer', async () => {
  const store = new RuntimeStore(':memory:'); const active: AgentInputItem[] = [{ role: 'user', content: 'current' }];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy: { ...policy, strategy: 'truncate_by_turns', trimTurns: 2 }, summarize: () => { throw new Error('Never called'); } });
  try { const result = await session.processInput([...turn('old '.repeat(1800)), ...turn('drop second'), ...turn('keep third'), ...active]); assert.deepEqual(result, [...turn('keep third'), ...active]); assert.equal(store.list('sdk-compactions', CompactionRecordSchema)[0]?.strategy, 'truncate-by-turns-v1'); } finally { store.close(); }
});
void test('context units stay attached to user prompt across truncation', async () => {
  const store = new RuntimeStore(':memory:'); const unit: AgentInputItem = { role: 'user', content: [{ type: 'input_text', text: '<context_unit name="message_meta">sender alice</context_unit>' }] }; const active: AgentInputItem[] = [unit, { role: 'user', content: 'current' }];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy: { ...policy, maxTurns: 1 }, summarize: () => { throw new Error('Never called'); } });
  try { assert.deepEqual(await session.processInput([...turn('old'), ...turn('recent'), ...active]), [...turn('recent'), ...active]); } finally { store.close(); }
});
void test('zero recent ratio still preserves active request and reserved window cannot silently overflow', async () => {
  const store = new RuntimeStore(':memory:'); const active: AgentInputItem[] = [{ role: 'user', content: 'active '.repeat(800) }];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy: { ...policy, keepRecentRatio: 0 }, summarize: () => Promise.resolve({ text: 'summary '.repeat(1000), model: 'test' }) });
  try {
    const result = await session.processInput([...turn('older '.repeat(2000)), ...active], 14_000);
    assert.deepEqual(result, active);
    await assert.rejects(session.processInput(active, 15_000), /context window/);
  } finally { store.close(); }
});
void test('summary metadata contains full ordered history and retained segment counts', async () => {
  const store = new RuntimeStore(':memory:'); const input: AgentInputItem[] = [...turn('original '.repeat(1600)), { role: 'user', content: 'latest request to continue' }];
  const session = new SqliteAgentSession(store, 's', () => {}, undefined, { policy, summarize: (removed, _maxChars, source) => {
    assert.deepEqual(source?.fullHistory, input); assert.equal(source?.recentItems, 1); assert.equal(source?.removedItems, removed.length); assert.equal(source?.openingItems, 0);
    return Promise.resolve({ text: 'Old work done; continue latest request.', model: 'test' });
  } });
  try { await session.processInput(input); } finally { store.close(); }
});

void test('summary history preserves roles and paired tools, quotes incomplete chains and bounds media', () => {
  const input = protocol.ModelItem.array().parse([{ role: 'user', content: 'opening goal' }, { type: 'function_call', name: 'read', callId: 'c', arguments: '{}', status: 'completed' }, { type: 'function_call_result', name: 'read', callId: 'c', output: 'read facts', status: 'completed' }, { role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'checkpoint' }] }, { role: 'user', content: 'latest active request' }]);
  assert.deepEqual(prepareSummaryHistory(input, 2000).items, input);
  const pending = prepareSummaryHistory(input.slice(0, 2), 2000).items; assert.equal(pending.some(item => item.type === 'function_call'), false); assert.match(JSON.stringify(pending), /Historical tool/);
  const media = protocol.ModelItem.array().parse([{ role: 'user', content: [{ type: 'input_image', image: 'data:image/png;base64,abc' }] }]);
  assert.doesNotMatch(JSON.stringify(prepareSummaryHistory(media, 2000)), /base64/);
  const bounded = prepareSummaryHistory([...turn('opening goal'), ...turn('middle '.repeat(5000)), { role: 'user', content: 'latest active request' }], 200);
  assert.equal(bounded.bounded, true); assert.match(JSON.stringify(bounded.items), /opening goal/); assert.match(JSON.stringify(bounded.items.at(-1)), /latest active request/);
});
