import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ConversationSchema, TranscriptEntrySchema, type Conversation, type TranscriptEntry } from '../../contracts/src/management.js';
import { MessageEventSchema } from '../../contracts/src/index.js';
import { MessageContextBuilder } from '../../adapters/src/messages/context.js';
const RowSchema = z.object({ id: z.string(), value: z.string() });
const ItemSchema = z.record(z.string(), z.unknown());
const ItemsSchema = z.array(ItemSchema);
const KeySchema = z.tuple([z.string(), z.string(), z.number().int().nonnegative(), z.enum(['operator', 'senior_operator', 'elite_operator']), z.number().int().nonnegative()]);
const PrincipalKeySchema = z.tuple([z.string(), z.enum(['private', 'group']), z.string(), z.string()]);
const MIGRATION = 'dynamic-context-v1';
export interface ContextMigrationReport { readonly histories: number; readonly changedHistories: number; readonly changedMessages: number; readonly alreadyMigrated: number; readonly blockedHistories: number; readonly applied: boolean; }
function parsed(value: string): unknown { return JSON.parse(value); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function firstText(item: Record<string, unknown>): string | undefined { if (item.role !== 'user') return undefined; if (typeof item.content === 'string') return item.content; if (!Array.isArray(item.content)) return undefined; const first = ItemSchema.safeParse(item.content[0]); return first.success && first.data.type === 'input_text' && typeof first.data.text === 'string' ? first.data.text : undefined; }
function replaceFirst(item: Record<string, unknown>, text: string): Record<string, unknown> { if (typeof item.content === 'string') return { ...item, content: text }; if (!Array.isArray(item.content)) throw new Error('Invalid first input text'); const content = z.array(ItemSchema).parse(item.content); return { ...item, content: content.map((part, index) => index === 0 ? { ...part, text } : part) }; }
function immutablePrefix(prefix: string, conversation: Conversation, entry: TranscriptEntry): string | undefined {
  const marker = '\n\n<retrieved_context>\n'; const index = prefix.indexOf(marker); if (index < 0) return undefined;
  const immutable = prefix.slice(0, index); const mutable = prefix.slice(index + 2);
  const event = MessageEventSchema.parse({ platform: conversation.platform, platformType: conversation.platformType, sessionId: conversation.sessionId, sessionType: conversation.sessionType, senderId: entry.senderId, senderName: entry.senderName, messageId: entry.messageId, timestamp: entry.timestamp, parts: entry.parts, botId: 'migration-metadata-only' });
  const expected = new MessageContextBuilder().prepare(event).context.match(/^<context_unit name="message_meta" id="[a-f0-9]{20}">\n[\s\S]*?\n<\/context_unit>/)?.[0];
  if (!expected || !immutable.startsWith(expected)) throw new Error('Unverified metadata');
  let rest = immutable; let metaCount = 0;
  while (rest) {
    const unit = /^<context_unit name="(message_meta|attachments|quoted_message|group_history)" id="([a-f0-9]{20})">\n([\s\S]*?)\n<\/context_unit>/.exec(rest);
    if (unit) { const [whole, name, id, body] = unit; if (name === undefined || body === undefined || id === undefined || whole === undefined) throw new Error('Invalid unit'); if (name === 'message_meta') metaCount++; const key = JSON.stringify([event.platform, event.sessionType, event.sessionId, event.messageId]); if (hash(`${key}:${name}:${body}`).slice(0, 20) !== id) throw new Error('Unverified context unit'); rest = rest.slice(whole.length); }
    else { const speaker = /^<speaker_change>\nThe current sender ID is ([^\n]*); the previous sender ID was ([^\n]*)\. Treat their requests separately\.\n<\/speaker_change>/.exec(rest); if (!speaker?.[0]) throw new Error('Unknown immutable context'); rest = rest.slice(speaker[0].length); }
    if (rest) { if (!rest.startsWith('\n\n')) throw new Error('Unexpected context separator'); rest = rest.slice(2); }
  }
  if (metaCount !== 1) throw new Error('Ambiguous metadata');
  const retrieved = /^<retrieved_context>\n([^\n]*)\n<\/retrieved_context>/.exec(mutable); if (!retrieved?.[0] || !retrieved[1]?.startsWith('{"memories":')) throw new Error('Unknown retrieved context framing');
  let tail = mutable.slice(retrieved[0].length);
  if (tail) {
    const catalog = /^\n<available_skills>\n([^\n]*)\nLoad SKILL\.md with read_skill before following it\.\n<\/available_skills>/.exec(tail);
    if (!catalog?.[0] || catalog[1] === undefined) throw new Error('Unknown skill catalog framing');
    z.array(z.object({ name: z.string(), library: z.string(), description: z.string() }).strict()).parse(parsed(catalog[1])); tail = tail.slice(catalog[0].length);
    if (tail && !/^\n<requested_skill name="(?:[^"\\]|\\.)*">\n[\s\S]*\n<\/requested_skill>$/.test(tail)) throw new Error('Unknown requested skill framing');
  }
  return immutable;
}
/** Offline only: dry runs never mutate runs, SDK state, or SQLite schema. */
export function migrateContextState(db: DatabaseSync, apply = false): ContextMigrationReport {
  const rows = (namespace: string) => db.prepare('SELECT id,value FROM documents WHERE namespace=? ORDER BY id').all(namespace).map(row => RowSchema.parse(row));
  const histories = rows('sdk-history'); const conversations = rows('management-conversations').map(row => ConversationSchema.parse(parsed(row.value))); const entries = rows('management-transcript').map(row => TranscriptEntrySchema.parse(parsed(row.value)));
  const archived = new Set(rows('sdk-history-legacy-dynamic-archive').map(row => row.id));
  const changes: { id: string; original: string; updated: string; messages: number }[] = []; let blockedHistories = 0; let alreadyMigrated = 0;
  for (const row of histories) {
    if (archived.has(row.id)) { alreadyMigrated++; continue; }
    try {
      const items = ItemsSchema.parse(parsed(row.value)); let messages = 0;
      const next = items.map(item => {
        const text = firstText(item); if (text === undefined || !text.includes('<retrieved_context>')) return item;
        // Plain user-authored tag text is not a host context envelope. Old summaries
        // containing mutable context cannot be proven clean and must block activation.
        if (!text.startsWith('<context_unit name="message_meta"')) { if (text.startsWith('[Earlier conversation extract;')) throw new Error('Summary contains legacy mutable context'); return item; }
        const [principalJson, agentId, generation] = KeySchema.parse(parsed(row.id)); const [platform, sessionType, sessionId, senderId] = PrincipalKeySchema.parse(parsed(principalJson));
        const matches = conversations.filter(c => c.platform === platform && c.sessionType === sessionType && c.sessionId === sessionId && c.agentId === agentId && c.generation === generation && (sessionType === 'group' || c.ownerId === senderId));
        const candidates = entries.filter(e => e.role === 'user' && e.senderId === senderId && matches.some(c => c.id === e.conversationId)); let rewritten: string | undefined; let matchesCount = 0;
        for (const entry of candidates) {
          const suffix = `\n\n${entry.parts.filter(part => part.type === 'text').map(part => part.text).join('\n')}`;
          if (!text.endsWith(suffix)) continue;
          const conversation = matches.find(c => c.id === entry.conversationId); if (!conversation) continue;
          const prefix = text.slice(0, text.length - suffix.length);
          const expectedMessageId = `\nMessage ID: ${entry.messageId.slice(0, 256).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}\n</context_unit>`;
          if (!prefix.includes(expectedMessageId)) continue;
          const immutable = immutablePrefix(prefix, conversation, entry);
          if (immutable === undefined) { if (!prefix.includes('<retrieved_context>')) { rewritten = text; matchesCount++; } continue; }
          rewritten = immutable + suffix; matchesCount++;
        }
        if (matchesCount !== 1 || rewritten === undefined) throw new Error('Legacy context lacks unique transcript provenance');
        if (rewritten !== text) messages++; return replaceFirst(item, rewritten);
      });
      if (messages) changes.push({ id: row.id, original: row.value, updated: JSON.stringify(next), messages });
    } catch { blockedHistories++; }
  }
  const report: ContextMigrationReport = { histories: histories.length, changedHistories: changes.length, changedMessages: changes.reduce((sum, item) => sum + item.messages, 0), alreadyMigrated, blockedHistories, applied: false };
  if (blockedHistories || !apply) return report;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const change of changes) {
      const current = db.prepare('SELECT value FROM documents WHERE namespace=? AND id=?').get('sdk-history', change.id); if (!current || z.object({ value: z.string() }).parse(current).value !== change.original) throw new Error('SDK history changed during offline migration');
      db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('sdk-history-legacy-dynamic-archive', change.id, JSON.stringify({ migration: MIGRATION, archivedAt: Date.now(), originalJson: change.original, originalSha256: hash(change.original) }));
      db.prepare('UPDATE documents SET value=? WHERE namespace=? AND id=?').run(change.updated, 'sdk-history', change.id);
    }
    db.exec('COMMIT'); return { ...report, applied: true };
  } catch { db.exec('ROLLBACK'); throw new Error('Context migration transaction failed; no histories changed'); }
}
