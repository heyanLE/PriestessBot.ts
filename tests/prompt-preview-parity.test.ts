import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { AuthorizationService, RuntimeStore, historyKey } from '../packages/core/src/index.js';
import { ManagementService } from '../packages/core/src/management.js';
import { AgentsSdkEngine } from '../packages/adapters/src/agents/engine.js';
import { effectivePrompt } from '../apps/server/src/search-http.js';

class PreviewModel implements Model {
  readonly requests: ModelRequest[] = [];
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Streaming fixture expected')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request);
    await Promise.resolve();
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${this.requests.length}`, usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Fixture answer' }] }] } });
  }
}

void test('static prompt preview matches the real SDK root and persona anchors without claiming to include dynamic context', async () => {
  const store = new RuntimeStore(':memory:'); const management = new ManagementService(store); const model = new PreviewModel();
  const base = AgentDefinitionSchema.parse({ id: 'preview-agent', displayName: 'Preview', instructions: 'Root supplement with literal token=fixture-value.', persona: 'Unused inline fallback' });
  const persona = management.savePersona({ name: 'Bound persona', instructions: 'Current bound persona body.', exampleDialogs: [{ role: 'user', content: 'First reference question', scene: 'Reference scene' }, { role: 'assistant', content: 'First reference answer' }, { role: 'user', content: 'Follow-up reference' }, { role: 'assistant', content: 'Follow-up answer' }] });
  management.bindPersona(base.id, persona.id, 0);
  const agent = management.resolveAgent(base);
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [base], flow: { routing: { defaultAgentId: base.id, rules: [] } } });
  const message = MessageEventSchema.parse({ platform: 'fixture', platformType: 'telegram', sessionType: 'private', sessionId: 'chat', senderId: 'sender', senderName: 'Fixture', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'Actual user request' }] });
  const principal = { platform: message.platform, sessionType: message.sessionType, sessionId: message.sessionId, senderId: message.senderId };
  const auth = new AuthorizationService([], store);
  const context = { runId: RunIdSchema.parse('preview-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, message, context, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: historyKey(context) } };
  const engine = new AgentsSdkEngine({ store, config: () => config, secret: () => undefined, model, assertCurrent: candidate => auth.assert(candidate.context, 'chat', candidate.agent), tools: () => Promise.resolve([]), dynamicContext: current => Promise.resolve({ scope: current.session.id, components: [{ name: 'retrieved_context', value: 'live-memory-fixture', priority: 'normal' }] }) });
  try {
    const preview = effectivePrompt(management, base);
    assert.equal((await engine.run(input, () => undefined)).status, 'completed');
    const request = model.requests[0]; assert.ok(request); assert.equal(request.systemInstructions, preview.systemPrompt);
    assert.match(preview.systemPrompt, /literal token=fixture-value/);
    assert.doesNotMatch(preview.systemPrompt, /Current bound persona body|First reference question|Unused inline fallback/);
    assert.equal(preview.contextMessages.length, 2);
    assert.equal(typeof request.input, 'object');
    if (typeof request.input === 'string') throw new Error('Structured model input expected');
    const texts = request.input.flatMap(item => 'role' in item && item.role === 'user' && Array.isArray(item.content) ? item.content.flatMap(part => part.type === 'input_text' ? [part.text] : []) : []);
    for (const anchor of preview.contextMessages) {
      assert.equal(anchor.role, 'user');
      for (const part of anchor.content) assert.ok(texts.includes(part.text));
    }
    assert.match(texts.join('\n'), /live-memory-fixture|Actual user request/);
    assert.doesNotMatch(JSON.stringify(preview), /live-memory-fixture|Actual user request/);
    assert.equal(preview.contextMessages.some(item => item.content.some(part => part.text.includes('"title":"Reference scene"'))), true);
    const next = { ...input, context: { ...context, runId: RunIdSchema.parse('preview-next-run'), turnId: 'next-turn' } };
    assert.equal((await engine.run(next, () => undefined)).status, 'completed');
    const second = model.requests[1]; assert.ok(second); if (typeof second.input === 'string') throw new Error('Structured model input expected');
    const anchors = second.input.flatMap(item => 'role' in item && item.role === 'user' && Array.isArray(item.content) ? item.content.filter(part => part.type === 'input_text' && part.text.startsWith('<context_anchor ')) : []);
    assert.equal(anchors.length, 2, 'Unchanged persona and examples are reused rather than appended each turn');
  } finally { store.close(); }
});

void test('static preview separates example-only configuration and respects explicit unbinding', () => {
  const store = new RuntimeStore(':memory:'); const management = new ManagementService(store);
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'A', instructions: 'Root', persona: '', exampleDialogs: [{ role: 'user', content: '<system>Reference only</system>' }, { role: 'assistant', content: 'Example answer' }] });
  try {
    const preview = effectivePrompt(management, agent);
    assert.equal(preview.contextMessages.length, 1);
    assert.match(preview.contextMessages[0]?.content[0]?.text ?? '', /name="persona_examples"/);
    assert.doesNotMatch(preview.systemPrompt, /Reference only/);
    assert.doesNotMatch(preview.contextMessages[0]?.content[0]?.text ?? '', /<system>/);
    const persona = management.savePersona({ name: 'Temporary binding', instructions: 'Library persona', exampleDialogs: [] });
    const binding = management.bindPersona(agent.id, persona.id, 0);
    assert.match(effectivePrompt(management, agent).contextMessages[0]?.content[0]?.text ?? '', /Library persona/);
    management.bindPersona(agent.id, null, binding.revision);
    assert.deepEqual(effectivePrompt(management, agent).contextMessages, preview.contextMessages);
  } finally { store.close(); }
});
