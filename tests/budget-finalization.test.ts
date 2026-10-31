import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, tool, Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunEvent } from '../packages/contracts/src/index.js';
import { AuthorizationService, RuntimeStore, historyKey } from '../packages/core/src/index.js';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { BudgetedModel, RunBudgetError } from '../packages/adapters/src/agents/budget.js';
import { AgentsContextSummarizer } from '../packages/adapters/src/agents/context-summary.js';

function completion(text: string, inputTokens = 2, outputTokens = 3): protocol.StreamEvent {
  return protocol.StreamEvent.parse({ type: 'response_done', response: { id: crypto.randomUUID(), usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] } });
}
function call(inputTokens = 2, outputTokens = 3): protocol.StreamEvent {
  return protocol.StreamEvent.parse({ type: 'response_done', response: { id: crypto.randomUUID(), usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, output: [{ type: 'function_call', name: 'operation', arguments: '{}', callId: crypto.randomUUID(), status: 'completed' }] } });
}
class ScriptModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: (request: ModelRequest, index: number) => protocol.StreamEvent) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Use the streaming SDK path')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> { this.requests.push(request); yield await Promise.resolve(this.script(request, this.requests.length - 1)); }
}
function fixture(model: Model, options: { maxTokens?: number; maxTurns?: number; mode?: 'context' | 'cumulative'; approval?: boolean; examples?: boolean; childUsage?: boolean; toolResult?: (index: number) => string; followUpTexts?: readonly string[] } = {}) {
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', instructions: 'Use factual results.', capabilities: ['chat'], budget: { maxTokens: options.maxTokens ?? 100000, maxTurns: options.maxTurns ?? 12, tokenLimitMode: options.mode ?? 'cumulative' }, exampleDialogs: options.examples ? [{ role: 'user', content: 'EXAMPLE_NOT_A_CURRENT_TASK' }, { role: 'assistant', content: 'EXAMPLE_RESPONSE' }] : [] });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], connections: [{ id: agent.connectionId, apiKeyEnv: 'TEST_KEY' }], flow: { routing: { defaultAgentId: 'agent', rules: [] } } });
  const auth = new AuthorizationService([], store); const controller = new AbortController();
  const message = MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'group', sessionType: 'group', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'CURRENT_TASK' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, senderId: message.senderId };
  const context = { runId: RunIdSchema.parse('budget-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: controller.signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: 'PRIVATE_RECALL_NOT_FOR_FINALIZER', session: { engine: 'agents_sdk', version: '0.21.0', id: historyKey(context) } };
  let effects = 0; let followUpsTaken = false; const args = z.object({});
  const engine = new AgentsSdkEngine({ store, config: () => config, secret: () => undefined, assertCurrent: candidate => auth.assert(candidate.context, 'chat', candidate.agent), model, followUps: () => { if (followUpsTaken) return Promise.resolve([]); followUpsTaken = true; return Promise.resolve((options.followUpTexts ?? []).map((text, index) => ({ ...input, message: { ...input.message, messageId: `follow-up-${index}`, parts: [{ type: 'text', text }] } }))); }, tools: () => Promise.resolve([tool<typeof args, SdkLocalContext>({ name: 'operation', description: 'A visible operation.', parameters: args, needsApproval: options.approval ?? false, execute: (_args, sdk) => { effects++; if (options.childUsage) sdk?.usage.add(new Usage({ inputTokens: 3, outputTokens: 4 })); return options.toolResult?.(effects) ?? 'OPERATION_CONFIRMED'; } })]) });
  return { store, agent, config, input, engine, auth, controller, effects: () => effects };
}

void test('every model response emits usage exactly once, including a response blocked before tool dispatch', async () => {
  const model = new ScriptModel(() => call()); const f = fixture(model, { maxTokens: 9 }); const events: RunEvent[] = [];
  try {
    await assert.rejects(f.engine.run(f.input, event => events.push(event)), error => error instanceof RunBudgetError && error.used === 10 && error.limit === 9);
    assert.equal(f.effects(), 1);
    const usage = events.filter(event => event.type === 'usage');
    assert.deepEqual(usage.map(event => ({ input: event.inputTokens, output: event.outputTokens, source: event.source, call: event.modelCall })), [{ input: 2, output: 3, source: 'model', call: 1 }, { input: 2, output: 3, source: 'model', call: 2 }]);
    assert.ok(events.findIndex(event => event.type === 'failed') > events.findLastIndex(event => event.type === 'usage'));
  } finally { f.store.close(); }
});

void test('context mode permits cumulative usage above maxTokens while preserving the per-call output bound', async () => {
  const model = new ScriptModel((_request, index) => index < 3 ? call() : completion('done')); const f = fixture(model, { maxTokens: 9, mode: 'context' }); const events: RunEvent[] = [];
  try {
    const result = await f.engine.run(f.input, event => events.push(event));
    assert.equal(result.status, 'completed'); assert.equal(f.effects(), 3); assert.equal(result.inputTokens + result.outputTokens, 20);
    assert.equal(events.filter(event => event.type === 'usage').length, 4);
    assert.ok(model.requests.every(request => request.modelSettings.maxTokens === 9));
  } finally { f.store.close(); }
});

void test('cumulative reserve retains the original conversation and reference anchors in a tool-free request', async () => {
  const model = new ScriptModel((_request, index) => index === 0 ? call(7500, 200) : completion('Operation completed; further work needs another run.', 100, 20));
  const f = fixture(model, { maxTokens: 12000, examples: true }); const events: RunEvent[] = [];
  f.store.put('sdk-history', f.input.session.id, protocol.ModelItem.array().parse([{ role: 'user', content: 'OLD_HISTORY_NOT_FOR_FINALIZER' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Old answer' }] }]));
  try {
    const result = await f.engine.run(f.input, event => events.push(event));
    assert.equal(f.effects(), 1); assert.equal(model.requests.length, 2); assert.equal(result.text, 'Operation completed; further work needs another run.');
    const finish = model.requests[1]; assert.ok(finish); assert.deepEqual(finish.tools, []); assert.equal(finish.modelSettings.toolChoice, 'none');
    assert.match(JSON.stringify(finish.input), /CURRENT_TASK/); assert.match(JSON.stringify(finish.input), /OPERATION_CONFIRMED/);
    assert.match(JSON.stringify(finish.input), /EXAMPLE_NOT_A_CURRENT_TASK/); assert.match(JSON.stringify(finish.input), /OLD_HISTORY_NOT_FOR_FINALIZER/); assert.match(JSON.stringify(finish.input), /PRIVATE_RECALL_NOT_FOR_FINALIZER/);
    assert.equal(finish.systemInstructions, model.requests[0]?.systemInstructions);
    const usage = events.filter(event => event.type === 'usage'); assert.deepEqual(usage.map(event => event.source), ['model', 'finalization']);
    const modelCalls = events.filter(event => event.type === 'model_call');
    assert.deepEqual(modelCalls.map(event => [event.source, event.status, event.modelCall]), [['model', 'started', 1], ['model', 'completed', 1], ['finalization', 'started', 2], ['finalization', 'completed', 2]]);
    assert.equal(result.inputTokens + result.outputTokens, 7820); assert.ok(result.inputTokens + result.outputTokens <= f.input.context.budget.maxTokens);
    assert.match(JSON.stringify(f.store.get('sdk-history', f.input.session.id, protocol.ModelItem.array())), /Operation completed/);
  } finally { f.store.close(); }
});

void test('an already exhausted budget reports actual usage and a deterministic limit without another call or effects', async () => {
  const model = new ScriptModel(() => call(12000, 1)); const f = fixture(model, { maxTokens: 12000 }); const events: RunEvent[] = [];
  try {
    const result = await f.engine.run(f.input, event => events.push(event));
    assert.equal(model.requests.length, 1); assert.equal(f.effects(), 0); assert.equal(result.inputTokens + result.outputTokens, 12001);
    assert.match(result.text, /预算.*限制/); assert.match(result.text, /尚未完成/); assert.equal(events.filter(event => event.type === 'usage').length, 1);
  } finally { f.store.close(); }
});

void test('40 tool rounds reach a final tool-free answer without a 41st side effect', async () => {
  const model = new ScriptModel(request => request.tools.length ? call() : completion('Completed 40 operations.'));
  const f = fixture(model, { maxTurns: 40, mode: 'context' }); const events: RunEvent[] = [];
  try {
    const result = await f.engine.run(f.input, event => events.push(event));
    assert.equal(f.effects(), 40); assert.equal(model.requests.length, 41); assert.equal(result.text, 'Completed 40 operations.');
    assert.deepEqual(model.requests[40]?.tools, []); assert.equal(events.filter(event => event.type === 'usage' && event.source === 'finalization').length, 1);
  } finally { f.store.close(); }
});

void test('an approval pause never invokes finalization and approved work is not replayed', async () => {
  const model = new ScriptModel((_request, index) => index === 0 ? call() : completion('approved work finished'));
  const f = fixture(model, { approval: true }); const events: RunEvent[] = [];
  try {
    const paused = await f.engine.run(f.input, event => events.push(event)); assert.equal(paused.status, 'paused'); assert.ok(paused.state);
    assert.equal(f.effects(), 0); assert.equal(model.requests.length, 1); assert.equal(events.some(event => event.type === 'usage' && event.source === 'finalization'), false);
    const resumed = await f.engine.resume(f.input, paused.state, true, event => events.push(event));
    assert.equal(resumed.status, 'completed'); assert.equal(f.effects(), 1);
    assert.equal(events.filter(event => event.type === 'usage').reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0), 10);
    await assert.rejects(f.engine.resume(f.input, paused.state, true, () => {}), /stale|owned/); assert.equal(f.effects(), 1);
  } finally { f.store.close(); }
});

void test('compression usage is accounted before a cumulative budget exception', async () => {
  const model: Model = {
    getResponse(): Promise<ModelResponse> { return Promise.resolve({ usage: new Usage({ inputTokens: 20000, outputTokens: 1 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"summary":"test"}' }] }] }); },
    async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> { yield await Promise.resolve(completion('unused')); },
  };
  const f = fixture(model, { maxTokens: 20000 }); const usage: Usage[] = [];
  try {
    const summarizer = new AgentsContextSummarizer(f.input, { config: () => f.config, secret: () => undefined, assertCurrent: () => {}, model, usedTokens: () => 0, accountUsage: item => usage.push(item) });
    await assert.rejects(summarizer.summarize([{ role: 'user', content: 'summarize me' }], 1000), RunBudgetError);
    assert.equal(usage.length, 1); assert.equal(usage[0]?.inputTokens, 20000);
  } finally { f.store.close(); }
});

void test('budget model non-stream response observer runs before rejection', async () => {
  let observed = 0;
  const base: Model = { getResponse: () => Promise.resolve({ usage: new Usage({ inputTokens: 3, outputTokens: 2 }), output: [] }), async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> { yield await Promise.resolve(completion('unused')); } };
  const model = new BudgetedModel(base, 5, () => 0, { onUsage: usage => { observed += usage.inputTokens + usage.outputTokens; } });
  const source = new ScriptModel(request => completion(String(request.tools.length))); const f = fixture(source);
  try {
    await f.engine.run(f.input, () => {}); const request = source.requests[0]; assert.ok(request);
    await assert.rejects(model.getResponse(request), RunBudgetError); assert.equal(observed, 5);
  } finally { f.store.close(); }
});

void test('a too-small normal budget gives deterministic closure without a model call and retains the current request', async () => {
  const model = new ScriptModel(() => { throw new Error('No budget for another model call'); }); const f = fixture(model, { maxTokens: 1024 });
  try {
    const result = await f.engine.run(f.input, () => {}); assert.equal(result.status, 'completed'); assert.equal(model.requests.length, 0); assert.equal(f.effects(), 0);
    const history = f.store.get('sdk-history', f.input.session.id, protocol.ModelItem.array());
    assert.match(JSON.stringify(history), /CURRENT_TASK/); assert.match(result.text, /任务尚未完成/);
  } finally { f.store.close(); }
});

void test('context-mode compression uses the context window rather than the cumulative token cap', async () => {
  const model: Model = {
    getResponse: () => Promise.resolve({ usage: new Usage({ inputTokens: 20000, outputTokens: 1 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"summary":"result"}' }] }] }),
    async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> { yield await Promise.resolve(completion('unused')); },
  };
  const f = fixture(model, { maxTokens: 20000, mode: 'context' }); let used = 25000;
  try {
    const summarizer = new AgentsContextSummarizer(f.input, { config: () => f.config, secret: () => undefined, assertCurrent: () => {}, model, usedTokens: () => used, accountUsage: item => { used += item.inputTokens + item.outputTokens; } });
    assert.equal((await summarizer.summarize([{ role: 'user', content: 'summarize me' }], 1000)).text, 'result'); assert.equal(used, 45001);
  } finally { f.store.close(); }
});

void test('delegated cost is accounted once across approval resume and constrains the next cumulative model request', async () => {
  const model = new ScriptModel((_request, index) => index === 0 ? call() : completion('done'));
  const f = fixture(model, { maxTokens: 15, approval: true, childUsage: true }); const events: RunEvent[] = [];
  try {
    const paused = await f.engine.run(f.input, event => events.push(event)); assert.ok(paused.state);
    await assert.rejects(f.engine.resume(f.input, paused.state, true, event => events.push(event)), error => error instanceof RunBudgetError && error.used === 17);
    assert.equal(f.effects(), 1); assert.equal(model.requests[1]?.modelSettings.maxTokens, 3);
    const usages = events.filter(event => event.type === 'usage');
    assert.deepEqual(usages.map(event => event.source), ['model', 'delegation', 'model']);
    assert.equal(usages.reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0), 17);
    assert.equal(usages[1]?.modelCall, undefined); assert.equal(usages[2]?.modelCall, 2);
  } finally { f.store.close(); }
});

void test('a finalizer that asks for another operation cannot execute it or obtain another model round', async () => {
  const model = new ScriptModel((_request, index) => index === 0 ? call(7500, 200) : call());
  const f = fixture(model, { maxTokens: 12000 }); const events: RunEvent[] = [];
  try {
    const result = await f.engine.run(f.input, event => events.push(event));
    assert.equal(f.effects(), 1); assert.equal(model.requests.length, 2); assert.deepEqual(model.requests[1]?.tools, []);
    assert.match(result.text, /预算.*限制/); assert.match(result.text, /最终结论尚未完成/);
    assert.equal(events.filter(event => event.type === 'usage' && event.source === 'finalization').length, 1);
  } finally { f.store.close(); }
});

void test('step finalization preserves complete ordered tool results instead of lossy excerpts', async () => {
  const model = new ScriptModel((_request, index) => index === 0 ? call(1000, 100) : index === 1 ? call(6500, 200) : completion('A bounded answer based on the latest document result.'));
  const f = fixture(model, { mode: 'context', maxTurns: 2, toolResult: index => `${index === 1 ? 'EARLY_SEARCH_RESULT' : 'LATEST_PDF_BODY'} ${'document text '.repeat(500)}` });
  try {
    const result = await f.engine.run(f.input, () => {});
    assert.equal(f.effects(), 2); assert.equal(model.requests.length, 3); assert.equal(result.text, 'A bounded answer based on the latest document result.');
    const finish = model.requests[2]; assert.ok(finish); assert.deepEqual(finish.tools, []);
    const supplied = JSON.stringify(finish.input);
    assert.match(supplied, /CURRENT_TASK/); assert.match(supplied, /LATEST_PDF_BODY/); assert.match(supplied, /EARLY_SEARCH_RESULT/);
    assert.ok(supplied.indexOf('EARLY_SEARCH_RESULT') < supplied.indexOf('LATEST_PDF_BODY'));
    assert.equal((supplied.match(/document text/g) ?? []).length, 1000);
    assert.doesNotMatch(supplied, /result excerpt truncated|possibly truncated/);
    assert.equal(finish.systemInstructions, model.requests[0]?.systemInstructions);
  } finally { f.store.close(); }
});

void test('step finalization preserves original task and follow-ups in chronological order', async () => {
  const model = new ScriptModel(request => request.tools.length ? call(7500, 200) : completion('Used the newest correction.'));
  const f = fixture(model, { mode: 'context', maxTurns: 1, followUpTexts: [
    `OUTDATED_FIRST_UPDATE ${'old detail '.repeat(600)}`,
    `OLDER_SECOND_UPDATE ${'old detail '.repeat(600)}`,
    `RECENT_THIRD_UPDATE ${'recent detail '.repeat(600)}`,
    `LATEST_USER_CORRECTION ${'corrected detail '.repeat(600)}`,
  ] });
  try {
    const result = await f.engine.run(f.input, () => {}); assert.equal(result.text, 'Used the newest correction.');
    const finish = model.requests.at(-1); assert.ok(finish); assert.deepEqual(finish.tools, []);
    const supplied = JSON.stringify(finish.input);
    assert.match(supplied, /LATEST_USER_CORRECTION/); assert.match(supplied, /CURRENT_TASK/);
    assert.ok(supplied.indexOf('CURRENT_TASK') < supplied.indexOf('LATEST_USER_CORRECTION'));
    assert.match(supplied, /OUTDATED_FIRST_UPDATE/); assert.doesNotMatch(supplied, /task excerpt truncated|older updates omitted/);
    assert.equal(finish.systemInstructions, model.requests[0]?.systemInstructions);
  } finally { f.store.close(); }
});

void test('monitor-style finalization keeps quoted analysis, earlier image, full persona and tool evidence', async () => {
  const model = new ScriptModel(request => request.tools.length ? call() : completion('Identified using the quoted order and previous image.'));
  const f = fixture(model, { mode: 'context', maxTurns: 1, examples: true, toolResult: () => `${'evidence '.repeat(700)}EXACT_MODEL_Q27_END` });
  const image = 'data:image/png;base64,aGVsbG8=';
  const agent = { ...f.agent, persona: `${'人格内容。'.repeat(300)}PERSONA_END_MUST_SURVIVE` };
  const input: EngineInput = { ...f.input, agent, additionalContext: '<context_unit name="quoted_message">AOC 27 英寸 2K 180Hz，718.2 元，引用原分析</context_unit>', message: { ...f.input.message, parts: [{ type: 'quote', messageId: 'quoted-bot-reply', text: 'AOC order analysis', availability: 'available' }, { type: 'text', text: '搜一下这个型号的显示器' }] } };
  f.store.put('sdk-history', input.session.id, protocol.ModelItem.array().parse([
    { role: 'user', content: [{ type: 'input_text', text: '看看这个' }, { type: 'input_image', image }] },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'AOC order analysis' }] },
  ]));
  try {
    const result = await f.engine.run(input, () => {}); assert.equal(result.status, 'completed'); assert.equal(f.effects(), 1);
    const finish = model.requests[1]; assert.ok(finish); const supplied = JSON.stringify(finish.input);
    assert.match(supplied, /718.2 元/); assert.match(supplied, /搜一下这个型号的显示器/); assert.match(supplied, /看看这个/);
    assert.ok(supplied.includes(image)); assert.match(supplied, /EXACT_MODEL_Q27_END/); assert.match(supplied, /PERSONA_END_MUST_SURVIVE/);
    assert.match(supplied, /EXAMPLE_NOT_A_CURRENT_TASK/); assert.match(supplied, /function_call_result/);
    assert.equal(finish.systemInstructions, model.requests[0]?.systemInstructions); assert.deepEqual(finish.tools, []);
    assert.equal((supplied.match(/EXACT_MODEL_Q27_END/g) ?? []).length, 1);
  } finally { f.store.close(); }
});

void test('insufficient cumulative allowance refuses a lossy reconstructed finalization', async () => {
  const model = new ScriptModel(() => call(7500, 200));
  const f = fixture(model, { maxTokens: 12000, toolResult: () => 'large evidence '.repeat(5000) });
  try {
    const result = await f.engine.run(f.input, () => {});
    assert.equal(model.requests.length, 1); assert.equal(f.effects(), 1);
    assert.match(result.text, /任务的最终结论尚未完成/);
  } finally { f.store.close(); }
});
