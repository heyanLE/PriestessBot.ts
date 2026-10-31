import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { ObservabilityService, RecordNotFound, parseRecordQuery } from '../apps/server/src/observability.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { AgentDefinitionSchema, FlowSimulationSchema, MessageEventSchema, RunEventSchema, RunIdSchema, RuntimeConfigSchema, type RunContext } from '../packages/contracts/src/index.js';
import { AgentRecordDetailSchema, AgentRecordExportSchema, AgentRecordsResponseSchema, RouteRecordExportSchema, RouteRecordsResponseSchema } from '../packages/contracts/src/observability.js';
import { AuthorizationService, conversationKey } from '../packages/core/src/authorization.js';
import { RuntimeStore } from '../packages/core/src/storage.js';

const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', model: 'test-model' });
const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionType: 'private', sessionId: 'test-chat', sessionName: '测试会话', senderId: 'alice', senderName: 'Alice', messageId: 'incoming', timestamp: 100, botId: 'bot', parts: [{ type: 'text', text: 'Test request' }] });
const query = () => parseRecordQuery(new URLSearchParams());
const trace = (outcome: 'agent' | 'command' | 'ignored' = 'agent') => FlowSimulationSchema.parse({ revision: 1, outcome, agentId: outcome === 'ignored' ? undefined : agent.id, runtimeState: 'operator', path: [{ nodeId: 'route', status: 'passed', summary: 'matched', durationMs: 0 }] });
function context(runId: string, parentRunId?: string): RunContext {
  const auth = new AuthorizationService([]);
  return { runId: RunIdSchema.parse(runId), turnId: runId, principal: message, agentId: agent.id, generation: 0, configRevision: 1, flowRevision: 1, ...auth.resolve(message, agent), budget: agent.budget, signal: new AbortController().signal, depth: parentRunId ? 1 : 0, ...(parentRunId ? { parentRunId: RunIdSchema.parse(parentRunId) } : {}) };
}
function saveRun(store: RuntimeStore, id: string, parentRunId?: string): void {
  store.saveRun({ id, sessionKey: parentRunId ? `child:${id}` : conversationKey(message, agent.id), agentId: agent.id, senderId: message.senderId, generation: 0, status: 'completed', createdAt: 100, updatedAt: 500, summary: 'Done', ...(parentRunId ? { parentRunId } : {}) });
}
function append(store: RuntimeStore, runId: string, sequence: number, payload: Record<string, unknown>): void {
  store.appendEvent(RunEventSchema.parse({ runId, turnId: runId, sequence, timestamp: 100 + sequence, ...payload }));
}
class ReplyModel implements Model {
  calls = 0;
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Streaming only')); }
  async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve();
    this.calls++;
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${this.calls}`, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Test answer' }] }] } });
  }
}

void test('routing records distinguish ignored traffic, handled commands and unknown slash requests that enter an Agent', async () => {
  const model = new ReplyModel(); const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  try {
    const ignored = runtime.submit(MessageEventSchema.parse({ ...message, sessionType: 'group', messageId: 'ignored' }));
    const command = runtime.submit({ ...message, messageId: 'command', parts: [{ type: 'text', text: '/help' }] }); await runtime.idle();
    const unknown = runtime.submit({ ...message, messageId: 'unknown', parts: [{ type: 'text', text: '/not_a_registered_command' }] }); await runtime.idle();
    const records = runtime.observability.routes(query()).records;
    assert.equal(records.find(record => record.id === ignored.id)?.outcome, 'ignored'); assert.equal(records.find(record => record.id === ignored.id)?.runId, null);
    assert.ok(records.every(record => record.path.every(step => step.durationMs === null)));
    assert.equal(records.find(record => record.id === command.id)?.outcome, 'command'); assert.throws(() => runtime.observability.agent(command.id), RecordNotFound);
    assert.deepEqual(runtime.observability.recordLink(command.id), { kind: 'route', id: command.id });
    assert.deepEqual(runtime.observability.recordLink(ignored.id), { kind: 'route', id: ignored.id });
    assert.deepEqual(runtime.observability.recordLink(unknown.id), { kind: 'agent', id: unknown.id });
    assert.equal(model.calls, 1); assert.equal(records.find(record => record.id === unknown.id)?.outcome, 'agent');
    assert.deepEqual(runtime.observability.agents(query()).records.map(record => record.id), [unknown.id]);
  } finally { await runtime.stop(); }
});

void test('legacy route backfill preserves unknown input/model fields and does not fabricate Agent telemetry', () => {
  const store = new RuntimeStore(':memory:');
  try {
    saveRun(store, 'legacy'); store.put('flow-traces', 'legacy', trace()); append(store, 'legacy', 0, { type: 'started', agentId: agent.id });
    const service = new ObservabilityService(store, () => config, () => []);
    const route = service.route('legacy').record; assert.equal(route.legacy, true); assert.equal(route.inputPreview, null); assert.equal(route.messageId, null); assert.equal(route.durationMs, null); assert.equal(route.configRevision, null);
    const record = service.agent('legacy').record; assert.equal(record.model, null); assert.equal(record.engine, null); assert.equal(record.telemetryComplete, false); assert.equal(record.legacy, true);
    assert.equal(record.modelCalls, null); assert.equal(record.inputTokens, null); assert.equal(record.outputTokens, null);
  } finally { store.close(); }
});

void test('Agent accounting counts each usage event once and excludes delegated totals from the parent', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new ObservabilityService(store, () => config, () => []); saveRun(store, 'parent'); saveRun(store, 'child', 'parent');
    service.recordRoute('initial-route', message, config, trace(), 2, 'parent'); service.recordRoute('follow-up-route', { ...message, messageId: 'follow-up' }, config, trace(), 1, 'parent', true);
    service.registerAgent(context('parent'), agent, message); service.registerAgent(context('child', 'parent'), agent, message);
    append(store, 'parent', 0, { type: 'model_call', callId: 'model-1', model: agent.model, source: 'model', status: 'started' });
    append(store, 'parent', 1, { type: 'model_call', callId: 'model-1', model: agent.model, source: 'model', status: 'completed', inputTokens: 30, outputTokens: 4 });
    append(store, 'parent', 2, { type: 'usage', source: 'model', inputTokens: 30, outputTokens: 4 });
    append(store, 'parent', 3, { type: 'usage', source: 'compression', inputTokens: 5, outputTokens: 2 });
    append(store, 'parent', 4, { type: 'usage', source: 'finalization', inputTokens: 7, outputTokens: 3 });
    append(store, 'parent', 5, { type: 'usage', source: 'delegation', inputTokens: 100, outputTokens: 50 });
    append(store, 'parent', 6, { type: 'tool', callId: 'tool-1', name: 'lookup', status: 'started', summary: '' }); append(store, 'parent', 7, { type: 'tool', callId: 'tool-1', name: 'lookup', status: 'completed', summary: '' });
    append(store, 'child', 0, { type: 'usage', source: 'model', inputTokens: 100, outputTokens: 50 });
    const detail = service.agent('parent'); assert.equal(detail.record.inputTokens, 42); assert.equal(detail.record.outputTokens, 9); assert.equal(detail.record.toolCalls, 1); assert.equal(detail.children[0]?.inputTokens, 100); assert.equal(detail.children[0]?.parentRunId, 'parent'); assert.equal(detail.children[0]?.platform, 'qq');
    assert.deepEqual(new Set(detail.record.routeRecordIds), new Set(['initial-route', 'follow-up-route'])); assert.equal(detail.routes.find(record => record.id === 'follow-up-route')?.outcome, 'follow_up'); assert.deepEqual(service.route('follow-up-route').relatedAgentRunIds, ['parent']);
  } finally { store.close(); }
});

void test('audit excerpts retain their original truncation, redaction and size metadata after response sanitization', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new ObservabilityService(store, () => config, () => ['plain-secret-value']); saveRun(store, 'previews'); service.registerAgent(context('previews'), agent, message);
    const preview = { text: 'Safe excerpt [已隐藏]', originalChars: 42000, truncated: true, redacted: true };
    append(store, 'previews', 0, { type: 'tool', name: 'lookup', callId: 'tool', status: 'completed', summary: 'Done', inputPreview: preview, outputPreview: preview });
    append(store, 'previews', 1, { type: 'model_call', callId: 'model', model: agent.model, source: 'model', status: 'completed', inputPreview: preview, outputPreview: preview });
    append(store, 'previews', 2, { type: 'message_delta', text: 'Authorization: Bearer plain-' }); append(store, 'previews', 3, { type: 'message_delta', text: 'secret-value\n' });
    const detail = service.agent('previews'); const tool = detail.events.find(event => event.type === 'tool'); assert.ok(tool?.type === 'tool'); assert.deepEqual(tool.outputPreview, preview); assert.deepEqual(tool.inputPreview, preview);
    const model = detail.events.find(event => event.type === 'model_call'); assert.ok(model?.type === 'model_call'); assert.deepEqual(model.outputPreview, preview);
    assert.doesNotMatch(JSON.stringify(detail), /plain-secret-value/); assert.ok(detail.events.some(event => event.type === 'message_snapshot'));
  } finally { store.close(); }
});

void test('persisted route and Agent input previews are checked against current secrets before display or export', () => {
  const store = new RuntimeStore(':memory:'); let secrets: string[] = [];
  try {
    const service = new ObservabilityService(store, () => config, () => secrets); saveRun(store, 'secret-check');
    const input = { ...message, parts: [{ type: 'text', text: 'lateBoundCredentialValue' }] }; const parsed = MessageEventSchema.parse(input);
    service.recordRoute('secret-check', parsed, config, trace(), 1, 'secret-check'); service.registerAgent(context('secret-check'), agent, parsed);
    secrets = ['lateBoundCredentialValue'];
    assert.doesNotMatch(JSON.stringify(service.route('secret-check')), /lateBoundCredentialValue/); assert.doesNotMatch(JSON.stringify(service.routes(query())), /lateBoundCredentialValue/); assert.doesNotMatch(JSON.stringify(service.agent('secret-check')), /lateBoundCredentialValue/);
  } finally { store.close(); }
});

void test('retained audit events include the latest completion and explicitly mark the missing prefix', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new ObservabilityService(store, () => config, () => []); saveRun(store, 'long'); service.registerAgent(context('long'), agent, message);
    for (let sequence = 0; sequence < 2005; sequence++) append(store, 'long', sequence, { type: 'node', nodeId: 'agent', status: 'started', summary: '', durationMs: 0 });
    append(store, 'long', 2005, { type: 'completed', text: 'Latest completion' });
    const detail = service.agent('long'); assert.equal(detail.audit.eventsTruncated, true); assert.equal(detail.audit.lastSequence, 2005); assert.ok(detail.events.some(event => event.type === 'completed')); assert.equal(detail.record.telemetryComplete, false);
  } finally { store.close(); }
});

void test('route pagination is bounded and stable with platform, session and outcome filters', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new ObservabilityService(store, () => config, () => []);
    for (let i = 0; i < 8; i++) service.recordRoute(`route-${i}`, MessageEventSchema.parse({ ...message, platform: i % 2 ? 'telegram' : 'qq', messageId: `m-${i}` }), config, trace(i === 6 ? 'ignored' : 'agent'), 1, i === 6 ? null : `run-${i}`);
    const first = service.routes(parseRecordQuery(new URLSearchParams('platform=qq&limit=2'))); const next = service.routes(parseRecordQuery(new URLSearchParams('platform=qq&limit=2&offset=2'))); assert.equal(first.total, 4); assert.equal(first.records.length, 2); assert.equal(next.records.length, 2); assert.equal(new Set([...first.records, ...next.records].map(record => record.id)).size, 4);
    const ignored = service.routes(parseRecordQuery(new URLSearchParams('platform=qq&outcome=ignored&sessionType=private&sessionId=test-chat'))); assert.equal(ignored.total, 1); assert.equal(ignored.records[0]?.id, 'route-6');
    assert.throws(() => parseRecordQuery(new URLSearchParams('limit=201')), z.ZodError); assert.throws(() => parseRecordQuery(new URLSearchParams('offset=-1')), z.ZodError);
  } finally { store.close(); }
});

void test('Agent list computes bounded summaries without loading complete event payloads', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new ObservabilityService(store, () => config, () => []); saveRun(store, 'summary-only'); service.registerAgent(context('summary-only'), agent, message);
    append(store, 'summary-only', 0, { type: 'usage', source: 'model', inputTokens: 9, outputTokens: 4 });
    store.events = () => { throw new Error('List endpoints must not deserialize full audit event payloads'); };
    const records = service.agents(query()); assert.equal(records.total, 1); assert.equal(records.records[0]?.inputTokens, 9); assert.equal(records.records[0]?.outputTokens, 4);
  } finally { store.close(); }
});

void test('route and Agent exports require management authorization and reject cross-origin requests', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:', config, model: new ReplyModel() }); const server = createRuntimeServer(runtime, { token: 'observation-test-token', artifacts: '/tmp/priestess-observation-artifacts' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api/ts/`;
  try {
    const run = runtime.submit(message); await runtime.idle();
    const routes = `route-records/${run.id}/export`; const agents = `agent-records/${run.id}/export`;
    for (const path of [routes, agents]) { assert.equal((await fetch(base + path)).status, 401); assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer observation-test-token', Origin: 'https://different-origin.example' } })).status, 403); }
    const read = async (path: string): Promise<unknown> => { const result = await fetch(base + path, { headers: { Authorization: 'Bearer observation-test-token' } }); assert.equal(result.status, 200); const raw: unknown = await result.json(); return raw; };
    assert.equal(RouteRecordExportSchema.parse(await read(routes)).record.id, run.id); assert.equal(AgentRecordExportSchema.parse(await read(agents)).record.id, run.id);
    assert.equal(RouteRecordsResponseSchema.parse(await read('route-records?limit=1')).records.length, 1); assert.equal(AgentRecordsResponseSchema.parse(await read('agent-records?limit=1')).records.length, 1);
    assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE namespace='audit-exports'").get()?.['count'], 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await runtime.stop(); }
});

void test('Agent detail and export expose artifact metadata without private storage fields', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:', config, model: new ReplyModel() });
  const server = createRuntimeServer(runtime, { token: 'artifact-test-token', artifacts: '/tmp/priestess-observation-artifacts' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/ts/agent-records`;
  const headers = { Authorization: 'Bearer artifact-test-token' };
  try {
    const run = runtime.submit(message); await runtime.idle();
    runtime.store.put('artifacts', 'rendered-message', {
      id: 'rendered-message', name: 'rendered-message.png', mimeType: 'image/png', size: 123,
      file: '/private/artifact-storage/rendered-message.png', owner: 'private-principal-key', runId: run.id,
      internalFutureField: 'private-storage-metadata',
    });
    const expected = [{ id: 'rendered-message', url: 'artifact:rendered-message', name: 'rendered-message.png', mimeType: 'image/png', size: 123 }];
    for (const suffix of ['', '/export']) {
      const response = await fetch(`${base}/${run.id}${suffix}`, { headers });
      assert.equal(response.status, 200);
      const raw: unknown = await response.json();
      const detail = suffix ? AgentRecordExportSchema.parse(raw) : AgentRecordDetailSchema.parse(raw);
      assert.deepEqual(detail.artifacts, expected);
      assert.doesNotMatch(JSON.stringify(raw), /private\/artifact-storage|private-principal-key|private-storage-metadata|internalFutureField|"owner"|"file"/);
    }
    assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE namespace='audit-exports'").get()?.['count'], 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await runtime.stop();
  }
});

void test('invalid filters return 400 while invalid stored audit data returns a safe 500', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:', config, model: new ReplyModel() });
  const server = createRuntimeServer(runtime, { token: 'artifact-error-test-token', artifacts: '/tmp/priestess-observation-artifacts' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/ts/agent-records`;
  const headers = { Authorization: 'Bearer artifact-error-test-token' };
  try {
    const run = runtime.submit(message); await runtime.idle();
    const badFilter = await fetch(`${base}?limit=201`, { headers });
    assert.equal(badFilter.status, 400);
    assert.match(await badFilter.text(), /筛选参数无效/);
    runtime.store.put('artifacts', 'invalid-artifact', { id: 'invalid-artifact', name: 'private-invalid-name', mimeType: 'image/png', size: -1, file: '/private/path', owner: 'private-owner', runId: run.id });
    for (const suffix of ['', '/export']) {
      const response = await fetch(`${base}/${run.id}${suffix}`, { headers });
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.match(body, /服务器无法读取此审计记录/);
      assert.doesNotMatch(body, /筛选参数|private|size|ZodError/);
    }
    const missing = await fetch(`${base}/does-not-exist`, { headers });
    assert.equal(missing.status, 404);
    assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE namespace='audit-exports'").get()?.['count'], 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await runtime.stop();
  }
});
