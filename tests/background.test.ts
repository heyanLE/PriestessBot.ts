import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { PersistedEngineInputSchema } from '../apps/server/src/persisted-input.js';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RuntimeConfigSchema, type MessageEvent } from '../packages/contracts/src/index.js';
import { conversationKey } from '../packages/core/src/index.js';

class BackgroundModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly pauseContinuation = false) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streaming')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request); await Promise.resolve();
    const output: unknown[] = this.requests.length === 1 ? [{ type: 'function_call', name: 'exec_command', callId: 'background-process', arguments: JSON.stringify({ command: 'sleep 1.3; printf route_to_other' }), status: 'completed' }] : this.requests.length === 3 && this.pauseContinuation ? [{ type: 'function_call', name: 'memory_save', callId: 'continuation-approval', arguments: JSON.stringify({ libraryId: 'default', text: 'Requires approval' }), status: 'completed' }] : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: this.requests.length === 2 ? 'Background started' : 'Background complete' }] }];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `background-response-${this.requests.length}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
  }
}
const event = (text: string): MessageEvent => MessageEventSchema.parse({ platform: 'local-test', platformType: 'telegram', sessionId: 'chat', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text }] });
async function fixture(work: (runtime: PriestessRuntime, model: BackgroundModel) => Promise<void>, maxContinuations = 1, pauseContinuation = false): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-background-'));
  const agent = AgentDefinitionSchema.parse({ id: 'original', displayName: 'Original', instructions: 'ORIGINAL_AGENT_ONLY', capabilities: ['chat', 'process.execute', 'process.pty', 'conversation.reset', 'conversation.stop', 'memory.write', 'admin'], resources: { executionEnvironment: 'local', tools: ['exec_command', 'memory_save'], memoryLibraries: ['default'] }, approvalTools: ['memory_save'], budget: { maxTokens: 1000, maxTurns: 6, timeoutMs: 6000, maxDelegations: maxContinuations } });
  const other = AgentDefinitionSchema.parse({ id: 'other', displayName: 'Other', instructions: 'OTHER_AGENT_ONLY', capabilities: ['chat'] });
  const grant = GrantSchema.parse({ platform: 'local-test', senderId: 'alice', maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities: agent.capabilities, resources: agent.resources });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent, other], grants: [grant], memoryLibraries: [{ id: 'default', displayName: 'Memory' }], executionEnvironments: [{ id: 'local', type: 'local', root: directory }], flow: { routing: { defaultAgentId: agent.id, rules: [{ id: 'other-route', textIncludes: 'route_to_other', agentId: other.id }] } } });
  const model = new BackgroundModel(pauseContinuation); const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  try { await work(runtime, model); } finally { await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
}
async function settleBackground(runtime: PriestessRuntime, minimumRuns: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (runtime.store.runs().length < minimumRuns && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 20));
  await runtime.idle();
}

void test('background completion stays on its originating Agent and inherits remaining token budget despite routing keywords', async () => fixture(async (runtime, model) => {
  const parent = runtime.submit(event('Start background work')); await runtime.idle();
  assert.equal(runtime.detail(parent.id).run.status, 'completed'); assert.equal(model.requests.length, 2);
  assert.throws(() => runtime.auth.requestState({ platform: 'local-test', sessionId: event('').sessionId, senderId: 'alice', sessionType: 'private' }, 'senior_operator'), /管理员分配/);
  await settleBackground(runtime, 2);
  const runs = runtime.store.runs(); assert.equal(runs.length, 2); assert.ok(runs.every(run => run.agentId === 'original')); assert.ok(runs.every(run => run.status === 'completed'));
  assert.equal(model.requests.length, 3); assert.match(model.requests[2]?.systemInstructions ?? '', /ORIGINAL_AGENT_ONLY/); assert.doesNotMatch(model.requests[2]?.systemInstructions ?? '', /OTHER_AGENT_ONLY/);
  assert.equal(model.requests[2]?.modelSettings.maxTokens, 990);
}));
void test('reset between background return and process exit prevents stale continuation', async () => fixture(async (runtime, model) => {
  const input = event('Start background work'); const parent = runtime.submit(input); await runtime.idle(); assert.equal(runtime.detail(parent.id).run.status, 'completed');
  const reset = runtime.submit(event('/reset')); await runtime.idle(); assert.equal(runtime.detail(reset.id).run.status, 'completed');
  assert.equal(runtime.store.generation(conversationKey({ platform: input.platform, sessionId: input.sessionId, senderId: input.senderId, sessionType: input.sessionType }, 'original')), 1);
  await new Promise<void>(resolve => setTimeout(resolve, 500)); await runtime.idle(); assert.equal(runtime.store.runs().length, 2); assert.equal(model.requests.length, 2);
}));
void test('zero continuation budget leaves completed background output available without starting a new Agent', async () => fixture(async (runtime, model) => {
  runtime.submit(event('Start background work')); await runtime.idle(); await new Promise<void>(resolve => setTimeout(resolve, 500)); await runtime.idle();
  assert.equal(runtime.store.runs().length, 1); assert.equal(model.requests.length, 2);
}, 0));
void test('a full-shell background task keeps its fixed assigned state and refuses self-requested changes', async () => fixture(async (runtime) => {
  const input = event('Start background work'); runtime.submit(input); await runtime.idle();
  assert.throws(() => runtime.auth.requestState({ platform: input.platform, sessionId: input.sessionId, senderId: input.senderId, sessionType: input.sessionType }, 'senior_operator'), /管理员分配/);
  await settleBackground(runtime, 2); const paused = runtime.store.runs().find(run => run.status === 'paused'); if (paused === undefined) throw new Error('Expected paused continuation');
  const saved = runtime.store.get('paused-inputs', paused.id, PersistedEngineInputSchema); if (saved === undefined) throw new Error('Missing persisted continuation');
  assert.equal(saved.agent.id, 'original'); assert.equal(saved.context.runtimeState, 'elite_operator'); assert.equal(saved.context.effectiveCapabilities.includes('admin'), true); assert.equal(saved.context.depth, 1);
}, 1, true));
void test('administrator reassignment revokes a completed shell task before its background continuation', async () => fixture(async (runtime,model) => {
  runtime.submit(event('Start background work'));await runtime.idle();
  runtime.auth.replaceGrants(runtime.config().grants.map(grant=>({...grant,state:'operator'})));
  await new Promise<void>(resolve=>setTimeout(resolve,700));await runtime.idle();
  assert.equal(runtime.store.runs().length,1);assert.equal(model.requests.length,2);
}));
