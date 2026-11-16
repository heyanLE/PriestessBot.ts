import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/**
 * One-shot rename of the historical `astrbotx` data identifiers to `priestess`.
 *
 * Scope is stored identity only: namespaces, document ids, JSON references and
 * environment key names. The external source system keeps its own name in prose,
 * links and archive paths; those are not identifiers this runtime resolves.
 *
 * Dry run by default. Two backup modes exist because a multi-hundred-megabyte
 * database may not fit beside itself on a full disk:
 *
 * - `full` (default): copy the database file, WAL and SHM.
 * - `rows`: export only the rows that change, plus the affected configuration
 *   revisions and session ids. Restore with `--restore` after a rollback.
 *
 * Every rule is a literal token and the write path runs in one transaction, so a
 * second run is a no-op and a failure leaves the database untouched.
 */

/** Ordered literal rules. Longer tokens first so a prefix never shadows a full id. */
export const IDENTIFIER_TOKENS: readonly (readonly [string, string])[] = Object.freeze([
  ['ASTRBOTX_MODEL_', 'PRIESTESS_MODEL_'],
  ['ASTRBOTX_NAPCAT_', 'PRIESTESS_NAPCAT_'],
  ['astrbotx-archive-', 'priestess-archive-'],
  ['astrbotx-template-', 'priestess-template-'],
  ['astrbotx-skills', 'priestess-skills'],
  ['astrbotx-memory', 'priestess-memory'],
  ['astrbotx-local', 'priestess-local'],
  ['astrbotx-import', 'priestess-import'],
  ['astrbotx:', 'priestess:'],
]);

/** Ids that are the bare legacy name rather than a prefixed key. */
const EXACT_IDS: readonly { readonly namespace: string; readonly from: string; readonly to: string }[] = Object.freeze([
  { namespace: 'migration-reports', from: 'astrbotx', to: 'legacy' },
]);

export function rewriteIdentifiers(text: string): string {
  let value = text;
  for (const [from, to] of IDENTIFIER_TOKENS) value = value.split(from).join(to);
  return value;
}

function rewriteKey(namespace: string, id: string): { namespace: string; id: string } {
  for (const rule of EXACT_IDS) if (rule.namespace === namespace && rule.from === id) return { namespace, id: rule.to };
  return { namespace: rewriteIdentifiers(namespace), id: rewriteIdentifiers(id) };
}

/** Rewrite `KEY=value` env text in place, preserving comments, order and unrelated keys. */
export function rewriteEnv(text: string): { readonly text: string; readonly renamed: number } {
  let renamed = 0;
  const lines = text.split('\n').map(line => {
    const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(=.*)$/.exec(line);
    if (!match?.[2] || match[3] === undefined) return line;
    const next = rewriteIdentifiers(match[2]);
    if (next === match[2]) return line;
    renamed++;
    return `${match[1] ?? ''}${next}${match[3]}`;
  });
  return { text: lines.join('\n'), renamed };
}

export interface MigrationCounts {
  readonly namespaces: number;
  readonly ids: number;
  readonly values: number;
  readonly configurations: number;
  readonly sessions: number;
  readonly envKeys: number;
  readonly fileMoves: readonly string[];
}

export type BackupMode = 'full' | 'rows';

export interface MigrationOptions {
  readonly database: string;
  readonly env?: string;
  readonly files?: string;
  readonly apply?: boolean;
  readonly backup?: BackupMode;
}

export interface MigrationReport {
  readonly database: string;
  readonly applied: boolean;
  readonly backupMode: BackupMode;
  readonly backup: string;
  readonly counts: MigrationCounts;
  readonly samples: readonly string[];
}

interface DocumentRow { readonly namespace: string; readonly id: string; readonly value: string }
interface ConfigRow { readonly revision: number; readonly value: string }
interface SessionRow { readonly id: string }

const RowBackupSchema = z.object({
  format: z.literal('priestess-identifier-rows-v1'),
  createdAt: z.string(),
  documents: z.array(z.object({ namespace: z.string(), id: z.string(), value: z.string() })),
  configurations: z.array(z.object({ revision: z.number(), value: z.string() })),
  sessions: z.array(z.object({ id: z.string() })),
});

const EMPTY_COUNTS: MigrationCounts = { namespaces: 0, ids: 0, values: 0, configurations: 0, sessions: 0, envKeys: 0, fileMoves: [] };

async function exists(path: string): Promise<boolean> { return stat(path).then(() => true).catch(() => false); }

/**
 * Only rows that could change are read. A 490 MB database has six figures of
 * documents but a few hundred candidates, so this keeps memory bounded.
 */
function candidates(db: DatabaseSync): DocumentRow[] {
  return z.array(z.object({ namespace: z.string(), id: z.string(), value: z.string() })).parse(
    db.prepare("SELECT namespace,id,value FROM documents WHERE namespace LIKE '%astrbotx%' OR id LIKE '%astrbotx%' OR value LIKE '%astrbotx%'").all(),
  );
}

function changes(row: DocumentRow): boolean {
  const key = rewriteKey(row.namespace, row.id);
  return key.namespace !== row.namespace || key.id !== row.id || rewriteIdentifiers(row.value) !== row.value;
}

export function planCounts(rows: readonly DocumentRow[], configurations: readonly ConfigRow[], sessions: readonly SessionRow[]): { counts: MigrationCounts; changed: DocumentRow[] } {
  const changed = rows.filter(changes);
  return {
    counts: {
      namespaces: changed.filter(row => rewriteKey(row.namespace, row.id).namespace !== row.namespace).length,
      ids: changed.filter(row => rewriteKey(row.namespace, row.id).id !== row.id).length,
      values: changed.filter(row => rewriteIdentifiers(row.value) !== row.value).length,
      configurations: configurations.filter(row => rewriteIdentifiers(row.value) !== row.value).length,
      sessions: sessions.filter(row => rewriteIdentifiers(row.id) !== row.id).length,
      envKeys: 0,
      fileMoves: [],
    },
    changed,
  };
}

function readScope(db: DatabaseSync, documents: readonly DocumentRow[] = []): { documents: DocumentRow[]; configurations: ConfigRow[]; sessions: SessionRow[] } {
  return {
    documents: documents.length ? [...documents] : candidates(db),
    configurations: z.array(z.object({ revision: z.number(), value: z.string() })).parse(db.prepare("SELECT revision,value FROM configuration WHERE value LIKE '%astrbotx%'").all()),
    sessions: z.array(z.object({ id: z.string() })).parse(db.prepare("SELECT id FROM sessions WHERE id LIKE '%astrbotx%'").all()),
  };
}

export async function migrateIdentifiers(options: MigrationOptions): Promise<MigrationReport> {
  if (!(await exists(options.database))) throw new Error(`Database not found: ${options.database}`);
  const mode: BackupMode = options.backup ?? 'full';

  if (!options.apply) {
    const db = new DatabaseSync(options.database, { readOnly: true });
    try {
      const scope = readScope(db);
      const { counts, changed } = planCounts(scope.documents, scope.configurations, scope.sessions);
      return { database: options.database, applied: false, backupMode: mode, backup: '', counts, samples: changed.slice(0, 10).map(row => `${row.namespace}/${row.id} -> ${rewriteKey(row.namespace, row.id).id}`) };
    } finally { db.close(); }
  }

  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
  const backup = mode === 'full' ? `${options.database}.pre-priestess-${stamp}` : `${options.database}.pre-priestess-${stamp}.rows.json`;
  const db = new DatabaseSync(options.database);
  let counts = EMPTY_COUNTS;
  try {
    db.exec('PRAGMA journal_mode=WAL');
    const scope = readScope(db);

    if (mode === 'full') {
      await copyFile(options.database, backup);
      await chmod(backup, 0o600);
      for (const suffix of ['-wal', '-shm']) {
        if (!(await exists(`${options.database}${suffix}`))) continue;
        await copyFile(`${options.database}${suffix}`, `${backup}${suffix}`);
        await chmod(`${backup}${suffix}`, 0o600);
      }
    } else {
      await writeFile(backup, JSON.stringify({ format: 'priestess-identifier-rows-v1', createdAt: new Date().toISOString(), ...scope }), { mode: 0o600 });
      await chmod(backup, 0o600);
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare('UPDATE documents SET namespace=?,id=?,value=? WHERE namespace=? AND id=?');
      const remove = db.prepare('DELETE FROM documents WHERE namespace=? AND id=?');
      const insert = db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value');
      const existsKey = db.prepare('SELECT 1 AS present FROM documents WHERE namespace=? AND id=?');
      for (const row of scope.documents) {
        if (!changes(row)) continue;
        const key = rewriteKey(row.namespace, row.id);
        const value = rewriteIdentifiers(row.value);
        // Never merge into a key that already exists under the new name.
        if ((key.namespace !== row.namespace || key.id !== row.id) && existsKey.get(key.namespace, key.id) !== undefined) throw new Error(`Identifier collision for ${key.namespace}/${key.id}; refusing a partial merge`);
        // A renamed key is delete-then-insert: the old row is gone, so UPDATE would match nothing.
        if (key.namespace !== row.namespace || key.id !== row.id) { remove.run(row.namespace, row.id); insert.run(key.namespace, key.id, value); }
        else update.run(row.namespace, row.id, value, row.namespace, row.id);
        counts = {
          ...counts,
          namespaces: counts.namespaces + (key.namespace === row.namespace ? 0 : 1),
          ids: counts.ids + (key.id === row.id ? 0 : 1),
          values: counts.values + (value === row.value ? 0 : 1),
        };
      }
      const updateConfig = db.prepare('UPDATE configuration SET value=? WHERE revision=?');
      for (const row of scope.configurations) {
        const value = rewriteIdentifiers(row.value);
        if (value === row.value) continue;
        updateConfig.run(value, row.revision);
        counts = { ...counts, configurations: counts.configurations + 1 };
      }
      const renameSession = db.prepare('UPDATE sessions SET id=? WHERE id=?');
      const existsSession = db.prepare('SELECT 1 AS present FROM sessions WHERE id=?');
      for (const row of scope.sessions) {
        const id = rewriteIdentifiers(row.id);
        if (id === row.id) continue;
        if (existsSession.get(id) !== undefined) throw new Error(`Session id collision for ${id}`);
        renameSession.run(id, row.id);
        counts = { ...counts, sessions: counts.sessions + 1 };
      }
      db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run('migrations', 'priestess-identifiers-20261115', JSON.stringify({ completedAt: new Date().toISOString(), counts, backup }));
      db.exec('COMMIT');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }

  if (options.env !== undefined) {
    if (!(await exists(options.env))) throw new Error(`Environment file not found: ${options.env}`);
    const original = await readFile(options.env, 'utf8');
    const { text, renamed } = rewriteEnv(original);
    if (renamed) {
      await mkdir(dirname(options.env), { recursive: true });
      const temporary = `${options.env}.tmp-${process.pid}`;
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, options.env);
    }
    counts = { ...counts, envKeys: renamed };
  }

  if (options.files !== undefined) {
    const moves: [string, string][] = [
      [join(options.files, 'imported', 'astrbotx'), join(options.files, 'imported', 'legacy')],
      [join(options.files, 'astrbotx-migration-report.json'), join(options.files, 'migration-report.json')],
    ];
    for (const [from, to] of moves) {
      if (!(await exists(from))) continue;
      if (await exists(to)) throw new Error(`File target already exists: ${basename(to)}`);
      await rename(from, to);
      counts = { ...counts, fileMoves: [...counts.fileMoves, `${basename(from)} -> ${basename(to)}`] };
    }
  }

  return { database: options.database, applied: true, backupMode: mode, backup, counts, samples: [] };
}

/** Undo a `rows` migration from its exported snapshot. `full` backups restore with a file copy. */
export async function restoreIdentifiers(options: { readonly database: string; readonly backup: string }): Promise<{ readonly restored: number }> {
  const snapshot = RowBackupSchema.parse(JSON.parse(await readFile(options.backup, 'utf8')));
  const db = new DatabaseSync(options.database);
  let restored = 0;
  try {
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value');
      const remove = db.prepare('DELETE FROM documents WHERE namespace=? AND id=?');
      for (const row of snapshot.documents) {
        const key = rewriteKey(row.namespace, row.id);
        if (key.namespace !== row.namespace || key.id !== row.id) remove.run(key.namespace, key.id);
        insert.run(row.namespace, row.id, row.value);
        restored++;
      }
      const updateConfig = db.prepare('UPDATE configuration SET value=? WHERE revision=?');
      for (const row of snapshot.configurations) updateConfig.run(row.value, row.revision);
      const renameSession = db.prepare('UPDATE sessions SET id=? WHERE id=?');
      for (const row of snapshot.sessions) renameSession.run(row.id, rewriteIdentifiers(row.id));
      remove.run('migrations', 'priestess-identifiers-20261115');
      db.exec('COMMIT');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return { restored };
}

const Args = z.object({ database: z.string(), env: z.string().optional(), files: z.string().optional(), backup: z.enum(['full', 'rows']).optional(), restore: z.string().optional(), apply: z.boolean().default(false) }).strict();

function parseArgs(argv: readonly string[]): z.infer<typeof Args> {
  const supplied: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') { supplied.apply = true; continue; }
    if (!arg?.startsWith('--') || !argv[index + 1]) throw new Error('Expected --database and optional --env/--files/--backup/--restore/--apply');
    supplied[arg.slice(2)] = argv[++index] ?? '';
  }
  return Args.parse(supplied);
}

if (process.argv[1] !== undefined && (() => {
  // `current` is a symlink on the NAS: compare resolved paths, never the raw argv.
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.restore !== undefined) console.log(JSON.stringify(await restoreIdentifiers({ database: args.database, backup: args.restore }), null, 2));
    else console.log(JSON.stringify(await migrateIdentifiers({ database: args.database, ...(args.env === undefined ? {} : { env: args.env }), ...(args.files === undefined ? {} : { files: args.files }), ...(args.backup === undefined ? {} : { backup: args.backup }), apply: args.apply }), null, 2));
  } catch (error) { console.error(error instanceof z.ZodError ? `Argument validation failed at ${error.issues.map(issue => issue.path.join('.')).join(', ')}` : error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; }
}
