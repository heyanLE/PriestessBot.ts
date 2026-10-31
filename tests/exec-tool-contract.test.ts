import assert from 'node:assert/strict';
import test from 'node:test';
import { protocol, RunContext as SdkContext, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunContext, type RunEvent } from '../packages/contracts/src/index.js';
import { AuthorizationService, KnowledgeService, MemoryService, RuntimeStore, historyKey } from '../packages/core/src/index.js';
import { buildAgentTools } from '../packages/adapters/src/agents/tools.js';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { ExecutionService, type ProcessSnapshot } from '../packages/adapters/src/execution/environment.js';
import { SdkDockerExecutionError } from '../packages/adapters/src/execution/sdk-docker.js';
import { CommandPolicyError } from '../packages/core/src/command-policy.js';
import { SkillResources } from '../packages/adapters/src/resources/skills.js';

interface ExecutionCall { readonly name: string; readonly text?: string; readonly id?: string; readonly offset?: number; readonly limit?: number; readonly outputTokens?: number; readonly yieldMs?: number; }
class RecordingExecution extends ExecutionService {
  readonly calls: ExecutionCall[] = [];
  failure: Error | undefined;
  constructor() { super({ backend: 'local', root: '/unused-exec-contract-workspace' }, () => undefined); }
  private recorded(call: ExecutionCall): ProcessSnapshot { this.calls.push(call); return { id: 'owned-process', status: 'running', output: 'fixture output', offset: 14, truncated: false }; }
  override execute(_context: RunContext, text: string, yieldMs = 1000, outputTokens = 10000): Promise<ProcessSnapshot> { return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.recorded({ name: 'execute', text, yieldMs, outputTokens })); }
  override writeStdin(_context: RunContext, id: string, text: string, outputTokens = 10000, yieldMs = 1000): ProcessSnapshot { return this.recorded({ name: 'stdin', id, text, outputTokens, yieldMs }); }
  override poll(_context: RunContext, id: string, offset = 0, outputTokens = 10000, yieldMs = 1000): ProcessSnapshot { return this.recorded({ name: 'poll', id, offset, outputTokens, yieldMs }); }
  override readOutput(_context: RunContext, id: string, offset = 0, limit = 40000, outputTokens = 10000): ProcessSnapshot { return this.recorded({ name: 'read', id, offset, limit, outputTokens }); }
  override kill(_context: RunContext, id: string): ProcessSnapshot { return this.recorded({ name: 'kill', id }); }
}
function fixture(approval = false) {
  const store = new RuntimeStore(':memory:');
  const names = ['exec_command', 'write_stdin', 'process_poll', 'process_kill', 'process_read_output'];
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', capabilities: ['chat', 'process.execute', 'process.pty'], resources: { tools: names, executionEnvironment: 'local' }, approvalTools: approval ? ['exec_command'] : [] });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const message = MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'room', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'Execute a command' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
  const auth = new AuthorizationService([GrantSchema.parse({ ...principal, maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities: agent.capabilities, resources: agent.resources })], store);
  const controller = new AbortController();
  const context: RunContext = { runId: RunIdSchema.parse('contract-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: controller.signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '', session: { id: historyKey(context), engine: 'agents_sdk', version: '0.21.0' } };
  const execution = new RecordingExecution(); const events: RunEvent[] = [];
  const services = { store, auth, execution: () => execution, memory: new MemoryService(store, auth), knowledge: new KnowledgeService(store, auth), skills: new SkillResources(() => config, () => undefined), delegate: () => Promise.reject(new Error('Unexpected delegation')), attachFile: () => Promise.reject(new Error('Unexpected attachment')) };
  const tools = buildAgentTools(input, services, event => events.push(event));
  const find = (name: string) => { const result = tools.find(item => item.name === name); assert.ok(result?.type === 'function'); return result; };
  const sdk = new SdkContext<SdkLocalContext>({ runId: context.runId });
  const invoke = (name: string, args: unknown) => find(name).invoke(sdk, JSON.stringify(args));
  const engine = (model: Model) => new AgentsSdkEngine({ config: () => config, store, secret: () => undefined, assertCurrent: candidate => auth.assert(candidate.context, 'chat', candidate.agent), tools: candidate => Promise.resolve(buildAgentTools(candidate, services, event => events.push(event))), model });
  return { store, auth, controller, input, execution, events, find, sdk, invoke, engine };
}
const Failure = z.object({ status: z.literal('rejected'), error: z.object({ code: z.string(), field: z.string().optional(), message: z.string() }) });
function failure(value: unknown) { assert.equal(typeof value, 'string'); if (typeof value !== 'string') throw new Error('Expected serialized error'); const json: unknown = JSON.parse(value); return Failure.parse(json); }

void test('execution schemas expose canonical names and bounded numeric fields without duplicate aliases', () => {
  const f = fixture();
  try {
    for (const [name, expected] of [['exec_command', ['cmd', 'max_output_tokens', 'yield_time_ms']], ['write_stdin', ['session_id', 'chars', 'max_output_tokens', 'yield_time_ms']], ['process_poll', ['session_id', 'offset', 'max_output_tokens', 'yield_time_ms']], ['process_kill', ['session_id']], ['process_read_output', ['session_id', 'offset', 'max_output_tokens', 'limit']]] as const) {
      const schema = z.object({ properties: z.record(z.string(), z.unknown()), additionalProperties: z.literal(false) }).parse(f.find(name).parameters);
      assert.deepEqual(Object.keys(schema.properties).sort(), [...expected].sort());
    }
    const parameters: unknown = f.find('exec_command').parameters;
    assert.match(JSON.stringify(parameters), /"maximum":30000/); assert.match(JSON.stringify(parameters), /"minimum":1/);
  } finally { f.store.close(); }
});

void test('current and legacy command arguments normalize harmless output/wait budgets before execution', async () => {
  const f = fixture();
  try {
    await f.invoke('exec_command', { cmd: 'printf canonical', yield_time_ms: 30000, max_output_tokens: 100 });
    await f.invoke('exec_command', { command: 'printf legacy', yield_time_ms: 90000, max_output_tokens: 90000 });
    await f.invoke('exec_command', { cmd: 'printf defaults', max_output_tokens: null, yield_time_ms: null });
    assert.deepEqual(f.execution.calls, [
      { name: 'execute', text: 'printf canonical', yieldMs: 30000, outputTokens: 256 },
      { name: 'execute', text: 'printf legacy', yieldMs: 30000, outputTokens: 40000 },
      { name: 'execute', text: 'printf defaults', yieldMs: 1000, outputTokens: 10000 },
    ]);
    assert.equal(f.events.filter(event => event.type === 'tool' && event.status === 'completed').length, 3);
  } finally { f.store.close(); }
});

void test('invalid command arguments produce field diagnostics and failed events without executing or echoing input', async () => {
  const f = fixture();
  try {
    const cases = [
      { args: { cmd: 'SECRET_COMMAND_URL', yield_time_ms: 'soon' }, field: 'yield_time_ms' },
      { args: { cmd: 'SECRET_COMMAND_URL', yield_time_ms: -1 }, field: 'yield_time_ms' },
      { args: { cmd: 'SECRET_COMMAND_URL', yield_time_ms: 0.5 }, field: 'yield_time_ms' },
      { args: { cmd: 'SECRET_COMMAND_URL', max_output_tokens: 0 }, field: 'max_output_tokens' },
      { args: { cmd: 'SECRET_COMMAND_URL', max_output_tokens: '100' }, field: 'max_output_tokens' },
      { args: { yield_time_ms: 100 }, field: 'cmd' },
      { args: { cmd: 'SECRET_COMMAND_URL', command: 'CONFLICTING_SECRET' }, field: 'cmd' },
      { args: { cmd: 'SECRET_COMMAND_URL', SECRET_UNKNOWN_FIELD: true }, field: '$' },
    ];
    for (const item of cases) {
      const result = failure(await f.invoke('exec_command', item.args));
      assert.equal(result.error.code, 'invalid_arguments'); assert.equal(result.error.field, item.field);
    }
    const invalidJson = failure(await f.find('exec_command').invoke(f.sdk, '{SECRET_MALFORMED_JSON'));
    assert.equal(invalidJson.error.field, '$');
    assert.equal(f.execution.calls.length, 0); assert.equal(f.events.length, cases.length + 1);
    assert.ok(f.events.every(event => event.type === 'tool' && event.status === 'failed'));
    assert.doesNotMatch(JSON.stringify(f.events), /SECRET_|CONFLICTING_/);
    assert.match(JSON.stringify(f.events), /0\.\.30000/);
  } finally { f.store.close(); }
});

void test('session tools accept canonical and legacy IDs, input and continuation arguments', async () => {
  const f = fixture();
  try {
    await f.invoke('write_stdin', { session_id: 'owned-process', chars: 'new\n', yield_time_ms: 25, max_output_tokens: 1 });
    await f.invoke('write_stdin', { sessionId: 'owned-process', text: 'old\n' });
    await f.invoke('write_stdin', { session_id: 'owned-process' });
    await f.invoke('process_poll', { sessionId: 'owned-process', offset: 14, yield_time_ms: 50 });
    await f.invoke('process_read_output', { session_id: 'owned-process', offset: 4, limit: 8 });
    await f.invoke('process_kill', { sessionId: 'owned-process' });
    assert.deepEqual(f.execution.calls, [
      { name: 'stdin', id: 'owned-process', text: 'new\n', yieldMs: 25, outputTokens: 256 },
      { name: 'stdin', id: 'owned-process', text: 'old\n', yieldMs: 1000, outputTokens: 10000 },
      { name: 'stdin', id: 'owned-process', text: '', yieldMs: 1000, outputTokens: 10000 },
      { name: 'poll', id: 'owned-process', offset: 14, yieldMs: 50, outputTokens: 10000 },
      { name: 'read', id: 'owned-process', offset: 4, limit: 8, outputTokens: 10000 },
      { name: 'kill', id: 'owned-process' },
    ]);
    const conflict = failure(await f.invoke('write_stdin', { sessionId: 'old', session_id: 'new', chars: '' }));
    assert.equal(conflict.error.code, 'invalid_arguments'); assert.equal(f.execution.calls.length, 6);
  } finally { f.store.close(); }
});

void test('normalization never bypasses current run identity, revoked grants or cancellation', async () => {
  const f = fixture();
  try {
    const wrongRun = new SdkContext<SdkLocalContext>({ runId: 'different-run' });
    assert.equal(failure(await f.find('exec_command').invoke(wrongRun, JSON.stringify({ command: 'no' }))).error.code, 'forbidden');
    f.auth.replaceGrants([]);
    assert.equal(failure(await f.invoke('exec_command', { command: 'no' })).error.code, 'forbidden');
    f.controller.abort();
    assert.equal(failure(await f.invoke('write_stdin', { sessionId: 'owned-process', text: 'no' })).error.code, 'cancelled');
    assert.equal(f.execution.calls.length, 0);
  } finally { f.store.close(); }
});

class CommandModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly calls: readonly unknown[]) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streaming')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve();
    const index = this.requests.length; this.requests.push(request);
    const args = this.calls[index];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${index}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: args === undefined ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done' }] }] : [{ type: 'function_call', name: 'exec_command', arguments: JSON.stringify(args), callId: `command-${index}`, status: 'completed' }] } });
  }
}
void test('real SDK receives actionable validation failure then successfully retries the corrected command', async () => {
  const f = fixture();
  const model = new CommandModel([{ cmd: 'unused', yield_time_ms: 'too-long' }, { cmd: 'printf recovered', max_output_tokens: 100 }]);
  try {
    const result = await f.engine(model).run(f.input, () => undefined);
    assert.equal(result.status, 'completed'); assert.equal(f.execution.calls.length, 1);
    const retryRequest = JSON.stringify(model.requests[1]?.input);
    assert.match(retryRequest, /invalid_arguments/); assert.match(retryRequest, /yield_time_ms/);
    assert.doesNotMatch(retryRequest, /An error occurred while running the tool/);
    assert.equal(f.events.filter(event => event.type === 'tool' && event.status === 'failed').length, 1);
  } finally { f.store.close(); }
});

void test('real SDK still pauses legacy calls for approval and resumes the exact approved operation', async () => {
  const f = fixture(true); const model = new CommandModel([{ command: 'printf approved' }]); const engine = f.engine(model);
  try {
    const paused = await engine.run(f.input, () => undefined);
    assert.equal(paused.status, 'paused'); assert.equal(f.execution.calls.length, 0); assert.ok(paused.state);
    const resumed = await engine.resume(f.input, paused.state, true, () => undefined);
    assert.equal(resumed.status, 'completed'); assert.equal(f.execution.calls.length, 1);
    assert.equal(f.execution.calls[0]?.text, 'printf approved');
    await assert.rejects(engine.resume(f.input, paused.state, true, () => undefined), /stale|owned/);
    assert.equal(f.execution.calls.length, 1);
  } finally { f.store.close(); }
});

void test('Docker setup failures preserve safe reason codes while unknown execution errors never echo commands or signed URLs', async () => {
  const f = fixture();
  const failed = z.object({ status: z.literal('failed'), error: z.object({ code: z.string(), message: z.string() }) });
  const parse = (value: unknown) => { assert.equal(typeof value, 'string'); if (typeof value !== 'string') throw new Error('Expected serialized result'); const json: unknown = JSON.parse(value); return failed.parse(json); };
  try {
    f.execution.failure = new CommandPolicyError('普通与资深干员的命令必须在 Docker 执行环境运行。');
    const policy = parse(await f.invoke('exec_command', { cmd: 'pwd' }));
    assert.equal(policy.error.code, 'command_not_allowed'); assert.match(policy.error.message, /Docker/);
    f.execution.failure = new SdkDockerExecutionError('start_failed', 'Docker SDK setup failed: verify Docker access and image GNU utilities.');
    const startup = parse(await f.invoke('exec_command', { cmd: 'SECRET_COMMAND' }));
    assert.equal(startup.error.code, 'start_failed'); assert.match(startup.error.message, /Docker access/);
    f.execution.failure = new Error('https://signed.invalid/download?secret=PRIVATE_TOKEN; SECRET_COMMAND');
    const unknown = parse(await f.invoke('exec_command', { cmd: 'SECRET_COMMAND' }));
    assert.equal(unknown.error.code, 'execution_failed'); assert.match(unknown.error.message, /No network or sandbox restriction has been established/);
    assert.doesNotMatch(JSON.stringify([startup, unknown, f.events]), /SECRET_COMMAND|PRIVATE_TOKEN|signed.invalid/);
    assert.equal(f.events.filter(event => event.type === 'tool' && event.status === 'failed').length, 3);
  } finally { f.store.close(); }
});
