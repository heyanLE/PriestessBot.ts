import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import type { z } from 'zod';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { ArtifactUploadResponseSchema, ConfigSnapshotSchema, ConfigValidationSchema, FlowSimulationSchema, GrantSchema, KnowledgeDocumentSchema, KnowledgeResponseSchema, KnowledgeSearchResponseSchema, MemoriesResponseSchema, MemoryRecordSchema, MessageEventSchema, RunDetailSchema, RunEventSchema, RuntimeConfigSchema, CapabilitySchema, type MessageEvent } from '../packages/contracts/src/index.js';

class HttpTestModel implements Model {
  readonly requests: ModelRequest[] = [];
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected SDK streaming')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request);
    const last = typeof request.input === 'string' ? request.input : JSON.stringify(request.input.at(-1));
    if (last.includes('wait_forever')) {
      await new Promise<void>((_resolve, reject: (reason: Error) => void) => {
        const abort = (): void => reject(new Error('Model aborted'));
        if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    await Promise.resolve(); yield { type: 'output_text_delta', delta: 'Hello ' };
    yield { type: 'output_text_delta', delta: 'test' };
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${this.requests.length}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'Hello test' }] }] } });
  }
}
const token = 'test-management-secret';
type RequestFn = (route: string, method?: string, value?: unknown, authenticated?: boolean) => Promise<Response>;
async function parsed<T>(response: Response, schema: z.ZodType<T>): Promise<T> { const value: unknown = await response.json(); return schema.parse(value); }
function event(senderId: string, text: string, messageId = crypto.randomUUID()): MessageEvent {
  return MessageEventSchema.parse({ platform: 'dashboard', platformType: 'telegram', sessionId: 'group', sessionType: 'private', senderId, messageId, timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text }] });
}
async function withServer(work: (runtime: PriestessRuntime, request: RequestFn, model: HttpTestModel) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-http-')); const base = defaultConfiguration();
  const first = base.agents[0]; if (first === undefined) throw new Error('Missing default Agent');
  const agent = { ...first, capabilities: [...CapabilitySchema.options] };
  const grant = GrantSchema.parse({ platform: 'dashboard', senderId: 'alice', maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities: agent.capabilities, resources: agent.resources });
  const config = RuntimeConfigSchema.parse({ ...base, agents: [agent], grants: [grant] });
  const model = new HttpTestModel(); const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  const server = createRuntimeServer(runtime, { token, artifacts: join(directory, 'artifacts') });
  try {
    await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const request: RequestFn = (route, method = 'GET', value, authenticated = true) => fetch(`http://127.0.0.1:${address.port}${route === '/health' ? route : `/api/ts/${route}`}`, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(5000) });
    await work(runtime, request, model);
  } finally {
    await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
  }
}

void test('HTTP authentication, config validation, revision conflicts, rollback and pure routing preview', async () => withServer(async (runtime, request) => {
  assert.equal((await request('config', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/health', 'GET', undefined, false)).status, 200);
  const snapshot = await parsed(await request('config'), ConfigSnapshotSchema); assert.equal(snapshot.revision, 1);
  const invalid = await parsed(await request('config/validate', 'POST', { config: { ...snapshot.config, flow: { ...snapshot.config.flow, edges: [] } } }), ConfigValidationSchema); assert.equal(invalid.valid, false);
  const msg = event('alice', 'Preview'); const preview = await parsed(await request('flow/simulate', 'POST', { config: snapshot.config, message: msg }), FlowSimulationSchema);
  assert.equal(preview.outcome, 'agent'); assert.equal(preview.runtimeState, 'elite_operator'); assert.equal(runtime.store.runs().length, 0);
  const changed = { ...snapshot.config, flow: { ...snapshot.config.flow, delivery: { ...snapshot.config.flow.delivery, stream: false } } };
  const updated = await parsed(await request('config', 'PUT', { expectedRevision: 1, config: changed }), ConfigSnapshotSchema); assert.equal(updated.revision, 2);
  assert.equal((await request('config', 'PUT', { expectedRevision: 1, config: changed })).status, 409);
  const rollback = await parsed(await request('config/rollback', 'POST', { revision: 1, expectedRevision: 2 }), ConfigSnapshotSchema); assert.equal(rollback.revision, 3); assert.equal(rollback.config.flow.delivery.stream, true);
}));

void test('HTTP chat runs official SDK, exposes ordered resumable SSE, and isolates group sender history', async () => withServer(async (runtime, request, model) => {
  const first = await parsed(await request('chat', 'POST', { message: event('alice', 'first message') }), RunDetailSchema); await runtime.idle();
  const detail = await parsed(await request(`runs/${first.run.id}`), RunDetailSchema); assert.equal(detail.run.status, 'completed'); assert.equal(detail.run.summary, 'Hello test');
  const stream = await request(`runs/${first.run.id}/events?after=0`); assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const events = (await stream.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => { const data: unknown = JSON.parse(line.slice(6)); return RunEventSchema.parse(data); });
  assert.ok(events.length > 1); assert.ok(events.every(item => item.sequence > 0)); assert.equal(events.at(-1)?.type, 'completed');
  await parsed(await request('chat', 'POST', { message: event('alice', 'second message') }), RunDetailSchema); await runtime.idle();
  assert.match(JSON.stringify(model.requests[1]?.input), /first message/);
  await parsed(await request('chat', 'POST', { message: event('bob', 'bob message') }), RunDetailSchema); await runtime.idle();
  assert.doesNotMatch(JSON.stringify(model.requests[2]?.input), /first message|second message/);
}));

void test('HTTP commands bypass model, enforce state authorization, reset history and cancel model I/O', async () => withServer(async (runtime, request, model) => {
  const command = async (sender: string, text: string) => { const initial = await parsed(await request('chat', 'POST', { message: event(sender, text) }), RunDetailSchema); await runtime.idle(); return parsed(await request(`runs/${initial.run.id}`), RunDetailSchema); };
  assert.match((await command('alice', '/help')).run.summary, /state/); assert.equal(model.requests.length, 0);
  assert.match((await command('bob', '/state elite_operator')).run.summary, /管理员分配/); assert.equal(model.requests.length, 0);
  assert.match((await command('alice', '/state senior_operator')).run.summary, /管理员分配/);
  assert.match((await command('alice', '/state')).run.summary, /高级资深干员态/);
  assert.match((await command('bob', '/state')).run.summary, /普通干员态/);
  await command('alice', 'before reset');
  assert.match((await command('alice', '/reset')).run.summary, /新会话/);
  await command('alice', 'after reset'); assert.doesNotMatch(JSON.stringify(model.requests.at(-1)?.input), /before reset/);
  const active = await parsed(await request('chat', 'POST', { message: event('alice', 'wait_forever') }), RunDetailSchema);
  for (let attempts = 0; attempts < 100 && runtime.detail(active.run.id).run.status !== 'running'; attempts += 1) await new Promise<void>(resolve => setTimeout(resolve, 5));
  assert.equal((await request(`runs/${active.run.id}/cancel`, 'POST', {})).status, 200); await runtime.idle();
  const cancelled = await parsed(await request(`runs/${active.run.id}`), RunDetailSchema); assert.equal(cancelled.run.status, 'cancelled'); assert.equal(cancelled.events.some(item => item.type === 'completed'), false);
}));

void test('HTTP memory and knowledge operations retain citations, isolation and deletion consistency', async () => withServer(async (runtime, request, model) => {
  const record = await parsed(await request('memory', 'POST', { libraryId: 'default', agentId: 'assistant', principal: { platform: 'dashboard', sessionId: 'group', senderId: 'alice' }, scope: 'sender', text: 'Alice private tea preference', source: 'manual', confidence: 1 }), MemoryRecordSchema);
  assert.equal((await parsed(await request('memory'), MemoriesResponseSchema)).memories.length, 1);
  await request('chat', 'POST', { message: event('bob', 'tea') }); await runtime.idle(); assert.doesNotMatch(JSON.stringify(model.requests.at(-1)?.input), /Alice private/);
  await request('chat', 'POST', { message: event('alice', 'tea') }); await runtime.idle(); assert.match(JSON.stringify(model.requests.at(-1)?.input), /Alice private/);
  assert.equal((await request(`memory/${record.id}`, 'DELETE')).status, 200); assert.equal((await parsed(await request('memory'), MemoriesResponseSchema)).memories.length, 0);
  const document = await parsed(await request('knowledge', 'POST', { libraryId: 'default', name: 'manual.md', mimeType: 'text/markdown', content: '# Routing\nThe router chooses the correct Agent.' }), KnowledgeDocumentSchema); assert.equal(document.status, 'ready');
  const found = await parsed(await request('knowledge/search?query=router'), KnowledgeSearchResponseSchema); assert.equal(found.hits[0]?.documentName, 'manual.md');
  assert.equal((await parsed(await request('knowledge/search?query=router&libraryId=unauthorized'), KnowledgeSearchResponseSchema)).hits.length, 0);
  assert.equal((await request(`knowledge/${document.id}`, 'DELETE')).status, 200); assert.equal((await parsed(await request('knowledge'), KnowledgeResponseSchema)).documents.length, 0);
}));

void test('HTTP artifacts require auth and upload validation before model attachment preparation', async () => withServer(async (runtime, request, model) => {
  const uploaded = await parsed(await request('artifacts', 'POST', { name: '../note.md', mimeType: 'text/markdown', encoding: 'base64', content: Buffer.from('Untrusted attachment text').toString('base64') }), ArtifactUploadResponseSchema); assert.equal(uploaded.name, 'note.md');
  assert.equal((await request(`artifacts/${uploaded.id}`, 'GET', undefined, false)).status, 401);
  assert.equal(await (await request(`artifacts/${uploaded.id}`)).text(), 'Untrusted attachment text');
  const msg = event('alice', 'read attached file');
  await request('chat', 'POST', { message: { ...msg, parts: [...msg.parts, { type: 'file', url: uploaded.url, artifactId: uploaded.id, name: uploaded.name, mimeType: uploaded.mimeType }] } }); await runtime.idle();
  assert.match(JSON.stringify(model.requests.at(-1)?.input), /Untrusted attachment text/);
  assert.equal((await request('chat', 'POST', { message: { ...event('alice', 'unsafe URL'), parts: [{ type: 'image', url: 'http://127.0.0.1/private', mimeType: 'image/png' }] } })).status, 400);
  assert.equal((await request('artifacts', 'POST', { name: 'fake.png', mimeType: 'image/png', encoding: 'base64', content: Buffer.from('not an image').toString('base64') })).status, 400);
}));

void test('publishing configuration revokes in-flight work and duplicate ingress never repeats a model call', async () => withServer(async (runtime, request, model) => {
  const duplicate = event('alice', 'exactly once input');
  await request('chat', 'POST', { message: duplicate }); await runtime.idle(); const count = model.requests.length;
  const repeated = await parsed(await request('chat', 'POST', { message: duplicate }), RunDetailSchema); await runtime.idle(); assert.equal(model.requests.length, count); assert.match(repeated.run.summary, /Duplicate/);
  const waiting = await parsed(await request('chat', 'POST', { message: event('alice', 'wait_forever') }), RunDetailSchema);
  for (let attempts = 0; attempts < 100 && runtime.detail(waiting.run.id).run.status !== 'running'; attempts += 1) await new Promise<void>(resolve => setTimeout(resolve, 5));
  const snapshot = await parsed(await request('config'), ConfigSnapshotSchema);
  const changed = { ...snapshot.config, grants: [] };
  assert.equal((await request('config', 'PUT', { expectedRevision: snapshot.revision, config: changed })).status, 200); await runtime.idle();
  const detail = await parsed(await request(`runs/${waiting.run.id}`), RunDetailSchema); assert.ok(['cancelled', 'failed'].includes(detail.run.status)); assert.equal(detail.events.some(item => item.type === 'completed'), false);
}));

void test('real group public history is source labeled while another sender never sees private recalled memory', async () => withServer(async (runtime, request, model) => {
  await request('memory', 'POST', { libraryId: 'default', agentId: 'assistant', principal: { platform: 'dashboard', sessionId: 'group', senderId: 'alice', sessionType: 'group' }, scope: 'sender', text: 'ALICE_PRIVATE_SECRET', source: 'manual', confidence: 1 });
  const alice = event('alice', 'Alice public message');
  await request('chat', 'POST', { message: { ...alice, sessionType: 'group', parts: [...alice.parts, { type: 'mention', userId: 'bot' }] } }); await runtime.idle();
  assert.match(JSON.stringify(model.requests.at(-1)?.input), /ALICE_PRIVATE_SECRET/);
  const bob = event('bob', 'Bob public message');
  await request('chat', 'POST', { message: { ...bob, sessionType: 'group', parts: [...bob.parts, { type: 'mention', userId: 'bot' }] } }); await runtime.idle();
  const input = JSON.stringify(model.requests.at(-1)?.input); assert.doesNotMatch(input, /ALICE_PRIVATE_SECRET/); assert.match(input, /Bob public message/);
}));
void test('private and group channels with identical IDs cannot reuse each other’s SDK context', async () => withServer(async (runtime, request, model) => {
  await request('chat', 'POST', { message: event('alice', 'PRIVATE_CHANNEL_SECRET') }); await runtime.idle();
  const group = event('alice', 'GROUP_CHANNEL_MESSAGE');
  await request('chat', 'POST', { message: { ...group, sessionType: 'group', parts: [...group.parts, { type: 'mention', userId: 'bot' }] } }); await runtime.idle();
  assert.doesNotMatch(JSON.stringify(model.requests.at(-1)?.input), /PRIVATE_CHANNEL_SECRET/);
  await request('chat', 'POST', { message: event('alice', 'Private follow-up') }); await runtime.idle();
  assert.match(JSON.stringify(model.requests.at(-1)?.input), /PRIVATE_CHANNEL_SECRET/); assert.doesNotMatch(JSON.stringify(model.requests.at(-1)?.input), /GROUP_CHANNEL_MESSAGE/);
}));

class ApprovalHttpModel implements Model {
  constructor(private readonly askApproval: boolean) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streaming')); }
  async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve();
    const output: unknown[] = this.askApproval ? [{ type: 'function_call', callId: 'approve-memory-call', name: 'memory_save', arguments: JSON.stringify({ libraryId: 'default', text: 'Memory written exactly once after restart' }), status: 'completed' }] : [{ role: 'assistant', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'Memory saved' }] }];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: this.askApproval ? 'ask' : 'finish', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
  }
}
void test('HTTP approval resumes durable SDK state after runtime restart and cannot execute twice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-approval-http-')); const database = join(directory, 'runtime.sqlite');
  const base = defaultConfiguration(); const config = { ...base, agents: base.agents.map(agent => ({ ...agent, approvalTools: ['memory_save'] })) };
  let closeCurrent: (() => Promise<void>) | undefined;
  const open = async (runtime: PriestessRuntime): Promise<RequestFn> => {
    const server = createRuntimeServer(runtime, { token, artifacts: join(directory, 'artifacts') });
    await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing address');
    closeCurrent = async () => { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
    return (route, method = 'GET', value) => fetch(`http://127.0.0.1:${address.port}/api/ts/${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(5000) });
  };
  try {
    const original = new PriestessRuntime({ database, config, model: new ApprovalHttpModel(true) }); const before = await open(original);
    const initial = await parsed(await before('chat', 'POST', { message: event('alice', 'Remember something') }), RunDetailSchema); await original.idle();
    const paused = await parsed(await before(`runs/${initial.run.id}`), RunDetailSchema); assert.equal(paused.run.status, 'paused'); assert.equal(original.memory.list().length, 0);
    const approval = paused.events.find(item => item.type === 'paused'); if (approval?.type !== 'paused') throw new Error('Missing approval event');
    const oldSequence = paused.events.at(-1)?.sequence ?? -1;
    if (closeCurrent === undefined) throw new Error('Missing cleanup'); await closeCurrent(); closeCurrent = undefined;
    const restored = new PriestessRuntime({ database, model: new ApprovalHttpModel(false) }); const after = await open(restored);
    assert.equal((await after(`runs/${initial.run.id}/approval`, 'POST', { approvalId: approval.approvalId, approved: true })).status, 202); await restored.idle();
    const done = await parsed(await after(`runs/${initial.run.id}`), RunDetailSchema); assert.equal(done.run.status, 'completed', JSON.stringify(done)); assert.equal(restored.memory.list().length, 1); assert.ok((done.events.at(-1)?.sequence ?? -1) > oldSequence);
    assert.notEqual((await after(`runs/${initial.run.id}/approval`, 'POST', { approvalId: approval.approvalId, approved: true })).status, 202); assert.equal(restored.memory.list().length, 1);
  } finally { await closeCurrent?.(); await rm(directory, { recursive: true, force: true }); }
});
