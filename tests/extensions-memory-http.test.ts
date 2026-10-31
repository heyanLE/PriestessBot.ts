import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Usage, protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { createServer } from 'node:http';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { MemoryMaintenance } from '../packages/adapters/src/resources/memory-maintenance.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { MemoriesResponseSchema, MemoryRecordSchema, MessageEventSchema, RunDetailSchema, RunIdSchema, RuntimeConfigSchema, JobSchema } from '../packages/contracts/src/index.js';
import { ExtensionManifestSchema, ExtensionRecordSchema, ExtensionsResponseSchema } from '../packages/contracts/src/extensions.js';
import { MemoryMaintenanceResponseSchema, MemoryPolicySchema, MemoryProposalSchema, MemoryScopeSchema } from '../packages/contracts/src/memory-maintenance.js';

class ManagementModel implements Model {
  readonly calls: ModelRequest[] = [];
  readonly streamingCalls: ModelRequest[] = [];
  constructor(private readonly beforeResponse?: (request: ModelRequest) => Promise<void>) {}
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request); await this.beforeResponse?.(request);
    return { usage: new Usage({ inputTokens: 10, outputTokens: 10, totalTokens: 20 }), output: [protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ merges: [{ sourceIds: ['memory_first', 'memory_second'], text: 'Prefers green tea.' }] }) }] })] };
  }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    this.streamingCalls.push(request); await Promise.resolve();
    const output = this.streamingCalls.length === 1
      ? [{ type: 'function_call', name: 'http_echo_tool', arguments: JSON.stringify({ text: 'from_model' }), callId: 'http_native_call', status: 'completed' }]
      : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Native tool completed' }] }];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `http-model-${this.streamingCalls.length}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
  }
}
const manifest = ExtensionManifestSchema.parse({ id: 'http_echo', name: 'HTTP Echo', version: '1.0', description: 'Integration test extension', configuration: { prefix: { type: 'string', description: 'Prefix', maxLength: 50 } }, tools: [{ name: 'http_echo_tool', description: 'Echo', capabilities: ['chat'], parameters: { text: { type: 'string', description: 'Text', maxLength: 200 } } }], commands: [{ name: 'http_echo_command', description: 'Command', capabilities: ['chat'], parameters: { text: { type: 'string', description: 'Text', maxLength: 200 } } }] });
const scope = MemoryScopeSchema.parse({ agentId: 'assistant', libraryId: 'default', scope: 'sender', principal: { platform: 'dashboard', sessionType: 'private', sessionId: 'alice', senderId: 'alice' } });
type RequestFn = (route: string, method?: string, value?: unknown, authenticated?: boolean) => Promise<Response>;
async function parsed<T>(response: Response, schema: z.ZodType<T>): Promise<T> { const raw: unknown = await response.json(); return schema.parse(raw); }
async function withServer(model: ManagementModel, work: (runtime: PriestessRuntime, request: RequestFn, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-extension-http-')); const config = defaultConfiguration(); const agent = config.agents[0]; assert.ok(agent);
  agent.resources.tools.push('http_echo_tool', 'http_echo_command');
  const runtime = new PriestessRuntime({ database: ':memory:', config, model }); const server = createRuntimeServer(runtime, { token: 'management-http-test-token', artifacts: join(directory, 'artifacts') });
  try {
    await runtime.startPlatforms(); await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server address unavailable');
    const request: RequestFn = (route, method = 'GET', value, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/ts/${route}`, { method, headers: { ...(authenticated ? { Authorization: 'Bearer management-http-test-token' } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(5000) });
    await work(runtime, request, directory);
  } finally { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
async function chat(runtime: PriestessRuntime, request: RequestFn, text: string) {
  const message = MessageEventSchema.parse({ platform: 'dashboard', platformType: 'telegram', sessionId: 'alice', sessionType: 'private', senderId: 'alice', messageId: crypto.randomUUID(), timestamp: Date.now(), botId: 'dashboard', parts: [{ type: 'text', text }] });
  const response = await request('chat', 'POST', { message }); assert.equal(response.status, 202); const initial = await parsed(response, RunDetailSchema); await runtime.idle(); return parsed(await request(`runs/${initial.run.id}`), RunDetailSchema);
}
function seed(runtime: PriestessRuntime): void {
  for (const id of ['memory_first', 'memory_second']) runtime.store.put('memories', id, MemoryRecordSchema.parse({ ...scope, id, text: 'Prefers green tea', source: `message:${id}`, confidence: 0.9, createdAt: 1, updatedAt: 1 }));
  runtime.store.put('memories', 'memory_other', MemoryRecordSchema.parse({ ...scope, id: 'memory_other', principal: { ...scope.principal, senderId: 'bob' }, text: 'Bob private data', source: 'message:other', confidence: 1, createdAt: 1, updatedAt: 1 }));
}

void test('real HTTP extension lifecycle is authenticated and wired into runtime SDK tools and commands', async () => {
  const model = new ManagementModel(); await withServer(model, async (runtime, request, directory) => {
    const modulePath = join(directory, 'echo.mjs'); await writeFile(modulePath, `export default {manifest:${JSON.stringify(manifest)},execute:async(name,args,context)=>{context.state.set("last",args.text);return context.configuration.prefix+args.text}}`);
    const install = { manifest, modulePath, configuration: { prefix: 'A:' }, trustedHostAcknowledged: true };
    assert.equal((await request('extensions', 'GET', undefined, false)).status, 401);
    assert.equal((await request('extensions', 'POST', install, false)).status, 401);
    assert.equal((await request(`extensions/${manifest.id}`, 'PUT', { enabled: true, expectedRevision: 1 }, false)).status, 401);
    assert.equal((await parsed(await request('extensions'), ExtensionsResponseSchema)).extensions.length, 0);
    assert.equal((await request('extensions', 'POST', { ...install, trustedHostAcknowledged: false })).status, 400);
    const response = await request('extensions', 'POST', install); assert.equal(response.status, 201); const installed = await parsed(response, ExtensionRecordSchema); assert.equal(installed.enabled, false);
    assert.match((await chat(runtime, request, '/http_echo_command {"text":"disabled"}')).run.summary, /未执行/); assert.equal(model.streamingCalls.length, 0);
    const active = await parsed(await request(`extensions/${manifest.id}`, 'PUT', { enabled: true, expectedRevision: installed.revision }), ExtensionRecordSchema); assert.equal(active.status, 'enabled');
    assert.equal((await chat(runtime, request, '/http_echo_command {"text":"command"}')).run.summary, 'A:command'); assert.equal(model.streamingCalls.length, 0);
    const run = await chat(runtime, request, 'Use the echo tool'); assert.equal(run.run.status, 'completed'); assert.equal(run.run.summary, 'Native tool completed');
    assert.match(JSON.stringify(model.streamingCalls[0]?.tools), /http_echo_tool/); assert.match(JSON.stringify(model.streamingCalls[1]?.input), /A:from_model/);
    assert.equal((await request(`extensions/${manifest.id}`, 'PUT', { enabled: true, expectedRevision: installed.revision })).status, 409);
    assert.equal((await request(`extensions/${manifest.id}`, 'PUT', { enabled: true, expectedRevision: active.revision, configuration: { prefix: 7 } })).status, 400);
    const configured = await parsed(await request(`extensions/${manifest.id}`, 'PUT', { enabled: true, expectedRevision: active.revision, configuration: { prefix: 'B:' } }), ExtensionRecordSchema); assert.equal(configured.configuration.prefix, 'B:');
    assert.equal((await chat(runtime, request, '/http_echo_command {"text":"changed"}')).run.summary, 'B:changed');
    const disabled = await parsed(await request(`extensions/${manifest.id}`, 'PUT', { enabled: false, expectedRevision: configured.revision }), ExtensionRecordSchema); assert.equal(disabled.status, 'disabled');
    assert.match((await chat(runtime, request, '/http_echo_command {"text":"disabled_again"}')).run.summary, /未执行/);
  });
});

void test('real HTTP memory preview, stale-source rejection, apply and opt-in policy use runtime model', async () => {
  const model = new ManagementModel(); await withServer(model, async (runtime, request) => {
    seed(runtime);
    for (const [route, method, value] of [['memory-maintenance', 'GET', undefined], ['memory-maintenance/preview', 'POST', scope], ['memory-maintenance/apply/test', 'POST', {}], ['memory-maintenance/policy', 'PUT', {}]] as const) assert.equal((await request(route, method, value, false)).status, 401);
    const initial = await parsed(await request('memory-maintenance'), MemoryMaintenanceResponseSchema); assert.equal(initial.policies.length, 0); assert.equal(initial.proposals.length, 0);
    const preview = await parsed(await request('memory-maintenance/preview', 'POST', scope), MemoryProposalSchema); assert.equal(preview.sources.length, 2); assert.equal(model.calls.length, 1); assert.deepEqual(model.calls[0]?.tools, []); assert.doesNotMatch(JSON.stringify(model.calls[0]?.input), /Bob private data/);
    assert.equal((await parsed(await request('memory'), MemoriesResponseSchema)).memories.length, 3);
    const updated = await request('memory/memory_first', 'PUT', { text: 'Now prefers black tea', principal: scope.principal }); assert.equal(updated.status, 200);
    const stale = await request(`memory-maintenance/apply/${preview.id}`, 'POST', {}); assert.equal(stale.status, 400); assert.match(await stale.text(), /sources changed/);
    const fresh = await parsed(await request('memory-maintenance/preview', 'POST', scope), MemoryProposalSchema); const applied = await parsed(await request(`memory-maintenance/apply/${fresh.id}`, 'POST', {}), MemoryProposalSchema); assert.equal(applied.status, 'applied');
    const memories = (await parsed(await request('memory'), MemoriesResponseSchema)).memories; assert.equal(memories.length, 2); const merged = memories.find(item => item.id !== 'memory_other'); assert.ok(merged); assert.match(merged.source, /message:memory_first/); assert.match(merged.source, /message:memory_second/);
    const policy = await parsed(await request('memory-maintenance/policy', 'PUT', { policy: { scope, enabled: true, intervalMinutes: 5 }, expectedRevision: 0 }), MemoryPolicySchema); assert.equal(policy.autoApply, false);
    assert.equal((await request('memory-maintenance/policy', 'PUT', { policy: { scope, enabled: false, intervalMinutes: 5 }, expectedRevision: 0 })).status, 409);
    const disabled = await parsed(await request('memory-maintenance/policy', 'PUT', { policy: { scope, enabled: false, intervalMinutes: 5 }, expectedRevision: policy.revision }), MemoryPolicySchema); assert.equal(disabled.enabled, false);
    const snapshot = await parsed(await request('memory-maintenance'), MemoryMaintenanceResponseSchema); assert.equal(snapshot.policies[0]?.revision, disabled.revision); assert.equal(snapshot.jobs.length, 2);
  });
});

void test('HTTP cancellation and disabling a policy abort in-flight same-scope consolidation without edits', async () => {
  let entered: (() => void) | undefined; const ready = new Promise<void>(resolve => { entered = resolve; });
  const model = new ManagementModel(request => new Promise<void>((_resolve, reject: (error: Error) => void) => { entered?.(); const abort = (): void => reject(new Error('Cancelled mock model')); if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true }); }));
  await withServer(model, async (runtime, request) => {
    seed(runtime); const policy = await parsed(await request('memory-maintenance/policy', 'PUT', { policy: { scope, enabled: true, intervalMinutes: 5, autoApply: true }, expectedRevision: 0 }), MemoryPolicySchema);
    const tick = runtime.memoryMaintenance.tick(policy.nextRunAt); await ready;
    const snapshot = await parsed(await request('memory-maintenance'), MemoryMaintenanceResponseSchema); const running = snapshot.jobs[0]; assert.ok(running); assert.equal(running.status, 'running');
    assert.equal((await request('memory-maintenance/preview', 'POST', scope)).status, 400); assert.equal(model.calls.length, 1);
    assert.equal((await request(`memory-maintenance/cancel/${running.id}`, 'POST', {}, false)).status, 401);
    await request('memory-maintenance/policy', 'PUT', { policy: { scope, enabled: false, intervalMinutes: 5, autoApply: true }, expectedRevision: policy.revision }); await tick;
    const after = await parsed(await request('memory-maintenance'), MemoryMaintenanceResponseSchema); assert.equal(after.jobs[0]?.status, 'cancelled'); assert.equal(after.proposals.length, 0); assert.equal((await parsed(await request('memory'), MemoriesResponseSchema)).memories.length, 3);
    assert.equal((await request(`memory-maintenance/cancel/${running.id}`, 'POST', {})).status, 200);
  });
});

void test('maintenance shutdown stops iterating remaining policies before the store closes', async () => {
  let entered: (() => void) | undefined; const ready = new Promise<void>(resolve => { entered = resolve; });
  const model = new ManagementModel(request => new Promise<void>((_resolve, reject: (error: Error) => void) => { entered?.(); const abort = (): void => reject(new Error('Cancelled mock model')); if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true }); }));
  const store = new RuntimeStore(':memory:'); const config = defaultConfiguration(); const service = new MemoryMaintenance(store, () => config, () => undefined, model);
  const scopes = [scope, { ...scope, principal: { ...scope.principal, senderId: 'bob' } }]; let deadline = 0;
  for (const [index, current] of scopes.entries()) { store.put('memories', `shutdown_${index}`, MemoryRecordSchema.parse({ ...current, id: `shutdown_${index}`, text: 'Tea preference', source: 'shutdown test', confidence: 1, createdAt: 1, updatedAt: 1 })); const policy = service.setPolicy({ scope: current, enabled: true, intervalMinutes: 5, autoApply: true }, 0); deadline = Math.max(deadline, policy.nextRunAt); }
  const tick = service.tick(deadline); await ready; await service.stop(); store.close(); await tick; assert.equal(model.calls.length, 1);
});

void test('actual Chat Completions transport omits unsupported response_format for consolidation and automatic extraction', async () => {
  const requests: { response_format?: unknown; messages: { role: string; content: unknown }[] }[] = [];
  const errors: string[] = [];
  const provider = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []; for await (const raw of request) chunks.push(Buffer.isBuffer(raw) ? raw : Buffer.from(z.string().parse(raw)));
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const parsed = z.object({ response_format: z.unknown().optional(), messages: z.array(z.object({ role: z.string(), content: z.unknown() })) }).parse(input); requests.push(parsed);
    if (parsed.response_format !== undefined) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'This response_format type is unavailable now', type: 'invalid_request_error' } })); return; }
    const output = requests.length === 1 ? { merges: [{ sourceIds: ['memory_first', 'memory_second'], text: 'Prefers green tea.' }] } : { memories: [{ text: 'Likes afternoon tea.', confidence: 0.8 }] };
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ id: `compat-${requests.length}`, object: 'chat.completion', created: 1, model: 'compat-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  })().catch(error => { errors.push(error instanceof Error ? error.message : 'Unknown mock failure'); response.writeHead(500); response.end(); }); });
  await new Promise<void>((resolve, reject: (error: Error) => void) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
  const address = provider.address(); if (!address || typeof address === 'string') throw new Error('Mock provider unavailable');
  const base = defaultConfiguration(); const original = base.agents[0]; assert.ok(original);
  const config = RuntimeConfigSchema.parse({ ...base, connections: [{ id: 'default', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: 'MOCK_KEY', protocol: 'chat_completions' }], agents: [{ ...original, model: 'compat-model', memoryExtraction: { enabled: true, libraryId: 'default' } }] });
  const runtime = new PriestessRuntime({ database: ':memory:', config, secret: () => 'mock-key-not-a-real-secret' });
  try {
    seed(runtime); const preview = await runtime.memoryMaintenance.preview(scope); assert.equal(preview.merges.length, 1); assert.equal(requests.length, 1);
    const agent = runtime.config().agents[0]; assert.ok(agent); const principal = scope.principal;
    const context = { runId: RunIdSchema.parse('compat-extraction'), turnId: 'compat-turn', principal, agentId: agent.id, generation: 0, configRevision: runtime.config().revision, flowRevision: runtime.config().revision, ...runtime.auth.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
    const message = MessageEventSchema.parse({ platform: principal.platform, platformType: 'telegram', sessionId: principal.sessionId, sessionType: 'private', senderId: principal.senderId, messageId: 'compat-message', timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text: 'I like afternoon tea.' }] });
    await runtime.memoryJobs.extract({ agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 'compat-session' } }, 'Remembered.');
    assert.equal(requests.length, 2); assert.ok(requests.every(item => item.response_format === undefined)); assert.ok(requests.every(item => JSON.stringify(item.messages).includes('JSON schema'))); assert.ok(runtime.memory.list().some(item => item.text === 'Likes afternoon tea.')); assert.equal(runtime.store.list('jobs', JobSchema)[0]?.status, 'completed'); assert.deepEqual(errors, []);
  } finally { await runtime.stop(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
});
