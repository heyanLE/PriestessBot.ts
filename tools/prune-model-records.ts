import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/**
 * Retention for raw model payloads.
 *
 * Each model call writes `<id>.body` under `model-records/` and one
 * `model-payload-documents` row holding its metadata. Dropping only the file
 * leaves a record the Dashboard cannot open, so file and row are removed
 * together. Dry run by default; `--apply` is required to delete anything.
 */

const NAMESPACE = 'model-payload-documents';
const DAY_MS = 86_400_000;

export interface PruneOptions {
  readonly database: string;
  readonly records: string;
  readonly keepDays: number;
  readonly apply?: boolean;
}

export interface PruneReport {
  readonly records: string;
  readonly keepDays: number;
  readonly applied: boolean;
  readonly cutoff: string;
  readonly files: number;
  readonly bytes: number;
  readonly rows: number;
  readonly kept: number;
  readonly keptBytes: number;
  readonly orphans: number;
  readonly failed: number;
  readonly samples: readonly string[];
}

/** Ids whose file is missing but whose row survives, e.g. after a manual delete. */
export function orphanIds(db: DatabaseSync, present: ReadonlySet<string>): string[] {
  const rows = z.array(z.object({ id: z.string() })).parse(db.prepare(`SELECT id FROM documents WHERE namespace='${NAMESPACE}'`).all());
  return rows.map(row => row.id).filter(id => !present.has(id));
}

export async function pruneModelRecords(options: PruneOptions): Promise<PruneReport> {
  if (!Number.isFinite(options.keepDays) || options.keepDays < 0) throw new Error('keep-days must be a non-negative number');
  const cutoffMs = Date.now() - options.keepDays * DAY_MS;
  const names = (await readdir(options.records)).filter(name => name.endsWith('.body'));
  const stale: { id: string; name: string; bytes: number; mtimeMs: number }[] = [];
  let kept = 0;
  let keptBytes = 0;
  for (const name of names) {
    const info = await stat(join(options.records, name));
    if (!info.isFile()) continue;
    if (info.mtimeMs < cutoffMs) stale.push({ id: name.slice(0, -'.body'.length), name, bytes: info.size, mtimeMs: info.mtimeMs });
    else { kept++; keptBytes += info.size; }
  }
  const present = new Set(names.map(name => name.slice(0, -'.body'.length)));
  const db = new DatabaseSync(options.database, { readOnly: true });
  const { rows, orphans } = (() => {
    try {
      const known = new Set(z.array(z.object({ id: z.string() })).parse(db.prepare(`SELECT id FROM documents WHERE namespace='${NAMESPACE}'`).all()).map(row => row.id));
      return { rows: stale.filter(item => known.has(item.id)).length, orphans: [...known].filter(id => !present.has(id)).length };
    } finally { db.close(); }
  })();

  const report: PruneReport = {
    records: options.records, keepDays: options.keepDays, applied: options.apply === true, cutoff: new Date(cutoffMs).toISOString(),
    files: stale.length, bytes: stale.reduce((sum, item) => sum + item.bytes, 0), rows, kept, keptBytes, orphans, failed: 0,
    samples: stale.slice(0, 5).map(item => `${item.name} (${new Date(item.mtimeMs).toISOString().slice(0, 10)}, ${(item.bytes / 1024).toFixed(0)} KB)`),
  };
  if (options.apply !== true) return report;

  // Files first, then one transaction for the rows. A rollback after the files
  // are gone would resurrect rows that point at missing bodies, so the rows are
  // only ever removed last, and a failed unlink keeps both file and row.
  let failed = 0;
  const removed: string[] = [];
  for (const item of stale) {
    try { await unlink(join(options.records, item.name)); removed.push(item.id); }
    catch { failed++; }
  }
  const writable = new DatabaseSync(options.database);
  let deletedRows = 0;
  try {
    writable.exec('PRAGMA journal_mode=WAL');
    writable.exec('BEGIN IMMEDIATE');
    try {
      const remove = writable.prepare(`DELETE FROM documents WHERE namespace='${NAMESPACE}' AND id=?`);
      for (const id of removed) deletedRows += Number(remove.run(id).changes);
      writable.exec('COMMIT');
      writable.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) { writable.exec('ROLLBACK'); throw error; }
  } finally { writable.close(); }
  return { ...report, rows: deletedRows, files: removed.length, failed };
}

const Args = z.object({ database: z.string(), records: z.string(), 'keep-days': z.coerce.number(), apply: z.boolean().default(false) }).strict();

function parseArgs(argv: readonly string[]): PruneOptions {
  const supplied: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') { supplied.apply = true; continue; }
    if (!arg?.startsWith('--') || argv[index + 1] === undefined) throw new Error('Expected --database, --records and --keep-days, plus optional --apply');
    supplied[arg.slice(2)] = argv[++index] ?? '';
  }
  const args = Args.parse(supplied);
  return { database: args.database, records: args.records, keepDays: args['keep-days'], apply: args.apply };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await pruneModelRecords(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error instanceof z.ZodError ? `Argument validation failed at ${error.issues.map(issue => issue.path.join('.')).join(', ')}` : error instanceof Error ? error.message : 'Prune failed'); process.exitCode = 1; }
}
