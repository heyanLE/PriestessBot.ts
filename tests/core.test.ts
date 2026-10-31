import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AgentDefinitionSchema, AgentIdSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type AgentDefinition, type RunContext } from '../packages/contracts/src/index.js';
import { AuthorizationService, ConversationScheduler, DelegationService, FlowService, KnowledgeService, MemoryService, RuntimeStore, CommandRegistry, conversationKey, principalKey, historyKey, createBuiltinCommands, simulateFlow, tokenizeCommand, validateConfiguration, dryRunMigration, LocalHashEmbedding, migrateConfigurationFile, importLegacyDatabase } from '../packages/core/src/index.js';

const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', capabilities: ['chat', 'knowledge.read', 'memory.read', 'memory.write', 'conversation.stop', 'conversation.reset', 'resources.manage', 'agent.delegate'], resources: { memoryLibraries: ['memory'], knowledgeLibraries: ['knowledge'] } });
const grant = GrantSchema.parse({ platform: 'tg', senderId: 'alice', maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities: agent.capabilities, resources: agent.resources });
const message = MessageEventSchema.parse({ platform: 'tg', platformType: 'telegram', sessionId: 'group', sessionType: 'group', senderId: 'alice', messageId: 'm1', timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text: 'hello' }, { type: 'mention', userId: 'bot' }] });
function setup() {
  const store = new RuntimeStore(':memory:'); const auth = new AuthorizationService([grant], store);
  const principal = { platform: message.platform, sessionId: message.sessionId, senderId: message.senderId };
  const context: RunContext = { runId: RunIdSchema.parse('run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  return { store, auth, context };
}
const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], memoryLibraries: [{ id: 'memory', displayName: 'Memory' }], knowledgeLibraries: [{ id: 'knowledge', displayName: 'Knowledge' }], grants: [grant], flow: { routing: { defaultAgentId: 'agent', rules: [] } } });

void test('identity state is scoped to sender, platform and session; revoked grants reject active effects', () => {
  const { store, auth, context } = setup();
  assert.throws(() => auth.requestState(context.principal, 'senior_operator'), /管理员分配/);
  auth.replaceGrants([{ ...grant, state: 'senior_operator', sessionId: context.principal.sessionId }]);
  assert.equal(auth.state({ ...context.principal, senderId: 'bob' }), 'operator');
  assert.throws(() => auth.requestState({ ...context.principal, senderId: 'bob' }, 'elite_operator'));
  assert.equal(auth.state(context.principal), 'senior_operator');
  auth.replaceGrants([]);
  assert.throws(() => auth.assert(context, 'memory.write', agent));
  store.close();
});
void test('flow rejects topology and invalid Agent references; previews have no dedupe side effects and publication is atomic', () => {
  const { store, auth } = setup(); const flow = new FlowService(store, auth);
  assert.equal(validateConfiguration(config).valid, true);
  assert.equal(validateConfiguration({ ...config, flow: { ...config.flow, nodes: [] } }).valid, false);
  assert.equal(validateConfiguration({ ...config, flow: { ...config.flow, routing: { defaultAgentId: 'missing', rules: [] } } }).valid, false);
  assert.equal(flow.simulate(config, message).outcome, 'agent'); assert.equal(flow.simulate(config, message).outcome, 'agent');
  assert.equal(flow.accept(config, message).outcome, 'agent'); assert.equal(flow.accept(config, message).outcome, 'ignored');
  const published = flow.publish(config, 0); assert.equal(published.revision, 1);
  assert.equal(Object.isFrozen(published.agents), true);
  assert.throws(() => flow.publish(config, 0)); assert.equal(store.getConfig()?.revision, 1);
  assert.equal(simulateFlow(config, { ...message, parts: [{ type: 'text', text: 'unaddressed' }] }).outcome, 'ignored');
  const limited = { ...config, flow: { ...config.flow, acceptance: { ...config.flow.acceptance, rateLimitCount: 1 } } };
  const stop = { ...message, messageId: 'stop-after-limit', parts: MessageEventSchema.shape.parts.parse([{ type: 'text', text: '/stop' }]) };
  assert.equal(flow.accept(limited, stop).outcome, 'command');
  store.close();
});
void test('cancel rejects pending work without executing it and an aborted active signal reaches work', async () => {
  const scheduler = new ConversationScheduler(1, 3); let ranPending = false;
  const active = scheduler.enqueue('a', signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
  const pending = scheduler.enqueue('a', () => { ranPending = true; return Promise.resolve(); });
  const rejected = assert.rejects(pending, /Stopped/); scheduler.cancel('a'); await rejected; await active;
  assert.equal(ranPending, false); assert.equal(scheduler.pending, 0); await scheduler.shutdown();
});
void test('knowledge rejects incompatible index dimensions and permits explicit rebuild', async () => {
  const { store, auth, context } = setup(); const original = new KnowledgeService(store, auth);
  const doc = await original.importDocument(context, agent, { libraryId: 'knowledge', name: 'text', mimeType: 'text/plain', pages: [{ text: 'Agent routing knowledge' }] });
  const altered = new KnowledgeService(store, auth, { model: 'replacement-v2', dimensions: 2, embed: texts => Promise.resolve(texts.map(() => [1, 0])) });
  await assert.rejects(altered.search(context, agent, 'routing'), /rebuild/);
  assert.equal((await altered.rebuild(context, agent, doc.id)).status, 'ready');
  assert.equal((await altered.search(context, agent, 'routing')).length, 1);
  const broken = new KnowledgeService(store, auth, { model: 'broken', dimensions: 2, embed: () => Promise.resolve([]) });
  assert.equal((await broken.importDocument(context, agent, { libraryId: 'knowledge', name: 'bad', mimeType: 'text/plain', pages: [{ text: 'anything' }] })).status, 'failed');
  const local = new LocalHashEmbedding(); assert.equal((await local.embed(['中文路由'], context.signal))[0]?.length, 256); store.close();
});
void test('RAG rechecks revocation after embedding before exposing hits', async () => {
  const { store, auth, context } = setup(); const knowledge = new KnowledgeService(store, auth);
  await knowledge.importDocument(context, agent, { libraryId: 'knowledge', name: 'secret', mimeType: 'text/plain', pages: [{ text: 'secret' }] });
  const base = new LocalHashEmbedding(); const revoking = new KnowledgeService(store, auth, { model: base.model, dimensions: base.dimensions, embed: texts => { auth.replaceGrants([]); return base.embed(texts, context.signal); } });
  await assert.rejects(revoking.search(context, agent, 'secret'), /Authorization changed/); store.close();
});
void test('child shared count and concurrency budgets cannot be bypassed by further calls', async () => {
  const { store, auth, context } = setup(); const child = AgentDefinitionSchema.parse({ ...agent, id: 'child' });
  const parent = { ...agent, delegationTargets: [child.id] };
  const service = new DelegationService(auth, () => child, () => ({ id: 'agents_sdk', version: 'test', capabilities: { streaming: false, images: false, files: false, cancellation: true, approvals: false, steering: false }, run: () => Promise.resolve({ status: 'completed', text: '', inputTokens: 1, outputTokens: 1 }) }));
  const limited = { ...context, budget: { ...context.budget, maxDelegations: 1 } };
  await service.delegate(limited, parent, child.id, 'task', message, () => undefined);
  await assert.rejects(service.delegate(limited, parent, child.id, 'task again', message, () => undefined), /budget/);
  service.release(context.runId); store.close();
});
void test('migration requires explicit NORMAL mapping and never approximates unsupported routes or engines', () => {
  const legacy = { schemaVersion: 3, agents: [{ id: 'first', type: 'NORMAL', llm: { providerRef: 'p', model: 'm' } }], llms: [{ id: 'p', type: 'openai', credentialRef: { key: 'PRIVATE_API_KEY' } }], ims: [{ id: 'tg', type: 'telegram', routes: [{ id: 'exact', match: { textMode: 'EXACT', textPattern: 'hi' }, action: { agentId: 'first' } }] }] };
  const disabled = dryRunMigration(legacy); assert.equal(disabled.config?.agents[0]?.enabled, false); assert.equal(disabled.canActivate, false);
  const explicit = dryRunMigration(legacy, { mapNormalToAgentsSdk: true }); assert.equal(explicit.config?.agents[0]?.enabled, true); assert.equal(explicit.config?.platforms[0]?.enabled, false); assert.equal(explicit.canActivate, false); assert.ok(explicit.diagnostics.some(diagnostic => diagnostic.entity.includes('exact') && diagnostic.severity === 'error'));
  const codex = dryRunMigration({ ...legacy, agents: [{ id: 'first', type: 'CODEX', llm: { providerRef: 'p', model: 'm' } }] }, { mapNormalToAgentsSdk: true }); assert.equal(codex.config?.agents[0]?.enabled, false);
  assert.equal(dryRunMigration({ runtime: 'rust', schemaVersion: 1 }).canActivate, false);
});
void test('commands preserve quoted arguments and never fall through on malformed recognized commands', async () => {
  const { store, auth, context } = setup(); const registry = new CommandRegistry(auth); let executed = 0;
  registry.register({ name: 'echo', aliases: ['e'], usage: '/echo <text>', argsSchema: z.tuple([z.string()]), parse: tokens => tokens, minimumState: 'operator', requiredCapabilities: ['chat'], execute: (_context, [text]) => { executed += 1; return Promise.resolve(text); }, reply: text => ({ parts: [{ type: 'text', text }] }) });
  assert.deepEqual(tokenizeCommand('echo "hello world" escaped\\ value'), ['echo', 'hello world', 'escaped value']);
  assert.equal((await registry.dispatch('/echo "unfinished', context, agent)).status, 'rejected');
  assert.equal((await registry.dispatch('/echo a b', context, agent)).status, 'rejected'); assert.equal(executed, 0);
  assert.equal((await registry.dispatch('/e "hello world"', context, agent)).status, 'handled'); assert.equal(executed, 1);
  assert.equal((await registry.dispatch('/unknown', context, agent)).status, 'unhandled');
  store.close();
});
void test('scheduler serializes a session, advances other sessions and bypasses running work for stop/reset', async () => {
  const scheduler = new ConversationScheduler(2, 1); const order: string[] = []; let release: (() => void) | undefined;
  const first = scheduler.enqueue('a', () => new Promise<void>(resolve => { release = resolve; order.push('a1'); }));
  const second = scheduler.enqueue('a', () => { order.push('a2'); return Promise.resolve(); });
  await assert.rejects(scheduler.enqueue('a', () => Promise.resolve()));
  await scheduler.enqueue('b', () => { order.push('b'); return Promise.resolve(); });
  assert.deepEqual(order, ['a1', 'b']); if (release === undefined) throw new Error('Missing release'); release(); await first; await second; assert.deepEqual(order, ['a1', 'b', 'a2']);
  const { store, auth, context } = setup(); const commands = createBuiltinCommands(auth, store, scheduler);
  assert.equal(commands.isControl('/STOP'), true);
  const blocking = scheduler.enqueue(conversationKey(context.principal, context.agentId), signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
  const reset = await commands.dispatch('/reset', context, agent); assert.equal(reset.status, 'handled'); await blocking;
  assert.throws(() => auth.assert(context, 'chat', agent)); assert.equal(store.generation(conversationKey(context.principal, context.agentId)), 1);
  await scheduler.shutdown(); store.close();
});
void test('memory is principal scoped, automatic extraction remains private and deletion is immediate', async () => {
  const { store, auth, context } = setup(); const memory = new MemoryService(store, auth);
  const record = memory.remember(context, agent, { libraryId: 'memory', text: 'Likes green tea', source: 'user' });
  const bob = { ...context, principal: { ...context.principal, senderId: 'bob' }, ...auth.resolve({ ...context.principal, senderId: 'bob' }, agent) };
  assert.equal(memory.recall(bob, agent, 'tea').length, 0); assert.equal(memory.recall(context, agent, 'tea').length, 1);
  const extracted = await memory.extract(context, agent, 'memory', 'group/m1', 'mixed group text', { extract: () => Promise.resolve([{ text: 'Likes books', confidence: 0.8 }]) });
  assert.equal(extracted[0]?.scope, 'sender'); memory.delete(context, agent, record.id); assert.equal(memory.recall(context, agent, 'tea').some(item => item.id === record.id), false); store.close();
});
void test('knowledge uses authorized hybrid retrieval, page provenance, rebuild and consistent delete', async () => {
  const { store, auth, context } = setup(); const knowledge = new KnowledgeService(store, auth);
  const document = await knowledge.importDocument(context, agent, { libraryId: 'knowledge', name: 'manual.pdf', mimeType: 'application/pdf', pages: [{ text: 'The router chooses the target Agent with deterministic rules.', page: 3 }] });
  assert.equal(document.status, 'ready');
  const hits = await knowledge.search(context, agent, 'router Agent'); assert.equal(hits[0]?.page, 3);
  const restricted = { ...context, resources: { ...context.resources, knowledgeLibraries: [] } };
  assert.equal((await knowledge.search(restricted, agent, 'router')).length, 0);
  const rebuilt = await knowledge.rebuild(context, agent, document.id); assert.equal(rebuilt.version, 2);
  knowledge.delete(context, agent, document.id); assert.equal((await knowledge.search(context, agent, 'router')).length, 0); store.close();
});
void test('delegation cannot gain target permissions, is bounded and preserves original principal', async () => {
  const { store, auth, context: originalContext } = setup(); const context: RunContext = { ...originalContext, ...auth.resolve(originalContext.principal, agent, 'senior_operator') }; const child = AgentDefinitionSchema.parse({ ...agent, id: 'child', capabilities: [...agent.capabilities, 'admin'] });
  const parent: AgentDefinition = { ...agent, delegationTargets: [AgentIdSchema.parse('child')] };
  const service = new DelegationService(auth, id => id === 'child' ? child : undefined, () => ({ id: 'agents_sdk', version: 'test', capabilities: { streaming: true, images: false, files: false, cancellation: true, approvals: false, steering: false }, run: input => { assert.equal(input.context.principal.senderId, 'alice'); assert.equal(input.context.effectiveCapabilities.includes('admin'), false); assert.equal(input.context.agentId, 'child'); return Promise.resolve({ status: 'completed', text: 'child answer', inputTokens: 3, outputTokens: 5 }); } }));
  assert.equal((await service.delegate(context, parent, 'child', 'task', message, () => undefined)).text, 'child answer');
  await assert.rejects(service.delegate({ ...context, depth: context.budget.maxDelegationDepth }, parent, 'child', 'task', message, () => undefined));
  service.release(context.runId); store.close();
});
void test('SQLite restart preserves generations/events and marks in-flight effects interrupted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-core-'));
  try {
    const path = join(directory, 'runtime.sqlite'); const first = new RuntimeStore(path);
    first.reset('session'); first.saveRun({ id: 'old-run', sessionKey: 'session', agentId: 'agent', senderId: 'alice', generation: 1, status: 'running', createdAt: 1, updatedAt: 1, summary: '' });
    first.appendEvent({ type: 'started', runId: RunIdSchema.parse('old-run'), turnId: 'turn', sequence: 0, timestamp: 1, agentId: agent.id }); first.close();
    const second = new RuntimeStore(path); assert.equal(second.generation('session'), 1); assert.equal(second.runs()[0]?.status, 'interrupted'); assert.equal(second.events('old-run').length, 1); second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
void test('migration dry-run does not write, backups are byte exact and apply is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-migration-'));
  const { writeFile } = await import('node:fs/promises');
  try {
    const source = join(directory, 'legacy.json'); const text = JSON.stringify(config, null, 2); await writeFile(source, text);
    const dry = await migrateConfigurationFile(source, join(directory, 'target')); assert.equal(dry.outputPath, undefined);
    const applied = await migrateConfigurationFile(source, join(directory, 'target'), { apply: true });
    if (applied.backupPath === undefined) throw new Error('Missing backup'); assert.equal(await readFile(applied.backupPath, 'utf8'), text);
    const repeated = await migrateConfigurationFile(source, join(directory, 'target'), { apply: true }); assert.equal(repeated.outputPath, applied.outputPath); assert.equal(await readFile(source, 'utf8'), text);
    await assert.rejects(migrateConfigurationFile(source, directory, { apply: true }), /separate/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
void test('nested delegation borrows its parent allocation without double-reserving the root budget', async () => {
  const { store, auth, context } = setup();
  const grand = AgentDefinitionSchema.parse({ ...agent, id: 'grand' });
  const child = AgentDefinitionSchema.parse({ ...agent, id: 'child', delegationTargets: [grand.id] });
  const parent = { ...agent, delegationTargets: [child.id] };
  const service: DelegationService = new DelegationService(auth, id => id === 'child' ? child : grand, () => ({ id: 'agents_sdk', version: 'test', capabilities: { streaming: false, images: false, files: false, cancellation: true, approvals: false, steering: false }, run: async input => {
    if (input.context.agentId === child.id) await service.delegate(input.context, child, grand.id, 'nested', message, () => undefined);
    return { status: 'completed', text: 'done', inputTokens: 1, outputTokens: 1 };
  } }));
  assert.equal((await service.delegate(context, parent, child.id, 'task', message, () => undefined)).text, 'done'); service.release(context.runId); store.close();
});
void test('legacy SQLite import preserves owned resources and archives ambiguous history without SDK replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-data-migration-')); const target = new RuntimeStore(':memory:');
  try {
    const sourcePath = join(directory, 'old.sqlite'); const source = new DatabaseSync(sourcePath);
    source.exec(`CREATE TABLE memory_records(id TEXT,library_id TEXT,scope TEXT,platform_id TEXT,session_id TEXT,user_id TEXT,agent_name TEXT,content TEXT,confidence REAL,created_at INTEGER,updated_at INTEGER,expires_at INTEGER,deleted_at INTEGER);
      CREATE TABLE personas(id TEXT,name TEXT,description TEXT,tone TEXT,boundaries TEXT,system_prompt_template TEXT,example_dialogs TEXT,enabled INTEGER,agent_names TEXT,error_messages TEXT,deleted_at INTEGER);
      CREATE TABLE knowledge_bases(id TEXT,name TEXT,description TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE knowledge_chunks(id TEXT,knowledge_base_id TEXT,document_name TEXT,content TEXT,created_at INTEGER);
      CREATE TABLE conversations(id TEXT,platform TEXT,session_id TEXT,agent_id TEXT,created_at INTEGER,updated_at INTEGER);
      CREATE TABLE messages(id TEXT,conversation_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,created_at INTEGER);`);
    source.prepare('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('private', 'memory', 'USER', 'tg', 'group', 'alice', 'agent', 'Likes tea', 1, 1, 1, null, null);
    source.prepare('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('global', 'memory', 'GLOBAL', null, null, null, null, 'Shared old data', 1, 1, 1, null, null);
    source.prepare('INSERT INTO personas VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('persona', 'Warm', 'Helpful', 'Warm voice', 'No private data', 'Answer clearly', '[]', 1, '["agent"]', '{}', null);
    source.prepare('INSERT INTO knowledge_bases VALUES(?,?,?,?,?)').run('old-knowledge', 'Manuals', '', 1, 1);
    source.prepare('INSERT INTO knowledge_chunks VALUES(?,?,?,?,?)').run('chunk', 'old-knowledge', 'manual.txt', 'Legacy manual text', 1);
    source.prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?)').run('chat', 'tg', 'group', 'agent', 1, 2);
    source.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run('msg', 'chat', 'tool', 'private tool result', null, null, 2); source.close();
    const before = await readFile(sourcePath);
    const dry = await importLegacyDatabase(sourcePath, target, config, { backupDirectory: join(directory, 'backup'), memorySessionTypes: { private: 'group' } });
    assert.equal(dry.counts.memories, 1); assert.equal(dry.counts.archivedMemories, 1); assert.equal(target.list('memories', z.unknown()).length, 0);
    const applied = await importLegacyDatabase(sourcePath, target, config, { backupDirectory: join(directory, 'backup'), memorySessionTypes: { private: 'group' }, apply: true });
    assert.equal(applied.counts.documents, 1); assert.match(applied.config.agents[0]?.persona ?? '', /Warm voice/); assert.ok(applied.backupPath);
    assert.equal(target.list('memories', z.unknown()).length, 1); assert.equal(target.list('legacy-memory-archive', z.unknown()).length, 1);
    assert.equal(target.list('legacy-messages', z.unknown()).length, 1); assert.equal(target.list('sdk-history', z.unknown()).length, 0);
    await importLegacyDatabase(sourcePath, target, config, { backupDirectory: join(directory, 'backup'), memorySessionTypes: { private: 'group' }, apply: true }); assert.equal(target.list('memories', z.unknown()).length, 1);
    assert.deepEqual(await readFile(sourcePath), before);
  } finally { target.close(); await rm(directory, { recursive: true, force: true }); }
});
void test('memory consolidation is bounded, preserves provenance and keeps another sender untouched', () => {
  const { store, auth, context } = setup(); const memory = new MemoryService(store, auth);
  memory.remember(context, agent, { libraryId: 'memory', text: 'Likes  tea', source: 'first' }); memory.remember(context, agent, { libraryId: 'memory', text: 'likes tea', source: 'second' });
  memory.remember(context, agent, { libraryId: 'memory', text: 'Expired', source: 'old', expiresAt: 1 });
  const result = memory.consolidate(context, agent, 'memory'); assert.equal(result.duplicatesRemoved, 1); assert.equal(result.expiredRemoved, 1);
  const remaining = memory.recall(context, agent, 'tea'); assert.equal(remaining.length, 1); assert.match(remaining[0]?.source ?? '', /first/); assert.match(remaining[0]?.source ?? '', /second/); store.close();
});
void test('deleting a document during embedding cannot resurrect its import or return stale search hits', async () => {
  const { store, auth, context } = setup(); const base = new LocalHashEmbedding(); let resume: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const deferred = new KnowledgeService(store, auth, { model: base.model, dimensions: base.dimensions, embed: async (texts, signal) => { await gate; return base.embed(texts, signal); } });
  const importing = deferred.importDocument(context, agent, { libraryId: 'knowledge', name: 'pending', mimeType: 'text/plain', pages: [{ text: 'Do not resurrect' }] });
  const document = deferred.documents()[0]; if (document === undefined || resume === undefined) throw new Error('Import did not start');
  deferred.delete(context, agent, document.id); resume(); assert.equal((await importing).status, 'failed'); assert.equal(deferred.documents().length, 0);
  const normal = new KnowledgeService(store, auth); const indexed = await normal.importDocument(context, agent, { libraryId: 'knowledge', name: 'ready', mimeType: 'text/plain', pages: [{ text: 'Secret router content' }] });
  let finish: (() => void) | undefined; const searchGate = new Promise<void>(resolve => { finish = resolve; });
  const delayedSearch = new KnowledgeService(store, auth, { model: base.model, dimensions: base.dimensions, embed: async (texts, signal) => { await searchGate; return base.embed(texts, signal); } });
  const searching = delayedSearch.search(context, agent, 'router'); normal.delete(context, agent, indexed.id); if (finish === undefined) throw new Error('Missing search release'); finish();
  assert.deepEqual(await searching, []); store.close();
});
void test('authorization domain version survives restart instead of reopening an earlier broader history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-grant-version-'));
  try {
    const path = join(directory, 'runtime.sqlite'); const first = new RuntimeStore(path); first.publishConfig(config, 0);
    const initial = new AuthorizationService(config.grants, first); const principal = { platform: 'tg', sessionId: message.sessionId, senderId: 'alice' };
    assert.equal(initial.resolve(principal, agent).grantVersion, 1);
    first.publishConfig({ ...config, grants: [] }, 1); initial.replaceGrants([]);
    const restrictedVersion = initial.resolve(principal, agent).grantVersion; assert.equal(restrictedVersion, 2); first.close();
    const reopened = new RuntimeStore(path); const restored = new AuthorizationService([], reopened);
    assert.equal(restored.resolve(principal, agent).grantVersion, restrictedVersion); reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
void test('parent cancellation reaches child engine and rejects its late result', async () => {
  const { store, auth, context } = setup(); const child = AgentDefinitionSchema.parse({ ...agent, id: 'child' }); const parent = { ...agent, delegationTargets: [child.id] }; const controller = new AbortController(); let cancelled = false;
  const service = new DelegationService(auth, () => child, () => ({ id: 'agents_sdk', version: 'test', capabilities: { streaming: false, images: false, files: false, cancellation: true, approvals: false, steering: false }, run: input => new Promise(resolve => {
    input.context.signal.addEventListener('abort', () => { cancelled = true; resolve({ status: 'cancelled', text: 'late', inputTokens: 0, outputTokens: 0 }); }, { once: true });
  }) }));
  const running = service.delegate({ ...context, signal: controller.signal }, parent, child.id, 'wait', message, () => undefined);
  const rejected = assert.rejects(running); controller.abort(); await rejected; assert.equal(cancelled, true); service.release(context.runId); store.close();
});
void test('private and group chats sharing a platform ID never share permissions, state, memory, generations or dedupe', () => {
  const { store } = setup();
  const privatePrincipal = { platform: 'tg', sessionId: message.sessionId, senderId: 'alice', sessionType: 'private' as const };
  const groupPrincipal = { ...privatePrincipal, sessionType: 'group' as const };
  const auth = new AuthorizationService([{ ...grant, sessionId: message.sessionId, sessionType: 'private' }], store);
  assert.equal(auth.state(privatePrincipal), 'elite_operator'); assert.equal(auth.state(groupPrincipal), 'operator');
  assert.throws(() => auth.requestState(privatePrincipal, 'senior_operator'), /管理员分配/); assert.equal(auth.state(groupPrincipal), 'operator');
  assert.notEqual(principalKey(privatePrincipal), principalKey(groupPrincipal)); assert.notEqual(conversationKey(privatePrincipal, agent.id), conversationKey(groupPrincipal, agent.id));
  const context: RunContext = { runId: RunIdSchema.parse('type-run'), turnId: 'turn', principal: privatePrincipal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(privatePrincipal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  const groupContext: RunContext = { ...context, principal: groupPrincipal, ...auth.resolve(groupPrincipal, agent) };
  assert.notEqual(historyKey(context), historyKey(groupContext));
  const memory = new MemoryService(store, auth); memory.remember(context, agent, { libraryId: 'memory', text: 'PRIVATE_SECRET', source: 'direct' }); assert.equal(memory.recall(groupContext, agent, 'PRIVATE_SECRET').length, 0);
  store.reset(conversationKey(privatePrincipal, agent.id)); assert.equal(store.generation(conversationKey(groupPrincipal, agent.id)), 0);
  const flow = new FlowService(store, auth);
  assert.equal(flow.accept(config, { ...message, sessionType: 'private' }).outcome, 'agent');
  assert.equal(flow.accept(config, { ...message, sessionType: 'group' }).outcome, 'agent'); store.close();
});
void test('draft authorization simulation uses proposed grants without changing live authority or claiming messages', () => {
  const { store, auth } = setup(); const flow = new FlowService(store, auth);
  const draft = { ...config, grants: [] };
  assert.equal(flow.simulate(draft, message).runtimeState, 'operator');
  assert.equal(flow.accept(config, message).runtimeState, 'elite_operator');
  assert.equal(auth.state({ platform: message.platform, senderId: message.senderId, sessionId: message.sessionId }), 'elite_operator'); store.close();
});
void test('a group sender can stop only their own active and queued work', async () => {
  const { store, auth, context } = setup(); const scheduler = new ConversationScheduler(1, 8); const commands = createBuiltinCommands(auth, store, scheduler);
  const alice: RunContext = { ...context, principal: { ...context.principal, sessionType: 'group' } };
  const bobPrincipal = { ...alice.principal, senderId: 'bob' }; const bob: RunContext = { ...context, principal: bobPrincipal, ...auth.resolve(bobPrincipal, agent) };
  const key = conversationKey(alice.principal, agent.id); let aliceAborted = false; let finish: (() => void) | undefined; let aliceQueuedRan = false;
  const active = scheduler.enqueue(key, signal => new Promise<void>(resolve => { finish = resolve; signal.addEventListener('abort', () => { aliceAborted = true; resolve(); }, { once: true }); }), principalKey(alice.principal));
  const bobQueued = scheduler.enqueue(key, () => Promise.resolve(), principalKey(bob.principal)); const bobRejected = assert.rejects(bobQueued, /Stopped/);
  const aliceQueued = scheduler.enqueue(key, () => { aliceQueuedRan = true; return Promise.resolve(); }, principalKey(alice.principal));
  assert.equal((await commands.dispatch('/stop', bob, agent)).status, 'handled'); await bobRejected;
  assert.equal(aliceAborted, false); assert.equal(scheduler.pending, 1);
  if (finish === undefined) throw new Error('Missing active release'); finish(); await active; await aliceQueued; assert.equal(aliceQueuedRan, true);
  await scheduler.shutdown(); store.close();
});
void test('stop invalidates only the sender’s paused approval while authorized reset invalidates all paused work', async () => {
  const { store, auth, context } = setup(); const scheduler = new ConversationScheduler(); const commands = createBuiltinCommands(auth, store, scheduler);
  const alice: RunContext = { ...context, principal: { ...context.principal, sessionType: 'group' } };
  const bobPrincipal = { ...alice.principal, senderId: 'bob' }; const bob: RunContext = { ...context, principal: bobPrincipal, ...auth.resolve(bobPrincipal, agent) };
  const key = conversationKey(alice.principal, agent.id);
  for (const sender of ['alice', 'bob']) {
    store.saveRun({ id: `paused-${sender}`, sessionKey: key, senderId: sender, agentId: agent.id, generation: 0, status: 'paused', createdAt: 1, updatedAt: 1, summary: `Approval required: approval-${sender}` });
    store.put('paused-inputs', `paused-${sender}`, { pending: true }); store.put('sdk-pauses', `approval-${sender}`, { pending: true });
  }
  await commands.dispatch('/stop', bob, agent);
  assert.equal(store.runs().find(run => run.id === 'paused-bob')?.status, 'cancelled'); assert.equal(store.runs().find(run => run.id === 'paused-alice')?.status, 'paused');
  assert.equal(store.get('sdk-pauses', 'approval-bob', z.unknown()), undefined); assert.equal(store.get('paused-inputs', 'paused-bob', z.unknown()), undefined);
  assert.notEqual(store.get('sdk-pauses', 'approval-alice', z.unknown()), undefined);
  await commands.dispatch('/reset', alice, agent); assert.equal(store.runs().find(run => run.id === 'paused-alice')?.status, 'cancelled'); assert.equal(store.get('sdk-pauses', 'approval-alice', z.unknown()), undefined);
  await scheduler.shutdown(); store.close();
});
