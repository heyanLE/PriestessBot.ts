import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { SearchSettingsSchema } from '../packages/contracts/src/search.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { ManagementService } from '../packages/core/src/management.js';
import { AuthorizationService } from '../packages/core/src/authorization.js';
import { SearchError, WebSearchService, type SearchErrorCode } from '../packages/adapters/src/search/index.js';
import { effectivePrompt } from '../apps/server/src/search-http.js';
import type { HttpFetch } from '../packages/adapters/src/platforms/transport.js';
function setup(fetch: HttpFetch) {
  const store = new RuntimeStore(':memory:'); const controller = new AbortController();
  const agent = AgentDefinitionSchema.parse({ id: 'test', displayName: 'Test', capabilities: ['chat'], resources: { tools: ['web_search', 'web_fetch', 'deepseek_search', 'deepseek_fetch'] } });
  const message = MessageEventSchema.parse({ platform: 'tg', platformType: 'telegram', sessionId: 's', sessionType: 'private', senderId: 'a', messageId: 'm', timestamp: 1, botId: 'b', parts: [{ type: 'text', text: 'search' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId }; const grant = GrantSchema.parse({ ...principal, maximumState: 'operator', capabilities: agent.capabilities, resources: agent.resources }); const auth = new AuthorizationService([grant], store);
  const input: EngineInput = { agent, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 's' }, context: { ...auth.resolve(principal, agent), principal, runId: RunIdSchema.parse('run'), turnId: 'turn', agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, signal: controller.signal, budget: agent.budget, depth: 0 } };
  const service = new WebSearchService({ store, auth, secret: () => 'private-secret', fetch, resolve: () => Promise.resolve([{ address: '93.184.216.34' }]) });
  const configure = (provider: 'deepseek' | 'tavily' | 'brave' = 'deepseek') => { const { revision, ...settings } = SearchSettingsSchema.parse({ enabled: true, provider, apiBase: 'https://search.example' }); return service.update(settings, revision); };
  return { store, controller, auth, input, service, configure };
}
void test('DeepSeek protocol normalizes cited sources and filters malicious citation URLs', async () => {
  const calls: { url: string; body: string }[] = []; const state = setup((url, options) => { calls.push({ url: String(url), body: typeof options?.body === 'string' ? options.body : '' }); return Promise.resolve(Response.json({ results: [{ title: 'Source', url: 'https://example.com/a', summary: 'x'.repeat(1800) }, { url: 'http://user:pass@example.com' }, { url: 'http://127.0.0.1' }] })); });
  try { assert.equal(state.service.tools(state.input).length, 0); state.configure(); const result = await state.service.search(state.input, 'site:example.com news', 5); assert.equal(result.results.length, 1); assert.equal(result.results[0]?.summary.length, 1200); assert.ok(result.results[0]?.index.endsWith('.1')); assert.equal(calls[0]?.url, 'https://search.example/v1/tools/search'); assert.deepEqual(JSON.parse(calls[0]?.body ?? ''), { query: 'site:example.com news', count: 5, need_content: false }); await assert.rejects(state.service.search(state.input, 'q', 11), /maximum|exceed/); } finally { state.store.close(); }
});
void test('fetch rejects credential/private destinations before transport and bounds content', async () => {
  let calls = 0; const state = setup(() => { calls++; return Promise.resolve(Response.json({ title: 'page', content: 'x'.repeat(14_000) })); });
  try { state.configure(); for (const url of ['http://127.0.0.1/a', 'https://u:p@example.com', 'http://[::ffff:127.0.0.1]', 'file:///etc/passwd']) await assert.rejects(state.service.fetchPage(state.input, url)); assert.equal(calls, 0); const result = await state.service.fetchPage(state.input, 'https://example.com/page'); assert.equal(result.url, 'https://example.com/page'); assert.equal(result.content.length, 12_000); assert.equal(result.truncated, true); } finally { state.store.close(); }
});
void test('search refuses stale updates, disable mid-flight, revoked permissions and cancellation', async () => {
  for (const change of ['disable', 'revoke', 'cancel'] as const) { const state = setup(() => { if (change === 'disable') { const { revision, ...settings } = state.service.settings(); state.service.update({ ...settings, enabled: false }, revision); } else if (change === 'revoke') state.auth.replaceGrants([]); else state.controller.abort(); return Promise.resolve(Response.json({ results: [] })); }); try { state.configure(); assert.throws(() => state.configure(), /changed/); await assert.rejects(state.service.search(state.input, 'test')); if (change === 'disable') assert.equal(state.service.tools(state.input).length, 0); } finally { state.store.close(); } }
});
void test('upstream errors never expose secrets, invalid bodies or request URLs', async () => {
  for (const response of [new Response('private-secret', { status: 403 }), new Response('private-secret', { status: 200 }), Response.json({ results: 'private-secret' })]) { const state = setup(() => Promise.resolve(response)); try { state.configure(); await assert.rejects(state.service.search(state.input, 'q'), error => error instanceof Error && !error.message.includes('private-secret') && /provider/.test(error.message)); } finally { state.store.close(); } }
});
void test('Tavily search/extract and Brave GET use their real protocols', async () => {
  const calls: string[] = []; const state = setup((url, init) => { calls.push(`${init?.method} ${String(url)}`); return Promise.resolve(String(url).includes('/res/v1') ? Response.json({ web: { results: [{ title: 'Brave', url: 'https://example.com', description: 'summary' }] } }) : Response.json({ results: [{ title: 'Tavily', url: 'https://example.com', content: 'text', raw_content: 'body' }] })); });
  try { state.configure('tavily'); assert.equal((await state.service.search(state.input, 'hello')).results[0]?.summary, 'text'); assert.equal((await state.service.fetchPage(state.input, 'https://example.com')).content, 'text'); const { revision, ...settings } = state.service.settings(); state.service.update({ ...settings, provider: 'brave' }, revision); assert.equal((await state.service.search(state.input, 'hello world', 3)).results[0]?.summary, 'summary'); await assert.rejects(state.service.fetchPage(state.input, 'https://example.com'), /unsupported/); assert.deepEqual(calls, ['POST https://search.example/search', 'POST https://search.example/extract', 'GET https://search.example/res/v1/web/search?q=hello+world&count=3']); } finally { state.store.close(); }
});
void test('effective prompt uses bound library examples and tool restrictions while preserving supplement and explicit fallback', () => {
  const store = new RuntimeStore(':memory:'); const management = new ManagementService(store); const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'A', instructions: 'Supplement', persona: 'Fallback', exampleDialogs: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'old reply' }], resources: { tools: ['web_search', 'write_file'] } });
  try { const persona = management.savePersona({ name: 'Fiammetta', instructions: 'Persona body', tools: ['web_search'], exampleDialogs: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }] }); const binding = management.bindPersona(agent.id, persona.id, 0); const result = effectivePrompt(management, agent); assert.equal(result.source, 'persona_library'); assert.equal(result.personaName, 'Fiammetta'); assert.deepEqual(result.tools, ['web_search']); assert.equal(result.exampleDialogs.length, 2); assert.match(result.systemPrompt, /^Supplement\n\nPersona body/); assert.doesNotMatch(result.systemPrompt, /Fallback/); management.bindPersona(agent.id, null, binding.revision); assert.equal(effectivePrompt(management, agent).personaInstructions, 'Fallback'); } finally { store.close(); }
});
void test('cancellation signal aborts an in-flight HTTP call and missing secrets give a configuration error', async () => {
  let entered: (() => void) | undefined; const started = new Promise<void>(resolve => { entered = resolve; });
  const state = setup((_url, options) => new Promise((_resolve, reject: (reason: Error) => void) => { entered?.(); options?.signal?.addEventListener('abort', () => reject(new Error('credential-bearing upstream error')), { once: true }); }));
  try { state.configure(); const pending = state.service.search(state.input, 'q'); await started; state.controller.abort(); await assert.rejects(pending, /Search cancelled/); const other = new WebSearchService({ store: state.store, auth: state.auth, secret: () => undefined }); assert.equal(other.status().credentialConfigured, false); } finally { state.store.close(); }
});

void test('fetch errors distinguish provider status, transport, JSON, and schema failures without exposing upstream data', async () => {
  const cases: { code: SearchErrorCode; transport: HttpFetch }[] = [
    { code: 'provider_http', transport: () => Promise.resolve(new Response('private-secret', { status: 404 })) },
    { code: 'provider_transport', transport: () => Promise.reject(new Error('private-secret at https://private.example')) },
    { code: 'provider_json', transport: () => Promise.resolve(new Response('private-secret')) },
    { code: 'provider_schema', transport: () => Promise.resolve(Response.json({ content: 42, credential: 'private-secret' })) },
    { code: 'provider_body', transport: () => Promise.resolve(new Response('private-secret', { headers: { 'content-length': '2000001' } })) },
  ];
  for (const entry of cases) {
    const state = setup(entry.transport);
    try {
      state.configure(); const selected = state.service.tools(state.input).find(item => item.name === 'web_fetch');
      assert.ok(selected?.type === 'function');
      const result: unknown = await selected.invoke(new RunContext({ runId: state.input.context.runId }), JSON.stringify({ url: 'https://example.com/page' }));
      assert.equal(typeof result, 'string'); if (typeof result !== 'string') throw new Error('Expected serialized tool result');
      const diagnostic = z.object({ error: z.string(), code: z.string() }).parse(JSON.parse(result));
      assert.equal(diagnostic.code, entry.code); assert.doesNotMatch(diagnostic.error, /private-secret|private\.example/);
      if (entry.code === 'provider_http') assert.match(diagnostic.error, /provider status, not a verified source-page status/);
    } finally { state.store.close(); }
  }
});
void test('fetch identifies DNS failures and blocks mixed public/reserved DNS answers before contacting the provider', async () => {
  const state = setup(() => Promise.resolve(Response.json({ content: 'unused' })));
  try {
    state.configure(); let requests = 0;
    const resolutions: { code: SearchErrorCode; resolve: () => Promise<readonly { address: string }[]> }[] = [
      { code: 'dns_failed', resolve: () => Promise.reject(new Error('private-secret')) },
      { code: 'blocked_destination', resolve: () => Promise.resolve([{ address: '93.184.216.34' }, { address: '2001::8079:f3e4' }]) },
    ];
    for (const entry of resolutions) {
      const service = new WebSearchService({ store: state.store, auth: state.auth, secret: () => 'private-secret', resolve: entry.resolve, fetch: () => { requests++; return Promise.resolve(Response.json({ content: 'must not be read' })); } });
      await assert.rejects(service.fetchPage(state.input, 'https://example.com/page'), error => error instanceof SearchError && error.code === entry.code && !error.message.includes('private-secret'));
    }
    assert.equal(requests, 0);
  } finally { state.store.close(); }
});
void test('provider timeout has a separate safe diagnostic from cancellation', async () => {
  const state = setup((_url, options) => new Promise((_resolve, reject: (reason: Error) => void) => {
    const keepAlive = setTimeout(() => reject(new Error('timeout signal did not fire')), 3000);
    options?.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(new Error('private-secret')); }, { once: true });
  }));
  try {
    const settings = state.configure(); const { revision, ...configuration } = settings;
    state.service.update({ ...configuration, timeoutMs: 1000 }, revision);
    await assert.rejects(state.service.search(state.input, 'test'), error => error instanceof SearchError && error.code === 'provider_timeout' && error.status === 504 && !error.message.includes('private-secret'));
  } finally { state.store.close(); }
});
