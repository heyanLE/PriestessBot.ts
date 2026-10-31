import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MessageEventSchema } from '../packages/contracts/src/index.js';
import { conversationKey, principalKey } from '../packages/core/src/authorization.js';
import { ConversationHistoryResetSchema, conversationHistoryNamespaces, conversationHistoryResetNamespace } from '../packages/core/src/conversation-history.js';
import { ManagementService } from '../packages/core/src/management.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { clearConversationHistory } from '../tools/clear-conversation-history.js';

const message = MessageEventSchema.parse({ platform: 'qq-private-test', platformType: 'napcat', sessionId: 'private-test-room', sessionType: 'group', sessionName: '测试群', senderId: 'private-test-sender', senderName: 'Alice', messageId: 'old-message', timestamp: 1, botId: 'test-bot', parts: [{ type: 'text', text: 'PRIVATE_CHAT_CONTENT' }] });
const key = conversationKey(message, 'assistant');
const countRow = z.object({ count: z.number().int() });
const valueRow = z.object({ value: z.string() });
function count(db: DatabaseSync, namespace: string): number { return countRow.parse(db.prepare('SELECT COUNT(*) AS count FROM documents WHERE namespace=?').get(namespace)).count; }
function saved(db: DatabaseSync, namespace: string, id: string): string { return valueRow.parse(db.prepare('SELECT value FROM documents WHERE namespace=? AND id=?').get(namespace, id)).value; }

async function fixture(): Promise<{ directory: string; database: string; conversationId: string; retained: ReadonlyMap<string, string> }> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-clear-history-')); const database = join(directory, 'runtime.sqlite');
  const store = new RuntimeStore(database);
  try {
    const service = new ManagementService(store); const conversation = service.captureInbound(message, 'assistant', 2, 'old-run', key); assert.ok(conversation);
    service.captureReply('old-run', [{ type: 'text', text: 'PRIVATE_REPLY' }]);
    store.saveRun({ id: 'old-run', sessionKey: key, agentId: 'assistant', senderId: message.senderId, generation: 2, status: 'completed', createdAt: 1, updatedAt: 2, summary: 'AUDIT_SUMMARY_RETAINED' });
    store.saveRun({ id: 'unlinked-newer-audit', sessionKey: key, agentId: 'assistant', senderId: message.senderId, generation: 7, status: 'completed', createdAt: 5, updatedAt: 6, summary: '' });
    store.saveRun({ id: 'ignored-run', sessionKey: conversationKey(message, 'none'), agentId: '', senderId: message.senderId, generation: 0, status: 'completed', createdAt: 1, updatedAt: 1, summary: 'Ignored public chatter' });
    store.db.prepare('INSERT INTO sessions(id,generation) VALUES(?,?)').run(key, 1);
    store.db.prepare('INSERT INTO events VALUES(?,?,?)').run('old-run', 1, JSON.stringify({ type: 'test-audit', text: 'AUDIT_EVENT_RETAINED' }));
    store.db.prepare('INSERT INTO configuration VALUES(?,?,?)').run(1, JSON.stringify({ apiKey: 'PRIVATE_CREDENTIAL_RETAINED' }), 1);
    const sdkId = JSON.stringify([principalKey(message), 'assistant', 2, 'operator', 1]);
    store.put('sdk-history', sdkId, [{ role: 'user', content: 'PRIVATE_SDK_CONTEXT' }]);
    const scope = JSON.stringify([message.platform, 'group', message.sessionId, 'assistant', 'assistant', 2]);
    store.put('public-group-conversations', scope, { turns: [] });
    for (const namespace of conversationHistoryNamespaces) if (!['management-conversations', 'management-transcript', 'management-run-links', 'sdk-history', 'public-group-conversations'].includes(namespace)) store.put(namespace, 'old-context', { text: 'PRIVATE_CONTEXT' });
    store.put('management-folders', 'old-chat-folder', { kind: 'conversation', name: 'PRIVATE_FOLDER' });
    store.db.exec('CREATE TABLE group_message_search(id INTEGER PRIMARY KEY,scope TEXT,value TEXT); CREATE TABLE group_message_search_seeds(scope TEXT PRIMARY KEY)');
    store.db.prepare('INSERT INTO group_message_search VALUES(?,?,?)').run(1, scope, 'PRIVATE_GROUP_SEARCH');
    store.db.prepare('INSERT INTO group_message_search_seeds VALUES(?)').run(scope);
    const retained = new Map<string, string>();
    for (const namespace of ['management-personas', 'management-persona-bindings', 'memories', 'memory-consolidations', 'knowledge-documents', 'knowledge-chunks', 'knowledge-source', 'sdk-compactions', 'artifacts', 'tool-outputs', 'approvals', 'deliveries', 'astrbotx-archive-personas', 'operator-secrets']) {
      store.put(namespace, 'retained', { text: `RETAIN_${namespace}` }); retained.set(namespace, saved(store.db, namespace, 'retained'));
    }
    store.put('management-folders', 'persona-folder', { kind: 'persona', name: 'Persona folder' });
    return { directory, database, conversationId: conversation.id, retained };
  } finally { store.close(); }
}

void test('history clear dry-run reports counts without printing content or changing run statuses', async () => {
  const source = await fixture();
  try {
    const db = new DatabaseSync(source.database); db.prepare("UPDATE documents SET value=json_set(value,'$.status','running') WHERE namespace='runs' AND id='old-run'").run(); const before = saved(db, 'runs', 'old-run'); db.close();
    const report = await clearConversationHistory({ database: source.database, dryRun: true });
    assert.equal(report.applied, false); assert.equal(report.backupCreated, false); assert.equal(report.activeRuns, 1); assert.equal(report.documentsToRemove['management-conversations'], 1); assert.equal(report.auditRunsRetained, 3);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|private-test|old-run|测试群/);
    const after = new DatabaseSync(source.database, { readOnly: true }); try { assert.equal(saved(after, 'runs', 'old-run'), before); assert.equal(count(after, 'management-transcript'), 2); assert.equal(count(after, conversationHistoryResetNamespace), 0); } finally { after.close(); }
    assert.equal((await readdir(source.directory)).some(name => name.includes('backup')), false);
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});

void test('history clear requires stopped runtime and rejects active or paused work before backup', async () => {
  const source = await fixture();
  try {
    await assert.rejects(clearConversationHistory({ database: source.database, apply: true }), /runtime-stopped/);
    await assert.rejects(clearConversationHistory({ database: source.database, apply: true, dryRun: true, runtimeStopped: true }), /either/);
    for (const status of ['queued', 'running', 'paused']) {
      const db = new DatabaseSync(source.database); db.prepare("UPDATE documents SET value=json_set(value,'$.status',?) WHERE namespace='runs' AND id='old-run'").run(status); db.close();
      await assert.rejects(clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true }), /Active or paused/);
    }
    assert.equal((await readdir(source.directory)).some(name => name.includes('backup')), false);
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});

void test('offline clear backs up, removes all context, preserves audits and resources, and allows new NapCat history', async () => {
  const source = await fixture();
  try {
    const report = await clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true });
    assert.equal(report.applied, true); assert.equal(report.auditRunsRetained, 3); assert.equal(report.auditEventsRetained, 1); assert.equal(report.configurationRevisionsRetained, 1); assert.ok(report.backupPath);
    assert.equal((await stat(report.backupPath)).mode & 0o777, 0o600);
    const backupDb = new DatabaseSync(report.backupPath, { readOnly: true }); try { assert.equal(count(backupDb, 'management-transcript'), 2); assert.equal(count(backupDb, 'sdk-history'), 1); assert.equal(count(backupDb, conversationHistoryResetNamespace), 0); } finally { backupDb.close(); }
    const empty = await clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true }); assert.equal(empty.alreadyClear, true); assert.equal(empty.applied, false); assert.equal(empty.generationsAdvanced, 0);
    const store = new RuntimeStore(source.database);
    try {
      for (const namespace of conversationHistoryNamespaces) assert.equal(count(store.db, namespace), 0, namespace);
      for (const [namespace, value] of source.retained) assert.equal(saved(store.db, namespace, 'retained'), value, namespace);
      assert.equal(count(store.db, 'management-folders'), 1); assert.equal(count(store.db, 'runs'), 3); assert.equal(countRow.parse(store.db.prepare('SELECT COUNT(*) AS count FROM events').get()).count, 1);
      assert.match(valueRow.parse(store.db.prepare('SELECT value FROM configuration').get()).value, /PRIVATE_CREDENTIAL_RETAINED/);
      assert.equal(countRow.parse(store.db.prepare('SELECT COUNT(*) AS count FROM group_message_search').get()).count, 0); assert.equal(countRow.parse(store.db.prepare('SELECT COUNT(*) AS count FROM group_message_search_seeds').get()).count, 0);
      assert.equal(store.generation(key), 8, 'Advance beyond highest audit generation, even if sessions lag behind');
      assert.equal(store.get(conversationHistoryResetNamespace, key, ConversationHistoryResetSchema)?.minimumGeneration, 8);
      const service = new ManagementService(store); service.recoverRuns(); assert.deepEqual(service.conversations({ archived: 'all' }), []);
      assert.equal(service.captureInbound(message, 'assistant', 7, 'late-old-run', key), undefined); service.captureReply('old-run', [{ type: 'text', text: 'late reply' }]); assert.deepEqual(service.conversations(), []);
      const fresh = service.captureInbound({ ...message, messageId: 'new-message' }, 'assistant', store.generation(key), 'fresh-run', key); assert.ok(fresh); assert.notEqual(fresh.id, source.conversationId); assert.equal(fresh.title, 'QQ · 群聊 · 测试群 (private-test-room)');
      store.saveRun({ id: 'fresh-run', sessionKey: key, agentId: 'assistant', senderId: message.senderId, generation: 8, status: 'completed', createdAt: Date.now(), updatedAt: Date.now(), summary: '' });
      service.captureReply('fresh-run', [{ type: 'text', text: 'Fresh answer' }]); service.recoverRuns(); assert.equal(service.conversations().length, 1); assert.equal(service.detail(fresh.id).entries.length, 2); assert.deepEqual(service.detail(fresh.id).runIds, ['fresh-run']);
    } finally { store.close(); }
    const reopened = new RuntimeStore(source.database); try { const service = new ManagementService(reopened); service.recoverRuns(); assert.equal(service.conversations().length, 1); } finally { reopened.close(); }
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});

void test('a failed clearing transaction rolls back generations and history while preserving the backup', async () => {
  const source = await fixture();
  try {
    const db = new DatabaseSync(source.database); db.exec("CREATE TRIGGER prevent_reset BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'test reset denied'); END"); db.close();
    await assert.rejects(clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true }), /test reset denied/);
    const check = new DatabaseSync(source.database, { readOnly: true }); try { assert.equal(count(check, 'management-conversations'), 1); assert.equal(count(check, 'management-transcript'), 2); assert.equal(count(check, conversationHistoryResetNamespace), 0); assert.equal(SessionGeneration.parse(check.prepare('SELECT generation FROM sessions WHERE id=?').get(key)).generation, 1); } finally { check.close(); }
    const files = await readdir(source.directory); assert.equal(files.filter(name => name.includes('conversation-history-backup')).length, 1);
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});
const SessionGeneration = z.object({ generation: z.number() });

void test('invalid history metadata refuses to clear and never creates a replacement database', async () => {
  const source = await fixture();
  try {
    const db = new DatabaseSync(source.database); db.prepare("UPDATE documents SET value=json_set(value,'$.generation',-1) WHERE namespace='runs' AND id='old-run'").run(); db.close();
    await assert.rejects(clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true }));
    await assert.rejects(clearConversationHistory({ database: join(source.directory, 'missing.sqlite'), apply: true, runtimeStopped: true }), /ENOENT/);
    assert.equal((await readdir(source.directory)).some(name => name.includes('backup') || name === 'missing.sqlite'), false);
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});

void test('legacy SDK history archives and malformed group keys clear without deleting compaction audits', async () => {
  const source = await fixture();
  try {
    const db = new DatabaseSync(source.database);
    db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('sdk-history-legacy-dynamic-archive', 'legacy-original', JSON.stringify({ originalJson: 'PRIVATE_OLD_MODEL_BODY', migration: 'context-state' }));
    db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('public-group-conversations', 'legacy-non-json-key', JSON.stringify({ turns: [] }));
    db.prepare('INSERT INTO group_message_search VALUES(?,?,?)').run(2, 'legacy-non-json-key', 'PRIVATE_OLD_GROUP_BODY');
    db.prepare('INSERT INTO group_message_search_seeds VALUES(?)').run('legacy-non-json-key'); db.close();
    const dryRun = await clearConversationHistory({ database: source.database, dryRun: true }); assert.equal(dryRun.documentsToRemove['sdk-history-legacy-dynamic-archive'], 2); assert.equal(dryRun.tablesToClear.group_message_search, 2);
    const report = await clearConversationHistory({ database: source.database, apply: true, runtimeStopped: true }); assert.equal(report.applied, true); assert.ok(report.backupPath);
    const check = new DatabaseSync(source.database, { readOnly: true });
    try { assert.equal(count(check, 'sdk-history-legacy-dynamic-archive'), 0); assert.equal(count(check, 'public-group-conversations'), 0); assert.equal(countRow.parse(check.prepare('SELECT COUNT(*) AS count FROM group_message_search').get()).count, 0); assert.equal(countRow.parse(check.prepare('SELECT COUNT(*) AS count FROM group_message_search_seeds').get()).count, 0); assert.equal(count(check, 'sdk-compactions'), 1); } finally { check.close(); }
    const backedUp = new DatabaseSync(report.backupPath, { readOnly: true }); try { assert.match(saved(backedUp, 'sdk-history-legacy-dynamic-archive', 'legacy-original'), /PRIVATE_OLD_MODEL_BODY/); } finally { backedUp.close(); }
  } finally { await rm(source.directory, { recursive: true, force: true }); }
});
