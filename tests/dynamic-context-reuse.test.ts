import assert from 'node:assert/strict';
import test from 'node:test';
import { protocol, tool, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { AuthorizationService, RuntimeStore, historyKey } from '../packages/core/src/index.js';

function fixture(options: { maxTurns?: number; approval?: boolean; followUp?: boolean } = {}) {
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'A', budget: { maxTurns: options.maxTurns ?? 6, tokenLimitMode: 'context' } });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const message = MessageEventSchema.parse({ platform: 'fixture', platformType: 'telegram', sessionType: 'private', sessionId: 'room', senderId: 'alice', botId: 'bot', messageId: 'initial', timestamp: 1, parts: [{ type: 'text', text: 'INITIAL_REQUEST' }] });
  const auth = new AuthorizationService([], store);
  const context = { runId: RunIdSchema.parse('context-reuse'), turnId: 'turn', principal: message, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(message, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: historyKey(context) } };
  const requests: ModelRequest[] = [];
  let snapshots = 0;
  let effects = 0;
  let followUpSent = false;
  const model: Model = {
    getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Unexpected summary')); },
    async *getStreamedResponse(request): AsyncIterable<protocol.StreamEvent> {
      const index = requests.length;
      requests.push(request);
      const output = request.tools.length && index < 2
        ? [{ type: 'function_call', name: 'operation', callId: `operation-${index}`, arguments: '{}', status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done' }] }];
      yield await Promise.resolve(protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${index}`, usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 }, output } }));
    },
  };
  const parameters = z.object({});
  const engine = new AgentsSdkEngine({
    store, config: () => config, secret: () => undefined, model,
    assertCurrent: candidate => auth.assert(candidate.context, 'chat', candidate.agent),
    tools: () => Promise.resolve([tool<typeof parameters, SdkLocalContext>({ name: 'operation', description: 'Update the fixture memory.', parameters, needsApproval: options.approval ?? false, execute: () => { effects++; return `RESULT_${effects}`; } })]),
    dynamicContext: current => {
      snapshots++;
      return Promise.resolve({ scope: current.session.id, components: [{ name: 'memory', value: `SNAPSHOT_${snapshots} MEMORY_${effects} QUERY_${current.message.messageId}` }] });
    },
    followUps: () => {
      if (!options.followUp || !effects || followUpSent) return Promise.resolve([]);
      followUpSent = true;
      return Promise.resolve([{ ...input, message: { ...message, messageId: 'additional', parts: [{ type: 'text', text: 'ADDITIONAL_REQUEST' }] } }]);
    },
  });
  return { store, input, engine, requests, snapshots: () => snapshots, effects: () => effects };
}

function dynamicText(request: ModelRequest): string {
  assert.ok(Array.isArray(request.input));
  const values = request.input.flatMap(item => 'role' in item && item.role === 'user' && Array.isArray(item.content)
    ? item.content.flatMap(part => part.type === 'input_text' && part.text.startsWith('<dynamic_context ') ? [part.text] : [])
    : []);
  assert.equal(values.length, 1);
  return values[0] ?? '';
}

await test('one snapshot serves each model round and later rounds retain results while refreshing changed memory and follow-ups', async () => {
  const f = fixture({ followUp: true });
  try {
    const result = await f.engine.run(f.input, () => undefined);
    assert.equal(result.status, 'completed');
    assert.equal(f.requests.length, 3);
    assert.equal(f.snapshots(), 3);
    assert.equal(f.effects(), 2);
    for (const [index, request] of f.requests.entries()) assert.match(dynamicText(request), new RegExp(`SNAPSHOT_${index + 1} MEMORY_${index}`));
    const second = f.requests[1]; const third = f.requests[2]; assert.ok(second && third);
    assert.match(dynamicText(second), /QUERY_additional/);
    assert.match(JSON.stringify(third.input), /INITIAL_REQUEST/);
    assert.match(JSON.stringify(third.input), /ADDITIONAL_REQUEST/);
    assert.match(JSON.stringify(third.input), /RESULT_1/);
    assert.match(JSON.stringify(third.input), /RESULT_2/);
    const history = f.store.get('sdk-history', f.input.session.id, protocol.ModelItem.array());
    assert.doesNotMatch(JSON.stringify(history), /dynamic_context|SNAPSHOT_/);
  } finally { f.store.close(); }
});

await test('tool-free finalization prepares one fresh snapshot after the last tool result', async () => {
  const f = fixture({ maxTurns: 1 });
  try {
    const result = await f.engine.run(f.input, () => undefined);
    assert.equal(result.status, 'completed');
    assert.equal(f.snapshots(), 2);
    assert.equal(f.effects(), 1);
    const final = f.requests[1]; assert.ok(final);
    assert.deepEqual(final.tools, []);
    assert.match(dynamicText(final), /SNAPSHOT_2 MEMORY_1/);
    assert.match(JSON.stringify(final.input), /RESULT_1/);
  } finally { f.store.close(); }
});

await test('approval resumption rebuilds dynamic state after the approved effect without repeating earlier model snapshots', async () => {
  const f = fixture({ approval: true });
  try {
    const paused = await f.engine.run(f.input, () => undefined);
    assert.equal(paused.status, 'paused'); assert.ok(paused.state);
    assert.equal(f.snapshots(), 1); assert.equal(f.effects(), 0);
    const resumed = await f.engine.resume(f.input, paused.state, true, () => undefined);
    assert.equal(resumed.status, 'paused');
    assert.equal(f.snapshots(), 2); assert.equal(f.effects(), 1);
    const request = f.requests[1]; assert.ok(request);
    assert.match(dynamicText(request), /SNAPSHOT_2 MEMORY_1/);
  } finally { f.store.close(); }
});
