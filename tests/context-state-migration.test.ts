import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { z } from 'zod';
import { MessageEventSchema } from '../packages/contracts/src/index.js';
import { ConversationSchema, TranscriptEntrySchema } from '../packages/contracts/src/management.js';
import { MessageContextBuilder } from '../packages/adapters/src/messages/context.js';
import { migrateContextState } from '../packages/core/src/context-state-migration.js';
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE documents(namespace TEXT,id TEXT,value TEXT,PRIMARY KEY(namespace,id))');
  function put(namespace: string, id: string, value: unknown): void { db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?)').run(namespace, id, JSON.stringify(value)); }
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'chat', sessionType: 'group', senderId: 'alice', senderName: 'Alice', messageId: 'm1', timestamp: 1000, botId: 'bot', parts: [{ type: 'text', text: '正文包含 <retrieved_context>user-authored</retrieved_context>' }, { type: 'quote', messageId: 'quoted', text: '引文保持' }] });
  const key = JSON.stringify([JSON.stringify(['qq', 'group', 'chat', 'alice']), 'assistant', 0, 'operator', 1]);
  const conversation = ConversationSchema.parse({ id: 'c1', identity: 'identity', sessionKey: 'scope', platform: 'qq', platformType: 'napcat', sessionId: 'chat', sessionType: 'group', agentId: 'assistant', generation: 0, ownerId: 'first-other-user', title: 'group', revision: 1, createdAt: 1, updatedAt: 1 }); put('management-conversations', conversation.id, conversation);
  const entry = TranscriptEntrySchema.parse({ schemaVersion: 1, id: 'e1', conversationId: conversation.id, runId: 'r1', role: 'user', senderId: message.senderId, senderName: message.senderName, messageId: message.messageId, timestamp: message.timestamp, parts: message.parts }); put('management-transcript', entry.id, entry);
  const immutable = new MessageContextBuilder().prepare(message).context; const suffix = '\n\n' + message.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const dynamic = '\n\n<retrieved_context>\n{"memories":[{"text":"old-private-memory"}],"knowledge":[]}\n</retrieved_context>\n<available_skills>\n[{"name":"weather","library":"default","description":"weather skill"}]\nLoad SKILL.md with read_skill before following it.\n</available_skills>\n<requested_skill name="weather">\nold skill body\n</requested_skill>';
  const tail = [{ type: 'function_call', callId: 'call-1', name: 'lookup', arguments: '{}' }, { type: 'function_call_result', callId: 'call-1', output: 'Actual past tool result' }, { role: 'assistant', content: [{ type: 'output_text', text: 'Past reply preserved' }] }];
  const attach = { type: 'input_text', text: '<attachment name="report.txt">\nFile preserved\n</attachment>' };
  const history = [{ role: 'user', content: [{ type: 'input_text', text: immutable + dynamic + suffix }, attach] }, ...tail]; put('sdk-history', key, history); put('runs', 'r1', { status: 'running' });
  function value(namespace: string, id: string): unknown { const row = db.prepare('SELECT value FROM documents WHERE namespace=? AND id=?').get(namespace, id); return row === undefined ? undefined : z.object({ value: z.string() }).parse(row); }
  return { db, put, value, key, history, immutable, suffix, entry, conversation, tail, attach };
}
void test('offline migration verifies provenance, archives originals, preserves tools/attachments/user tags and is idempotent', () => {
  const f = fixture(); try { const before = f.value('sdk-history', f.key); const runs = f.value('runs', 'r1'); const preview = migrateContextState(f.db); assert.equal(preview.changedMessages, 1); assert.equal(preview.blockedHistories, 0); assert.deepEqual(f.value('sdk-history', f.key), before); assert.deepEqual(f.value('runs', 'r1'), runs);
    const applied = migrateContextState(f.db, true); assert.equal(applied.applied, true); const expected = [{ role: 'user', content: [{ type: 'input_text', text: f.immutable + f.suffix }, f.attach] }, ...f.tail]; assert.deepEqual(f.value('sdk-history', f.key), { value: JSON.stringify(expected) }); assert.ok(f.value('sdk-history-legacy-dynamic-archive', f.key)); assert.deepEqual(f.value('runs', 'r1'), runs); assert.equal(migrateContextState(f.db, true).alreadyMigrated, 1);
  } finally { f.db.close(); }
});
void test('missing transcript, wrong sender/generation or altered body block all writes', () => {
  for (const kind of ['missing', 'sender', 'generation', 'body']) { const f = fixture(); try {
    if (kind === 'missing') f.db.exec("DELETE FROM documents WHERE namespace='management-transcript'");
    if (kind === 'sender') f.put('management-transcript', f.entry.id, { ...f.entry, senderId: 'bob' });
    if (kind === 'generation') f.put('management-conversations', f.conversation.id, { ...f.conversation, generation: 2 });
    if (kind === 'body') f.put('management-transcript', f.entry.id, { ...f.entry, parts: [{ type: 'text', text: 'different' }] });
    const before = f.value('sdk-history', f.key); const report = migrateContextState(f.db, true); assert.equal(report.blockedHistories, 1, kind); assert.equal(report.applied, false); assert.deepEqual(f.value('sdk-history', f.key), before); assert.equal(f.value('sdk-history-legacy-dynamic-archive', f.key), undefined);
  } finally { f.db.close(); } }
});
void test('bare user tags remain untouched; orphan envelopes prevent partial migration', () => {
  const f = fixture(); try { f.put('sdk-history', 'plain-user-history', [{ role: 'user', content: '<retrieved_context>my literal text</retrieved_context>' }]); assert.equal(migrateContextState(f.db).blockedHistories, 0);
    f.put('sdk-history', 'orphan-history', f.history); const original = f.value('sdk-history', f.key); const report = migrateContextState(f.db, true); assert.equal(report.blockedHistories, 1); assert.equal(report.applied, false); assert.deepEqual(f.value('sdk-history', f.key), original); assert.equal(f.value('sdk-history-legacy-dynamic-archive', f.key), undefined);
  } finally { f.db.close(); }
});
void test('new empty histories require no migration', () => { const db = new DatabaseSync(':memory:'); try { db.exec('CREATE TABLE documents(namespace TEXT,id TEXT,value TEXT,PRIMARY KEY(namespace,id))'); assert.equal(migrateContextState(db).changedHistories, 0); } finally { db.close(); } });
