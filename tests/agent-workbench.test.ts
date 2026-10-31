import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AgentDefinitionSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { AgentDraftTestSchema, AgentDraftTestResultSchema, AgentCapabilitiesSchema, AgentWorkbenchSavedSchema } from '../packages/contracts/src/agent-workbench.js';
import { QqFileSettingsSchema, QQ_TOOLS } from '../packages/contracts/src/plugins/qq-file.js';
import { ExtensionRecordSchema } from '../packages/contracts/src/extensions.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { ManagementError } from '../packages/core/src/management.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { agentCapabilities } from '../apps/server/src/agent-capabilities.js';

class PreviewModel implements Model {
  readonly requests: ModelRequest[] = [];
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Streaming required')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.requests.push(request); await Promise.resolve();
    yield { type: 'output_text_delta', delta: 'draft response' };
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'preview-response', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'draft response' }] }] } });
  }
}
function firstAgent(runtime: PriestessRuntime) { const agent = runtime.config().agents[0]; assert.ok(agent); return agent; }

void test('draft test executes real SDK with current draft and explicit persona without publishing, tools or production history', async t => {
  const model = new PreviewModel(); const runtime = new PriestessRuntime({ database: ':memory:', model });
  const stored = runtime.config(); const candidate = firstAgent(runtime);
  const persona = runtime.management.savePersona({ name: 'Preview Persona', instructions: 'PERSONA_EXPLICIT', exampleDialogs: [{ role: 'user', content: 'EXAMPLE_QUESTION' }, { role: 'assistant', content: 'EXAMPLE_ANSWER' }] });
  t.mock.method(runtime, 'startPlatforms', () => Promise.reject(new Error('Draft must not start platforms')));
  t.mock.method(runtime.mcp, 'tools', () => Promise.reject(new Error('Draft must not discover MCP tools')));
  const config = RuntimeConfigSchema.parse({ ...stored, agents: [{ ...candidate, instructions: 'UNSAVED_AGENT_INSTRUCTIONS', resources: { ...candidate.resources, tools: ['exec_command', 'qq_file'], executionEnvironment: 'nonexistent-draft-environment' } }], platforms: [{ id: 'unsafe-im-draft', type: 'telegram', tokenEnv: 'MUST_NOT_USE', enabled: true }] });
  try {
    const result = await runtime.draftTester.run({ config, agentId: candidate.id, personaId: persona.id, message: 'Test current draft' }, new AbortController().signal);
    assert.equal(result.status, 'completed'); assert.equal(result.text, 'draft response');
    assert.equal(result.saved, false); assert.equal(result.deliveredToIm, false); assert.deepEqual(result.tools, []);
    assert.equal(result.inputTokens, 5); assert.equal(result.outputTokens, 3);
    const request = model.requests[0]; assert.ok(request);
    assert.equal(request.tracing, false); assert.deepEqual(request.tools, []);
    assert.match(JSON.stringify(request), /UNSAVED_AGENT_INSTRUCTIONS/); assert.match(JSON.stringify(request.input), /PERSONA_EXPLICIT/); assert.match(JSON.stringify(request.input), /EXAMPLE_QUESTION/);
    assert.deepEqual(runtime.config(), stored); assert.deepEqual(runtime.store.runs(), []); assert.deepEqual(runtime.management.conversations(), []); assert.deepEqual(runtime.management.bindings(), []);
    assert.equal(runtime.store.db.prepare("SELECT count(*) AS total FROM documents WHERE namespace='sdk-history'").get()?.['total'], 0);
    assert.ok(result.events.some(event => event.type === 'completed'));
  } finally { await runtime.stop(); }
});

void test('explicit null persona uses inline draft instead of saved binding and each test starts fresh', async () => {
  const model = new PreviewModel(); const runtime = new PriestessRuntime({ database: ':memory:', model }); const agent = firstAgent(runtime);
  try {
    const persona = runtime.management.savePersona({ name: 'Saved persona', instructions: 'SAVED_PERSONA_SHOULD_NOT_APPEAR' }); runtime.management.bindPersona(agent.id, persona.id, 0);
    const config = RuntimeConfigSchema.parse({ ...runtime.config(), agents: [{ ...agent, persona: 'INLINE_UNSAVED_PERSONA' }] });
    await runtime.draftTester.run({ config, agentId: agent.id, personaId: null, message: 'FIRST_PREVIEW_ONLY' }, new AbortController().signal);
    await runtime.draftTester.run({ config, agentId: agent.id, personaId: null, message: 'SECOND_PREVIEW_ONLY' }, new AbortController().signal);
    assert.match(JSON.stringify(model.requests[0]?.input), /INLINE_UNSAVED_PERSONA/); assert.doesNotMatch(JSON.stringify(model.requests), /SAVED_PERSONA_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(JSON.stringify(model.requests[1]?.input), /FIRST_PREVIEW_ONLY/);
  } finally { await runtime.stop(); }
});

void test('draft tests enforce request bounds, cancellation and model-only budget limits', async () => {
  const model = new PreviewModel(); const runtime = new PriestessRuntime({ database: ':memory:', model }); const agent = firstAgent(runtime);
  const config = RuntimeConfigSchema.parse({ ...runtime.config(), agents: [{ ...agent, budget: { ...agent.budget, maxTokens: 100000, maxTurns: 100, timeoutMs: 3600000 } }] });
  try {
    assert.equal(AgentDraftTestSchema.safeParse({ config, agentId: agent.id, personaId: null, message: 'x'.repeat(16001) }).success, false);
    const result = await runtime.draftTester.run({ config, agentId: agent.id, personaId: null, message: 'cancelled' }, AbortSignal.abort());
    assert.equal(result.status, 'cancelled'); assert.equal(model.requests.length, 0); assert.deepEqual(result.limits, { timeoutMs: 120000, maxTokens: 8192, maxTurns: 3 });
    await assert.rejects(runtime.draftTester.run({ config, agentId: agent.id, personaId: 'missing', message: 'test' }, new AbortController().signal), /Persona not found/);
    await assert.rejects(runtime.draftTester.run({ config: { ...config, connections: [] }, agentId: agent.id, personaId: null, message: 'test' }, new AbortController().signal), /connection not found/);
  } finally { await runtime.stop(); }
});

void test('Agent and persona binding save atomically with both revisions and do not include unrelated drafts', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:' }); const before = runtime.config(); const agent = firstAgent(runtime);
  try {
    const persona = runtime.management.savePersona({ name: 'Atomic persona', instructions: 'persona' });
    runtime.management.bindPersona(agent.id, null, 0);
    await assert.rejects(runtime.saveAgentWorkbench({ agent: { ...agent, displayName: 'MUST_ROLL_BACK' }, personaId: persona.id, expectedRevision: before.revision, expectedBindingRevision: 0 }), error => error instanceof ManagementError && error.status === 409);
    assert.deepEqual(runtime.config(), before); assert.equal(runtime.management.bindings()[0]?.personaId, null);
    const saved = await runtime.saveAgentWorkbench({ agent: { ...agent, displayName: 'Updated one Agent' }, personaId: persona.id, expectedRevision: before.revision, expectedBindingRevision: 1 });
    assert.equal(saved.impact, 'running_and_queued_cancelled_approvals_invalidated'); assert.equal(saved.revision, before.revision + 1); assert.equal(saved.binding.revision, 2); assert.equal(saved.binding.personaId, persona.id);
    assert.equal(saved.config.agents[0]?.displayName, 'Updated one Agent'); assert.deepEqual(saved.config.connections, before.connections); assert.deepEqual(saved.config.platforms, before.platforms); assert.deepEqual(saved.config.grants, before.grants);
    await assert.rejects(runtime.saveAgentWorkbench({ agent, personaId: null, expectedRevision: before.revision, expectedBindingRevision: 2 }), /Revision conflict/);
    assert.equal(runtime.management.bindings()[0]?.revision, 2); assert.equal(runtime.management.bindings()[0]?.personaId, persona.id);
  } finally { await runtime.stop(); }
});

void test('single-Agent save rejects unpublished resource references and missing personas without committing either record', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:' }); const before = runtime.config(); const agent = firstAgent(runtime);
  try {
    await assert.rejects(runtime.saveAgentWorkbench({ agent: { ...agent, connectionId: 'only-in-ui-draft' }, personaId: null, expectedRevision: before.revision, expectedBindingRevision: 0 }), /unknown connection/);
    await assert.rejects(runtime.saveAgentWorkbench({ agent: { ...agent, resources: { ...agent.resources, mcpServers: ['unpublished'] } }, personaId: null, expectedRevision: before.revision, expectedBindingRevision: 0 }), /unknown MCP/);
    await assert.rejects(runtime.saveAgentWorkbench({ agent, personaId: 'missing', expectedRevision: before.revision, expectedBindingRevision: 0 }), /Persona not found/);
    assert.deepEqual(runtime.config(), before); assert.deepEqual(runtime.management.bindings(), []);
  } finally { await runtime.stop(); }
});

void test('related storage mutation failures roll back configuration insert and related writes together', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [AgentDefinitionSchema.parse({ id: 'test', displayName: 'Test' })], flow: { routing: { defaultAgentId: 'test', rules: [] } } });
    assert.throws(() => store.publishConfig(config, 0, () => { store.put('related', 'binding', { written: true }); throw new Error('after related write'); }), /after related write/);
    assert.equal(store.getConfig(), undefined); assert.equal(store.db.prepare("SELECT count(*) AS total FROM documents WHERE namespace='related'").get()?.['total'], 0);
  } finally { store.close(); }
});

void test('capability metadata follows platform injection and distinguishes undiscovered and non-tool capabilities', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:' });
  try {
    const result = agentCapabilities(runtime); const qq = result.entries.filter(item => item.sourceId === 'qq_file');
    for (const entry of result.entries.filter(item => item.source === 'search' || item.source === 'plugin')) {
      assert.match(entry.label, /\p{Script=Han}/u);
      assert.doesNotMatch(entry.label, /[a-z]+_[a-z]+/);
      assert.match(entry.description, /\p{Script=Han}/u);
      if (entry.toolName) assert.notEqual(entry.label, entry.toolName);
    }
    assert.equal(result.entries.find(item => item.toolName === 'web_search')?.label, '搜索网页');
    assert.equal(result.entries.find(item => item.toolName === 'qq_group_notices')?.label, '读取 QQ 群公告');
    assert.equal(result.entries.find(item => item.toolName === 'bilibili_get_video_content')?.label, '读取 B 站字幕与转写');
    assert.match(result.entries.find(item => item.bindingName === 'reminiscence_record')?.description ?? '', /自动记录权限，不是模型工具/);
    assert.deepEqual(new Set(qq.map(item => item.toolName)), new Set(QQ_TOOLS));
    assert.ok(qq.every(item => item.scope === 'platform' && item.platforms.length === 1 && item.platforms[0] === 'napcat' && item.availability === 'disabled'));
    assert.ok(qq.every(item => item.requirements.some(text => text.includes('resources.manage'))));
    const history = result.entries.find(item => item.toolName === 'get_group_message_history'); assert.ok(history); assert.equal(history.scope, 'general'); assert.deepEqual(history.sessionTypes, ['group']); assert.deepEqual(new Set(history.platforms), new Set(['napcat', 'telegram']));
    for (const platform of ['telegram', 'weixin']) { const entry = result.entries.find(item => item.id === `platform:${platform}`); assert.ok(entry); assert.equal(entry.kind, 'platform_status'); assert.equal(entry.availability, 'not_implemented'); assert.equal(entry.toolName, undefined); }
    const recorder = result.entries.find(item => item.id === 'plugin:local_reminiscence:reminiscence_record'); assert.ok(recorder); assert.equal(recorder.kind, 'resource'); assert.equal(recorder.toolName, undefined); assert.equal(recorder.bindingName, 'reminiscence_record');
    const current = runtime.plugins.settings.get('qq_file'); runtime.plugins.settings.update('qq_file', QqFileSettingsSchema.parse({ ...current.settings, enabled: true }), current.revision);
    assert.ok(agentCapabilities(runtime).entries.filter(item => item.sourceId === 'qq_file').every(item => item.availability === 'registered'));
    runtime.store.put('extensions', 'approval_fixture', ExtensionRecordSchema.parse({ manifest: { id: 'approval_fixture', name: 'Approval fixture', version: '1', description: '', tools: [{ name: 'fixture_tool', description: 'Tool', capabilities: ['chat'], parameters: {} }], commands: [{ name: 'fixture_command', description: 'Command', capabilities: ['chat'], parameters: {} }] }, modulePath: '/not-loaded/fixture.mjs', enabled: false, status: 'disabled', diagnostic: '', revision: 1, updatedAt: 1 }));
    const extensionEntries = agentCapabilities(runtime).entries.filter(item => item.sourceId === 'approval_fixture');
    assert.ok(extensionEntries.find(item => item.kind === 'tool')?.requirements.some(text => text.includes('需要逐次审批')));
    const directCommand = extensionEntries.find(item => item.kind === 'command'); assert.ok(directCommand);
    assert.ok(directCommand.requirements.some(text => text.includes('不经过 SDK 工具审批')));
    assert.equal(directCommand.requirements.some(text => text.includes('需要逐次审批时')), false);
  } finally { await runtime.stop(); }
});

void test('workbench HTTP is authenticated and serves draft tests, catalogue and atomic saves without starting IM', async () => {
  const model = new PreviewModel(); const runtime = new PriestessRuntime({ database: ':memory:', model }); const server = createRuntimeServer(runtime, { token: 'test-workbench-token', artifacts: '/tmp/priestess-workbench-test-artifacts' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api/ts/`;
  const headers = { Authorization: 'Bearer test-workbench-token', 'Content-Type': 'application/json' }; const agent = firstAgent(runtime);
  try {
    assert.equal((await fetch(`${base}agent-capabilities`)).status, 401);
    const catalogue = await fetch(`${base}agent-capabilities`, { headers }); assert.ok(AgentCapabilitiesSchema.parse(await catalogue.json()).entries.length > 20);
    const draft = await fetch(`${base}agents/${agent.id}/draft-test`, { method: 'POST', headers, body: JSON.stringify({ config: runtime.config(), agentId: agent.id, personaId: null, message: 'Actual preview' }) }); assert.equal(draft.status, 200); assert.equal(AgentDraftTestResultSchema.parse(await draft.json()).text, 'draft response');
    const wrong = await fetch(`${base}agents/wrong/draft-test`, { method: 'POST', headers, body: JSON.stringify({ config: runtime.config(), agentId: agent.id, personaId: null, message: 'wrong target' }) }); assert.equal(wrong.status, 400);
    const saved = await fetch(`${base}agents/${agent.id}/workbench`, { method: 'PUT', headers, body: JSON.stringify({ agent, personaId: null, expectedRevision: runtime.config().revision, expectedBindingRevision: 0 }) }); assert.equal(saved.status, 200); assert.equal(AgentWorkbenchSavedSchema.parse(await saved.json()).binding.agentId, agent.id);
    assert.equal(model.requests.length, 1); assert.deepEqual(runtime.store.runs(), []);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await runtime.stop(); }
});
