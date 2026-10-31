import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import type { z } from 'zod';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, CapabilitySchema, GrantSchema, MessageEventSchema, RunDetailSchema, RunsResponseSchema, RuntimeConfigSchema, type ReplyPlan } from '../packages/contracts/src/index.js';
import type { PlatformAdapter } from '../packages/adapters/src/platforms/types.js';

class DelegationModel implements Model {
  readonly requests: { kind: 'parent' | 'child'; request: ModelRequest }[] = [];
  parentCalls = 0; childCalls = 0; childCancelled = false;
  private notifyChild: (() => void) | undefined;
  readonly childStarted = new Promise<void>(resolve => { this.notifyChild = resolve; });
  constructor(private readonly children = 2, private readonly holdChild = false) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streamed SDK calls')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const kind = request.systemInstructions?.includes('PARENT_IDENTITY') ? 'parent' : 'child'; this.requests.push({ kind, request });
    let output: unknown[];
    if (kind === 'parent') {
      this.parentCalls += 1;
      output = this.parentCalls <= this.children ? [{ type: 'function_call', callId: `delegate-${this.parentCalls}`, name: 'delegate_agent', arguments: JSON.stringify({ agentId: 'child', task: `TASK_${this.parentCalls}` }), status: 'completed' }] : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Parent answer using child results' }] }];
    } else {
      this.childCalls += 1; this.notifyChild?.();
      if (this.holdChild) await new Promise<void>((_resolve, reject: (error: Error) => void) => { const cancel = (): void => { this.childCancelled = true; reject(new Error('Child transport cancelled')); }; if (request.signal?.aborted) cancel(); else request.signal?.addEventListener('abort', cancel, { once: true }); });
      output = [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `CHILD_RESULT_${this.childCalls}` }] }];
    }
    await Promise.resolve();
    if (kind === 'child') yield { type: 'output_text_delta', delta: `CHILD_RESULT_${this.childCalls}` };
    const usage = kind === 'parent' ? { inputTokens: 2, outputTokens: 3, totalTokens: 5 } : { inputTokens: 3, outputTokens: 4, totalTokens: 7 };
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `${kind}-${kind === 'parent' ? this.parentCalls : this.childCalls}`, usage, output } });
  }
}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> { const value: unknown = await response.json(); return schema.parse(value); }
async function fixture(model: DelegationModel, work: (runtime: PriestessRuntime, adapter: PlatformAdapter, sent: ReplyPlan[], get: (route: string) => Promise<Response>) => Promise<void>, budget = 100, stream = false): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-delegation-'));
  const parent = AgentDefinitionSchema.parse({ id: 'parent', displayName: 'Parent', instructions: 'PARENT_IDENTITY PARENT_PERSONA_SECRET', capabilities: ['chat', 'agent.delegate', 'conversation.stop'], resources: { tools: ['delegate_agent'], memoryLibraries: ['shared'] }, delegationTargets: ['child'], budget: { maxTokens: budget, maxTurns: 6, maxConcurrentChildren: 2 } });
  const child = AgentDefinitionSchema.parse({ id: 'child', displayName: 'Child', instructions: 'CHILD_IDENTITY', capabilities: CapabilitySchema.options, resources: { tools: ['write_file', 'memory_save'], memoryLibraries: ['child-private'] }, budget: { maxTokens: budget } });
  const grant = GrantSchema.parse({ platform: 'test-im', senderId: 'alice', maximumState: 'elite_operator', defaultState: 'operator', capabilities: CapabilitySchema.options, resources: { tools: ['delegate_agent', 'write_file', 'memory_save'], memoryLibraries: ['shared', 'child-private'] } });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [parent, child], grants: [grant], memoryLibraries: [{ id: 'shared', displayName: 'Shared' }, { id: 'child-private', displayName: 'Child only' }], flow: { routing: { defaultAgentId: 'parent', rules: [] }, delivery: { stream } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model }); const sent: ReplyPlan[] = [];
  const adapter: PlatformAdapter = { id: 'test-im', capabilities: { edit: stream, images: false, files: false, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: (_target, reply) => { sent.push(reply); return Promise.resolve({ status: 'confirmed', messageIds: [String(sent.length)] }); }, edit: (_target, _messageId, text) => { sent.push({ parts: [{ type: 'text', text }] }); return Promise.resolve({ status: 'confirmed', messageIds: [String(sent.length)] }); }, downloadMedia: () => Promise.reject(new Error('No media')) };
  const server = createRuntimeServer(runtime, { token: 'delegate-test', artifacts: join(directory, 'artifacts') });
  try {
    await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No listener');
    await work(runtime, adapter, sent, route => fetch(`http://127.0.0.1:${address.port}/api/ts/${route}`, { headers: { Authorization: 'Bearer delegate-test' }, signal: AbortSignal.timeout(5000) }));
  } finally { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
function message() { return MessageEventSchema.parse({ platform: 'test-im', platformType: 'telegram', sessionId: 'chat', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text: 'Delegate independent tasks' }] }); }

void test('real SDK delegation preserves child identity and authority, records children and sends only the parent answer', async () => {
  const model = new DelegationModel();
  await fixture(model, async (runtime, adapter, sent, get) => {
    const parent = runtime.submit(message(), adapter); await runtime.idle();
    assert.equal(runtime.detail(parent.id).run.status, 'completed'); assert.equal(model.parentCalls, 3); assert.equal(model.childCalls, 2);
    const children = model.requests.filter(item => item.kind === 'child');
    assert.ok(children.every(item => item.request.systemInstructions?.includes('CHILD_IDENTITY')));
    assert.ok(children.every(item => !item.request.systemInstructions?.includes('PARENT_PERSONA_SECRET')));
    assert.ok(children.every(item => item.request.tools.length === 0));
    assert.doesNotMatch(JSON.stringify(children[1]?.request.input), /CHILD_RESULT_1/);
    const parentLast = model.requests.filter(item => item.kind === 'parent').at(-1); assert.match(JSON.stringify(parentLast?.request.input), /CHILD_RESULT_1/); assert.match(JSON.stringify(parentLast?.request.input), /CHILD_RESULT_2/);
    assert.equal(sent.length, 1); assert.equal(sent[0]?.parts[0]?.type === 'text' ? sent[0]?.parts[0].text : '', 'Parent answer using child results');
    const listed = await parse(await get('runs'), RunsResponseSchema); const childRuns = listed.runs.filter(run => run.agentId === 'child'); assert.equal(childRuns.length, 2);
    for (const child of childRuns) { assert.equal(child.parentRunId, parent.id); assert.equal(child.status, 'completed'); const detail = await parse(await get(`runs/${child.id}`), RunDetailSchema); assert.ok(detail.events.some(event => event.type === 'completed')); }
    const usage = runtime.detail(parent.id).events.filter(event => event.type === 'usage'); assert.equal(usage.reduce((total, item) => total + item.inputTokens + item.outputTokens, 0), 29);
  });
});
void test('parent can wait for a child while every host scheduler slot is occupied', async () => {
  const model = new DelegationModel(1);
  await fixture(model, async (runtime, adapter) => {
    const blockers = ['busy-a', 'busy-b', 'busy-c'].map(key => runtime.scheduler.enqueue(key, signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))));
    try { const parent = runtime.submit(message(), adapter); await Promise.race([runtime.idle(), new Promise<never>((_resolve, reject: (error: Error) => void) => { const timer = setTimeout(() => reject(new Error('Delegation scheduler deadlock')), 3000); timer.unref(); })]); assert.equal(runtime.detail(parent.id).run.status, 'completed'); assert.equal(model.childCalls, 1); }
    finally { for (const key of ['busy-a', 'busy-b', 'busy-c']) runtime.scheduler.cancel(key); await Promise.all(blockers); }
  });
});
void test('cancelling a parent aborts its child transport and emits no late IM reply', async () => {
  const model = new DelegationModel(1, true);
  await fixture(model, async (runtime, adapter, sent) => {
    const parent = runtime.submit(message(), adapter); await model.childStarted; runtime.cancel(parent.id); await runtime.idle();
    assert.equal(runtime.detail(parent.id).run.status, 'cancelled'); assert.equal(model.childCancelled, true); assert.equal(sent.length, 0);
    const children = runtime.store.runs().filter(run => run.agentId === 'child'); assert.equal(children.length, 1); assert.equal(children[0]?.status, 'cancelled');
  });
});

void test('child deltas remain in child audit and never stream to the parent IM destination', async () => {
  await fixture(new DelegationModel(1), async (runtime, adapter, sent) => {
    const parent = runtime.submit(message(), adapter); await runtime.idle();
    assert.equal(runtime.detail(parent.id).run.status, 'completed');
    assert.equal(sent.length, 1); assert.doesNotMatch(JSON.stringify(sent), /CHILD_RESULT/);
    const child = runtime.store.runs().find(run => run.parentRunId === parent.id); assert.ok(child);
    assert.ok(runtime.detail(child.id).events.some(event => event.type === 'message_delta' && event.text.includes('CHILD_RESULT')));
    assert.ok(runtime.detail(child.id).events.some(event => event.type === 'completed'));
  }, 100, true);
});
