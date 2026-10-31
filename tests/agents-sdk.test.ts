import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, tool, type Model, type ModelRequest, type ModelResponse, type Tool } from '@openai/agents';
import { z } from 'zod';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillResources } from '../packages/adapters/src/resources/skills.js';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { SqliteAgentSession } from '../packages/adapters/src/agents/session.js';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunEvent } from '../packages/contracts/src/index.js';
import { AuthorizationService, RuntimeStore, historyKey } from '../packages/core/src/index.js';

class ScriptedModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: (request: ModelRequest, index: number) => Promise<protocol.StreamEvent[]>) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Tests require actual streaming SDK execution')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request);
    for (const event of await this.script(request, this.requests.length - 1)) yield event;
  }
}
function completion(output: unknown[], id = 'response'): protocol.StreamEvent {
  return protocol.StreamEvent.parse({ type: 'response_done', response: { id, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
}
function textCompletion(text: string, id = 'response'): protocol.StreamEvent { return completion([{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }], id); }
function functionCall(name: string, args: unknown, callId = 'call'): protocol.StreamEvent { return completion([{ type: 'function_call', name, arguments: JSON.stringify(args), callId, status: 'completed' }], `response-${callId}`); }
function fixture(model: Model, tools: (input: EngineInput) => Tool<SdkLocalContext>[] = () => []) {
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Test Agent', instructions: 'Act on the current user request.', capabilities: ['chat'] });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: 'agent', rules: [] } } });
  const auth = new AuthorizationService([], store); const controller = new AbortController();
  const message = MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'group', sessionType: 'group', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'Current request' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, senderId: message.senderId };
  const context = { runId: RunIdSchema.parse('run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: controller.signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '<memory>Likes tea</memory>', session: { engine: 'agents_sdk', version: '0.21.0', id: historyKey(context) } };
  const engine = new AgentsSdkEngine({ store, config: () => config, secret: () => undefined, assertCurrent: candidate => auth.assert(candidate.context, 'chat', candidate.agent), tools: candidate => Promise.resolve(tools(candidate)), model });
  return { store, agent, auth, input, engine, controller };
}

void test('official SDK emits actual delta, completes one model loop and persists its session', async () => {
  const model = new ScriptedModel(() => Promise.resolve([{ type: 'output_text_delta', delta: 'Hello ' }, { type: 'output_text_delta', delta: 'world' }, textCompletion('Hello world')]));
  const { store, input, engine } = fixture(model); const events: RunEvent[] = [];
  const result = await engine.run(input, event => events.push(event));
  assert.equal(result.text, 'Hello world'); assert.equal(result.status, 'completed'); assert.equal(result.inputTokens, 2);
  assert.deepEqual(events.filter(event => event.type === 'message_delta').map(event => event.text), ['Hello ', 'world']);
  assert.deepEqual(events.map(event => event.sequence), events.map((_event, index) => index));
  assert.ok((await new SqliteAgentSession(store, input.session.id, () => undefined).getItems()).length >= 2);
  assert.equal(model.requests[0]?.tracing, false); store.close();
});
void test('SDK directly executes typed tools with trusted local context and preserves structured output', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([index === 0 ? functionCall('lookup', { keyword: 'tea' }) : textCompletion('Found tea')]));
  const argumentsSchema = z.object({ keyword: z.string() }); let invoked = 0;
  const { store, input, engine } = fixture(model, current => [tool<typeof argumentsSchema, SdkLocalContext>({ name: 'lookup', description: 'Look up a value.', parameters: argumentsSchema, execute: (args, sdkContext) => { invoked += 1; assert.equal(args.keyword, 'tea'); assert.equal(sdkContext?.context.runId, current.context.runId); return { items: [{ name: 'tea', count: 1 }] }; } })]);
  const result = await engine.run(input, () => undefined);
  assert.equal(invoked, 1); assert.equal(model.requests.length, 2); assert.equal(result.text, 'Found tea');
  assert.match(JSON.stringify(model.requests[1]?.input), /tea/); assert.doesNotMatch(JSON.stringify(model.requests[0]?.input), /grantVersion|effectiveCapabilities/); store.close();
});
void test('changing dynamic recall continues the same session while another group sender gets isolated history', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([textCompletion(`answer-${index}`, `response-${index}`)]));
  const { store, input, engine } = fixture(model);
  await engine.run(input, () => undefined);
  await engine.run({ ...input, context: { ...input.context, runId: RunIdSchema.parse('next'), turnId: 'next-turn' }, additionalContext: '<memory>Likes books</memory>' }, () => undefined);
  assert.match(JSON.stringify(model.requests[1]?.input), /answer-0/); assert.match(JSON.stringify(model.requests[1]?.input), /Likes books/);
  const bob = { ...input.context, runId: RunIdSchema.parse('bob-run'), turnId: 'bob-turn', principal: { ...input.context.principal, senderId: 'bob' } };
  await engine.run({ ...input, context: bob, message: { ...input.message, senderId: 'bob' }, session: { ...input.session, id: historyKey(bob) }, additionalContext: '' }, () => undefined);
  assert.doesNotMatch(JSON.stringify(model.requests[2]?.input), /Likes tea|Likes books|answer-0/); store.close();
});
void test('SDK pause state is persistent, approval resumes the exact tool and cannot replay it twice', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([index === 0 ? functionCall('write_record', { text: 'approved' }) : textCompletion('Saved')]));
  const argumentsSchema = z.object({ text: z.string() }); let invoked = 0;
  const { store, input, engine } = fixture(model, () => [tool<typeof argumentsSchema, SdkLocalContext>({ name: 'write_record', description: 'Write a record after approval.', parameters: argumentsSchema, needsApproval: true, execute: args => { invoked += 1; return args.text; } })]);
  const paused = await engine.run(input, () => undefined); assert.equal(paused.status, 'paused'); assert.equal(invoked, 0);
  if (paused.state === undefined) throw new Error('Missing saved approval state');
  const resumed = await engine.resume(input, paused.state, true, () => undefined);
  assert.equal(resumed.status, 'completed'); assert.equal(invoked, 1); assert.equal(resumed.text, 'Saved');
  await assert.rejects(engine.resume(input, paused.state, true, () => undefined), /stale|owned/); assert.equal(invoked, 1); store.close();
});
void test('approval resume rechecks revocation and rejects incompatible engine/session versions', async () => {
  const model = new ScriptedModel(() => Promise.resolve([functionCall('restricted', {})])); const empty = z.object({}); let invoked = 0;
  const { store, input, engine, auth } = fixture(model, () => [tool<typeof empty, SdkLocalContext>({ name: 'restricted', description: 'Restricted tool', parameters: empty, needsApproval: true, execute: () => { invoked += 1; return 'done'; } })]);
  await assert.rejects(engine.run({ ...input, session: { ...input.session, version: 'old' } }, () => undefined), /incompatible/);
  const paused = await engine.run(input, () => undefined); if (paused.state === undefined) throw new Error('Missing approval');
  auth.replaceGrants([]); await assert.rejects(engine.resume(input, paused.state, true, () => undefined), /Authorization changed/); assert.equal(invoked, 0); store.close();
});
void test('public AbortSignal cancels model I/O and yields cancelled rather than completed', async () => {
  let entered: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const model = new ScriptedModel(request => new Promise<protocol.StreamEvent[]>((_resolve, reject: (reason: Error) => void) => {
    entered?.(); const signal = request.signal; if (signal === undefined) { reject(new Error('SDK did not pass a signal')); return; }
    const abort = (): void => reject(new Error('Model transport aborted'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  }));
  const { store, input, engine, controller } = fixture(model); const events: RunEvent[] = [];
  const running = engine.run(input, event => events.push(event)); await waiting; controller.abort();
  const result = await running; assert.equal(result.status, 'cancelled'); assert.equal(events.some(event => event.type === 'completed'), false); assert.equal(events.at(-1)?.type, 'cancelled'); store.close();
});
void test('image and parsed file use SDK content parts; unprepared media fails closed', async () => {
  const model = new ScriptedModel(() => Promise.resolve([textCompletion('Saw image')])); const { store, input, engine } = fixture(model);
  await engine.run({ ...input, message: { ...input.message, parts: [{ type: 'image', url: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }, { type: 'file', url: 'artifact:abc', name: 'note.md', mimeType: 'text/markdown', extractedText: 'untrusted document text' }] } }, () => undefined);
  const serialized = JSON.stringify(model.requests[0]?.input); assert.match(serialized, /input_image/); assert.match(serialized, /untrusted document text/);
  await assert.rejects(engine.run({ ...input, message: { ...input.message, parts: [{ type: 'image', url: 'https://unprepared.example/image.png', mimeType: 'image/png' }] } }, () => undefined), /authorized media/); store.close();
});
void test('SDK session limits and compaction preserve schema validation and current authorization', async () => {
  const store = new RuntimeStore(':memory:'); let permitted = true;
  const session = new SqliteAgentSession(store, 'scope', () => { if (!permitted) throw new Error('Revoked'); });
  await session.addItems([{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }]);
  assert.equal((await session.getItems(1)).length, 1); assert.equal((await session.getItems(0)).length, 0);
  await session.replaceHistoryWithCompaction([{ role: 'user', content: 'summary' }]); assert.equal((await session.getItems()).length, 1);
  const popping = session.popItem(); permitted = false;
  await assert.rejects(popping, /Revoked/); permitted = true;
  assert.equal((await session.getItems()).length, 1); store.close();
});
void test('cancellation reaches a waiting local SDK tool and prevents a late final reply', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([index === 0 ? functionCall('wait_tool', {}) : textCompletion('late reply')]));
  const empty = z.object({}); let toolStarted: (() => void) | undefined; let cancelled = false;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  const { store, input, engine, controller } = fixture(model, current => [tool<typeof empty, SdkLocalContext>({ name: 'wait_tool', description: 'Wait for an owned operation.', parameters: empty, execute: () => new Promise<string>(resolve => {
    toolStarted?.(); const abort = (): void => { cancelled = true; resolve('cancelled'); };
    if (current.context.signal.aborted) abort(); else current.context.signal.addEventListener('abort', abort, { once: true });
  }) })]);
  const events: RunEvent[] = []; const running = engine.run(input, event => events.push(event)); await started; controller.abort();
  assert.equal((await running).status, 'cancelled'); assert.equal(cancelled, true); assert.equal(events.some(event => event.type === 'completed'), false); store.close();
});
void test('cumulative model token budget blocks exhausted tool responses before side effects dispatch', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([functionCall('side_effect', {}, `effect-${index}`)]));
  const empty = z.object({}); let effects = 0;
  const { store, input, engine } = fixture(model, () => [tool<typeof empty, SdkLocalContext>({ name: 'side_effect', description: 'Count an effect', parameters: empty, execute: () => { effects += 1; return 'executed'; } })]);
  const events: RunEvent[] = [];
  await assert.rejects(engine.run({ ...input, context: { ...input.context, budget: { ...input.context.budget, maxTokens: 9 } } }, event => events.push(event)), /budget/);
  assert.equal(model.requests.length, 2); assert.equal(effects, 1); assert.equal(model.requests[1]?.modelSettings.maxTokens, 4); assert.equal(events.some(event => event.type === 'completed'), false);
  store.close();
});

void test('persona examples persist once as reference anchors across turns without becoming assistant dialogue', async () => {
  const model = new ScriptedModel((_request, index) => Promise.resolve([textCompletion(`live-answer-${index}`, `response-${index}`)]));
  const { store, input, engine } = fixture(model);
  const agent = AgentDefinitionSchema.parse({ ...input.agent, persona: 'Configured persona unique', exampleDialogs: [{ role: 'user', content: 'example-user-unique', scene:'First scene' }, { role: 'assistant', content: 'example-assistant-unique' }, {role:'user',content:'example-follow-up'}, {role:'assistant',content:'example-follow-up-answer'}, {role:'user',content:'example-new-scene',scene:'Second scene'}, {role:'assistant',content:'example-new-answer'}] });
  try {
    await engine.run({ ...input, agent }, () => undefined);
    await engine.run({ ...input, agent, context: { ...input.context, runId: RunIdSchema.parse('next-example-turn'), turnId: 'next' } }, () => undefined);
    for (const request of model.requests) {
      assert.ok(Array.isArray(request.input));
      assert.equal(JSON.stringify(request.input).split('example-user-unique').length - 1, 1);
      assert.equal(JSON.stringify(request.input).split('example-assistant-unique').length - 1, 1);
      assert.equal(JSON.stringify(request.input).split('Configured persona unique').length - 1, 1);
      assert.doesNotMatch(request.systemInstructions ?? '', /Configured persona unique|example-user-unique/);
      const references = request.input.filter(item => JSON.stringify(item).includes('example-user-unique'));
      assert.equal(references.length, 1);
      const reference = references[0]; assert.ok(reference && 'role' in reference && reference.role === 'user');
      assert.match(JSON.stringify(reference), /context_anchor.*persona_examples/);
      assert.match(JSON.stringify(reference), /First scene/); assert.match(JSON.stringify(reference), /Second scene/);
      assert.match(JSON.stringify(reference), /example-follow-up/);
      for (const item of request.input) if ('role' in item && item.role === 'assistant') assert.doesNotMatch(JSON.stringify(item), /example-assistant-unique|example-follow-up-answer|example-new-answer/);
    }
    const history = await new SqliteAgentSession(store, input.session.id, () => undefined).getItems();
    assert.equal(JSON.stringify(history).split('example-user-unique').length - 1, 1);
    assert.equal(JSON.stringify(history).split('Configured persona unique').length - 1, 1);
    assert.match(JSON.stringify(history), /context_anchor.*persona_examples/);
    assert.match(JSON.stringify(history), /live-answer-0/);
  } finally { store.close(); }
});

void test('persona skill selection restricts catalog and direct reads inside granted libraries including symlink aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'persona-skills-'));
  const model = new ScriptedModel(() => Promise.resolve([textCompletion('ok')]));
  const { store, input } = fixture(model);
  try {
    for (const name of ['allowed', 'denied']) { await mkdir(join(directory, name)); await writeFile(join(directory, name, 'SKILL.md'), `description: ${name}\n${name} contents`); }
    await symlink(join(directory, 'denied', 'SKILL.md'), join(directory, 'allowed', 'alias.md'));
    const configuration = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [input.agent], skillLibraries: [{ id: 'library', directory }], flow: { routing: { defaultAgentId: input.agent.id, rules: [] } } });
    const skills = new SkillResources(() => configuration, () => undefined);
    const limited: EngineInput = { ...input, agent: { ...input.agent, skillAllowlist: ['allowed'] }, context: { ...input.context, resources: { ...input.context.resources, skills: ['library'] } } };
    assert.deepEqual((await skills.list(limited)).map(item => item.name), ['allowed']);
    assert.match(await skills.read(limited, 'library', 'allowed/SKILL.md'), /allowed contents/);
    await assert.rejects(skills.read(limited, 'library', 'denied/SKILL.md'), /persona/);
    await assert.rejects(skills.read(limited, 'library', 'allowed/alias.md'), /persona/);
    await assert.rejects(skills.read(limited, 'other-library', 'allowed/SKILL.md'), /not authorized/);
    assert.deepEqual(await skills.list({ ...limited, agent: { ...limited.agent, skillAllowlist: [] } }), []);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
