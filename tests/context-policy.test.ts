import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Usage, protocol, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, ContextPolicySchema, MessageEventSchema, RuntimeConfigSchema, type RunEvent } from '../packages/contracts/src/index.js';
import { SqliteAgentSession, CompactionRecordSchema, estimateContextTokens } from '../packages/adapters/src/agents/session.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
const policy = ContextPolicySchema.parse({ contextWindowTokens: 16_000, compactAtTokens: 2048, targetTokens: 1024, summaryMaxTokens: 128 });
const history = (): AgentInputItem[] => [{ role: 'user', content: 'old facts '.repeat(700) }, { role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'Completed task A.' }] }, { role: 'user', content: 'Current task' }];
void test('context policy validates threshold order and supports semantic configuration defaults', () => {
  assert.equal(AgentDefinitionSchema.parse({ id: 'a', displayName: 'a' }).contextPolicy.compactAtTokens, 32768);
  assert.equal(ContextPolicySchema.safeParse({ contextWindowTokens: 2048 }).success, false);
  assert.equal(ContextPolicySchema.safeParse({ targetTokens: 40000 }).success, false);
  assert.equal(ContextPolicySchema.safeParse({ maxTurns: 0 }).success, false);
  assert.ok(estimateContextTokens('你好'.repeat(100)) > estimateContextTokens('ab'.repeat(100)));
});
void test('semantic compaction keeps recent complete tool rounds, records source provenance and preserves other scopes', async () => {
  const store = new RuntimeStore(':memory:'); const source = history(); source.push(...protocol.ModelItem.array().parse([{ type: 'function_call', callId: 'recent', name: 'read', arguments: '{}', status: 'completed' }, { type: 'function_call_result', callId: 'recent', name: 'read', status: 'completed', output: 'done' }]));
  let calls = 0;
  const session = new SqliteAgentSession(store, 'alice', () => {}, undefined, { policy, summarize: removed => { calls++; assert.match(JSON.stringify(removed), /old facts/); assert.doesNotMatch(JSON.stringify(removed), /Current task/); return Promise.resolve({ text: 'Task A is complete. Preserve the old facts.', model: 'summary-model' }); } });
  store.put('sdk-history', 'bob', [{ role: 'user', content: 'Bob private' }]); store.put('test-transcript', 'original', source);
  try {
    await session.addItems(source); const compacted = await session.getItems(); assert.equal(calls, 1); assert.equal(compacted.filter(item => 'callId' in item && item.callId === 'recent').length, 2);
    const record = store.list('sdk-compactions', CompactionRecordSchema)[0]; assert.equal(record?.strategy, 'semantic-summary-v1'); assert.equal(record?.model, 'summary-model'); assert.equal(record?.sourceHash.length, 64);
    assert.ok((record?.estimatedTokensBefore ?? 0) > (record?.estimatedTokensAfter ?? 0)); assert.match(JSON.stringify(store.get('sdk-history', 'bob', protocol.ModelItem.array())), /Bob private/); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM documents WHERE namespace=?').get('test-transcript')?.n, 1);
  } finally { store.close(); }
});
void test('summary failure falls back to extract; revoked and concurrently changed histories cannot be overwritten', async () => {
  const store = new RuntimeStore(':memory:'); let current = true;
  try {
    const fallback = new SqliteAgentSession(store, 'fallback', () => {}, undefined, { policy, summarize: () => Promise.reject(new Error('Provider unavailable')) }); await fallback.addItems(history()); assert.match(JSON.stringify(await fallback.getItems()), /bounded-extractive-v1/); assert.match(store.list('sdk-compactions', CompactionRecordSchema)[0]?.fallbackReason ?? '', /unavailable/);
    const revoked = new SqliteAgentSession(store, 'revoked', () => { if (!current) throw new Error('Revoked'); }, undefined, { policy, summarize: () => { current = false; return Promise.resolve({ text: 'Unsafe late summary', model: 'test' }); } }); await assert.rejects(revoked.addItems(history()), /Revoked/); assert.equal(store.get('sdk-history', 'revoked', protocol.ModelItem.array()), undefined);
    const changed = new SqliteAgentSession(store, 'changed', () => {}, undefined, { policy, summarize: () => { store.put('sdk-history', 'changed', [{ role: 'user', content: 'New history' }]); return Promise.resolve({ text: 'Stale', model: 'test' }); } }); await assert.rejects(changed.addItems(history()), /history changed/); assert.match(JSON.stringify(store.get('sdk-history', 'changed', protocol.ModelItem.array())), /New history/);
  } finally { store.close(); }
});
void test('turn-based compaction works below token threshold and oversized single turns fail clearly', async () => {
  const store = new RuntimeStore(':memory:'); const session = new SqliteAgentSession(store, 'scope', () => {}, undefined, { policy: { ...policy, maxTurns: 1, strategy: 'extractive' }, summarize: () => { throw new Error('Not used'); } });
  try { await session.addItems([{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }, { role: 'user', content: 'three' }]); const items = await session.getItems(); assert.equal(items.length, 2); assert.match(JSON.stringify(items.at(-1)), /three/); await assert.rejects(session.processInput([{ role: 'user', content: 'x'.repeat(60_000) }]), /context window/); }
  finally { store.close(); }
});
class ContextModel implements Model {
  readonly summaries: ModelRequest[] = []; readonly requests: ModelRequest[] = []; readonly inputUsages: number[] = [];
  constructor(private readonly malformed = false) {}
  getResponse(request: ModelRequest): Promise<ModelResponse> { this.summaries.push(request); return Promise.resolve({ usage: new Usage({ inputTokens: 10, outputTokens: 10, totalTokens: 20 }), output: [protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: this.malformed ? 'not json' : JSON.stringify({ summary: 'The sender prefers tea; task A is done.' }) }] })] }); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> { this.requests.push(request); const inputTokens = estimateContextTokens(request.input) + estimateContextTokens(request.systemInstructions) + 512; this.inputUsages.push(inputTokens); await Promise.resolve(); yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${this.requests.length}`, usage: { inputTokens, outputTokens: 3, totalTokens: inputTokens + 3 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Complete' }] }] } }); }
}
void test('actual Agents SDK uses tool-free plain JSON semantic model, counts usage and retains durable transcript', async () => {
  const model = new ContextModel(); const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'a', contextPolicy: { ...policy, contextWindowTokens: 64_000 } }); const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], connections: [{ id: 'default', protocol: 'chat_completions' }], flow: { routing: { defaultAgentId: 'a', rules: [] } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  const event = (text: string) => MessageEventSchema.parse({ platform: 'dashboard', platformType: 'telegram', sessionId: 's', sessionType: 'private', senderId: 'alice', botId: 'b', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text }] });
  try {
    runtime.submit(event('I prefer tea. '.repeat(600))); await runtime.idle(); const run = runtime.submit(event('Continue with task B')); await runtime.idle();
    assert.equal(runtime.detail(run.id).run.status, 'completed'); assert.equal(model.summaries.length, 1); assert.deepEqual(model.summaries[0]?.tools, []); assert.equal(model.summaries[0]?.outputType, 'text'); assert.equal(model.summaries[0]?.modelSettings.maxTokens, 128); assert.match(JSON.stringify(model.requests[1]?.input), /sender prefers tea/);
    const summaryInput = model.summaries[0]?.input; assert.ok(Array.isArray(summaryInput));
    assert.ok(summaryInput[0] && 'role' in summaryInput[0] && summaryInput[0].role === 'user'); assert.ok(summaryInput.some(item => 'role' in item && item.role === 'assistant'));
    assert.match(JSON.stringify(summaryInput.at(-1)), /Generate a summary replacing the older middle portion/);
    assert.match(JSON.stringify(summaryInput.slice(0, -1)), /Continue with task B/);
    assert.equal(runtime.detail(run.id).events.reduce((sum,event) => sum + (event.type === 'usage' ? event.inputTokens + event.outputTokens : 0), 0), (model.inputUsages[1] ?? 0) + 23);
    const modelCalls = runtime.detail(run.id).events.filter(event => event.type === 'model_call');
    assert.deepEqual(modelCalls.map(event => [event.source, event.status, event.modelCall]), [['compression', 'started', 1], ['compression', 'completed', 1], ['model', 'started', 2], ['model', 'completed', 2]]);
    assert.equal(modelCalls[1]?.firstTokenMs, undefined);
    const conversation = runtime.management.conversations()[0]; assert.ok(conversation); assert.match(JSON.stringify(runtime.management.detail(conversation.id).entries), /I prefer tea/);
  } finally { await runtime.stop(); }
});

void test('failed compression has a settled audit record and does not renumber later model usage', async () => {
  class FailingCompression extends ContextModel {
    override getResponse(request: ModelRequest): Promise<ModelResponse> { this.summaries.push(request); return Promise.reject(new Error('Provider error body password=private')); }
  }
  const model = new FailingCompression(); const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'a', contextPolicy: { ...policy, contextWindowTokens: 64_000 } });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], connections: [{ id: 'default', protocol: 'chat_completions' }], flow: { routing: { defaultAgentId: 'a', rules: [] } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  const event = (text: string) => MessageEventSchema.parse({ platform: 'dashboard', platformType: 'telegram', sessionId: 's', sessionType: 'private', senderId: 'alice', botId: 'b', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text }] });
  try {
    runtime.submit(event('I prefer tea. '.repeat(600))); await runtime.idle(); const run = runtime.submit(event('Continue with task B')); await runtime.idle();
    const detail = runtime.detail(run.id); assert.equal(detail.run.status, 'completed');
    const modelCalls = detail.events.filter(event => event.type === 'model_call');
    assert.deepEqual(modelCalls.map(event => [event.source, event.status, event.modelCall]), [['compression', 'started', 1], ['compression', 'failed', 1], ['model', 'started', 2], ['model', 'completed', 2]]);
    assert.equal(modelCalls[1]?.inputTokens, undefined); assert.doesNotMatch(JSON.stringify(modelCalls), /Provider error body|password=private/);
    const usage = detail.events.filter((entry): entry is Extract<RunEvent, { type: 'usage' }> => entry.type === 'usage' && entry.source === 'model');
    assert.deepEqual(usage.map(entry => entry.modelCall), [2]);
  } finally { await runtime.stop(); }
});
