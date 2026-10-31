import { randomUUID } from 'node:crypto';
import { chmod, open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { ConversationHistoryResetSchema, conversationHistoryNamespaces, conversationHistoryResetNamespace } from '../packages/core/src/conversation-history.js';

const Generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const Count = z.object({ count: z.number().int().nonnegative() });
const Metadata = z.object({ id: z.string(), sessionKey: z.string(), generation: Generation });
const RunMetadata = Metadata.extend({ status: z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted']) });
const SessionRow = z.object({ id: z.string(), generation: Generation });
const IdRow = z.object({ id: z.string() });
const ResetRow = z.object({ id: z.string(), minimumGeneration: Generation });
const GroupScope = z.tuple([z.string(), z.literal('group'), z.string(), z.string(), z.string(), Generation]);
const SdkScope = z.tuple([z.string(), z.string(), Generation, z.string(), z.number()]);
const Principal = z.tuple([z.string(), z.enum(['private', 'group']), z.string(), z.string()]);

export interface ClearConversationHistoryOptions { database: string; apply?: boolean; runtimeStopped?: boolean; dryRun?: boolean; }
export interface ClearConversationHistoryReport {
  applied: boolean; alreadyClear: boolean; backupCreated: boolean; backupPath?: string; clearedAt?: number;
  activeRuns: number; generationsAdvanced: number; tombstonesAdded: number;
  documentsToRemove: Record<string, number>; tablesToClear: Record<string, number>; conversationFoldersToRemove: number;
  auditRunsRetained: number; auditEventsRetained: number; configurationRevisionsRetained: number;
}
function json(value: string): unknown { const parsed: unknown = JSON.parse(value); return parsed; }
function tableExists(db: DatabaseSync, table: string): boolean { return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined; }
function dataVersion(db: DatabaseSync): number { return z.object({ data_version: z.number().int() }).parse(db.prepare('PRAGMA data_version').get()).data_version; }

/** Offline only. Reads metadata and counts, never prints message bodies, identities or credentials. */
export async function clearConversationHistory(options: ClearConversationHistoryOptions): Promise<ClearConversationHistoryReport> {
  if (options.apply && options.dryRun) throw new Error('Choose either --apply or --dry-run');
  if (options.apply && !options.runtimeStopped) throw new Error('--apply requires --runtime-stopped');
  const database = resolve(options.database);
  if (!(await stat(database)).isFile()) throw new Error('Database must be an existing file');
  const db = new DatabaseSync(database, { readOnly: !options.apply }); let transaction = false;
  try {
    const initialVersion = dataVersion(db);
    const runs = db.prepare("SELECT id,json_extract(value,'$.sessionKey') AS sessionKey,json_extract(value,'$.generation') AS generation,json_extract(value,'$.status') AS status FROM documents WHERE namespace='runs'").all().map(row => RunMetadata.parse(row));
    const conversations = db.prepare("SELECT id,json_extract(value,'$.sessionKey') AS sessionKey,json_extract(value,'$.generation') AS generation FROM documents WHERE namespace='management-conversations'").all().map(row => Metadata.parse(row));
    const resets = db.prepare("SELECT id,json_extract(value,'$.minimumGeneration') AS minimumGeneration FROM documents WHERE namespace=?").all(conversationHistoryResetNamespace).map(row => ResetRow.parse(row));
    const floors = new Map(resets.map(row => [row.id, row.minimumGeneration]));
    const generations = new Map<string, number>();
    const include = (key: string, generation: number): void => { generations.set(key, Math.max(generations.get(key) ?? 0, generation)); };
    for (const row of db.prepare('SELECT id,generation FROM sessions').all()) { const session = SessionRow.parse(row); include(session.id, session.generation); }
    for (const row of [...runs, ...conversations]) include(row.sessionKey, row.generation);
    for (const reset of resets) include(reset.id, reset.minimumGeneration);
    const includeGroup = (id: string): void => {
      let raw: unknown; try { raw = json(id); } catch { return; }
      const scope = GroupScope.safeParse(raw);
      if (scope.success) { const [platform, type, sessionId, , owner, generation] = scope.data; include(JSON.stringify([platform, type, sessionId, owner]), generation); }
    };
    for (const row of db.prepare("SELECT id FROM documents WHERE namespace='public-group-conversations'").all()) includeGroup(IdRow.parse(row).id);
    for (const row of db.prepare("SELECT id FROM documents WHERE namespace='sdk-history'").all()) {
      // Legacy SDK keys without the current JSON tuple format are deleted too.
      let raw: unknown; try { raw = json(IdRow.parse(row).id); } catch { continue; }
      const scope = SdkScope.safeParse(raw); if (!scope.success) continue;
      let principalRaw: unknown; try { principalRaw = json(scope.data[0]); } catch { continue; }
      const principal = Principal.safeParse(principalRaw); if (!principal.success) continue;
      const [platform, type, sessionId] = principal.data; include(JSON.stringify([platform, type, sessionId, scope.data[1]]), scope.data[2]);
    }
    const tablesToClear: Record<string, number> = {};
    if (tableExists(db, 'group_message_search')) {
      tablesToClear.group_message_search = Count.parse(db.prepare('SELECT COUNT(*) AS count FROM group_message_search').get()).count;
      for (const row of db.prepare('SELECT DISTINCT scope AS id FROM group_message_search').all()) includeGroup(IdRow.parse(row).id);
    }
    if (tableExists(db, 'group_message_search_seeds')) {
      tablesToClear.group_message_search_seeds = Count.parse(db.prepare('SELECT COUNT(*) AS count FROM group_message_search_seeds').get()).count;
      for (const row of db.prepare('SELECT scope AS id FROM group_message_search_seeds').all()) includeGroup(IdRow.parse(row).id);
    }
    const documentsToRemove: Record<string, number> = {};
    for (const namespace of conversationHistoryNamespaces) documentsToRemove[namespace] = Count.parse(db.prepare('SELECT COUNT(*) AS count FROM documents WHERE namespace=?').get(namespace)).count;
    const folderCount = Count.parse(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE namespace='management-folders' AND json_extract(value,'$.kind')='conversation'").get()).count;
    const activeRuns = runs.filter(run => ['running', 'queued', 'paused'].includes(run.status)).length;
    const hasRecords = [...Object.values(documentsToRemove), ...Object.values(tablesToClear), folderCount].some(count => count > 0);
    const hasUnclearedAudit = runs.some(run => run.generation >= (floors.get(run.sessionKey) ?? 0));
    const alreadyClear = !hasRecords && !hasUnclearedAudit;
    const report: ClearConversationHistoryReport = {
      applied: false, alreadyClear, backupCreated: false, activeRuns,
      generationsAdvanced: alreadyClear ? 0 : generations.size,
      tombstonesAdded: conversations.filter(conversation => db.prepare("SELECT 1 FROM documents WHERE namespace='management-tombstones' AND id=?").get(conversation.id) === undefined).length,
      documentsToRemove, tablesToClear, conversationFoldersToRemove: folderCount,
      auditRunsRetained: runs.length,
      auditEventsRetained: Count.parse(db.prepare('SELECT COUNT(*) AS count FROM events').get()).count,
      configurationRevisionsRetained: Count.parse(db.prepare('SELECT COUNT(*) AS count FROM configuration').get()).count,
    };
    if (!options.apply) return report;
    if (activeRuns > 0) throw new Error('Active or paused tasks exist. Stop or cancel them before clearing history');
    if (alreadyClear) return report;
    const backupPath = `${database}.conversation-history-backup-${Date.now()}-${randomUUID()}.sqlite`;
    const destination = await open(backupPath, 'wx', 0o600); await destination.close();
    await backup(db, backupPath); await chmod(backupPath, 0o600);
    report.backupCreated = true; report.backupPath = backupPath;
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    if (dataVersion(db) !== initialVersion) throw new Error('Database changed during backup. Stop the runtime and retry');
    const clearedAt = Date.now();
    for (const [key, generation] of generations) {
      const minimumGeneration = generation + 1;
      const reset = ConversationHistoryResetSchema.parse({ minimumGeneration, clearedAt });
      db.prepare('INSERT INTO sessions(id,generation) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation').run(key, minimumGeneration);
      db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run(conversationHistoryResetNamespace, key, JSON.stringify(reset));
    }
    for (const conversation of conversations) db.prepare('INSERT OR IGNORE INTO documents(namespace,id,value) VALUES(?,?,?)').run('management-tombstones', conversation.id, JSON.stringify({ id: conversation.id, deletedAt: clearedAt }));
    for (const namespace of conversationHistoryNamespaces) db.prepare('DELETE FROM documents WHERE namespace=?').run(namespace);
    db.prepare("DELETE FROM documents WHERE namespace='management-folders' AND json_extract(value,'$.kind')='conversation'").run();
    if (tableExists(db, 'group_message_search')) db.exec('DELETE FROM group_message_search');
    if (tableExists(db, 'group_message_search_seeds')) db.exec('DELETE FROM group_message_search_seeds');
    report.applied = true; report.clearedAt = clearedAt;
    db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('maintenance-reports', `clear-conversation-history:${randomUUID()}`, JSON.stringify(report));
    db.exec('COMMIT'); transaction = false;
    return report;
  } catch (error) { if (transaction) db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

async function main(): Promise<void> {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, apply: { type: 'boolean', default: false }, 'runtime-stopped': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false } } });
    if (!values.database) throw new Error('Use --database <runtime.sqlite> [--dry-run | --apply --runtime-stopped]');
    const report = await clearConversationHistory({ database: values.database, apply: values.apply, runtimeStopped: values['runtime-stopped'], dryRun: values['dry-run'] });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch { process.stderr.write('Conversation history clear failed. Check the existing database, stopped runtime, active tasks and backup permissions. No message bodies or credentials are printed.\n'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
