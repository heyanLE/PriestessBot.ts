import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const IdentitySchema = z.tuple([z.string().min(1), z.enum(['private', 'group']), z.string().min(1), z.string().min(1)]);
const RunSchema = z.object({ id: z.string(), sessionKey: z.string(), senderId: z.string(), agentId: z.string(), generation: z.number().int().nonnegative(), parentRunId: z.string().nullable(), status: z.string() });
type Run = z.infer<typeof RunSchema>;
interface Owner { platform: string; sessionType: 'private' | 'group'; sessionId: string; senderId: string; agentId: string; generationAgentId: string; generation: number; }
interface FileEntry { path: string; bytes: number; directory: boolean; }
type Disposition = 'copy_private' | 'copied' | 'retained_group' | 'retained_conflict' | 'retained_destination' | 'retained_unsafe' | 'copy_failed';
interface MigrationEntry { source: string; destination: string; owner: Owner; disposition: Disposition; files: FileEntry[]; alternativeOwners?: Owner[]; }
export interface WorkspaceMigrationOptions { database: string; root: string; apply?: boolean; runtimeStopped?: boolean; dryRun?: boolean; }
export interface WorkspaceMigrationReport {
  applied: boolean; activeRuns: number; sources: number; privateCopiesPlanned: number; privateCopiesCompleted: number;
  retainedGroup: number; retainedConflicts: number; retainedExisting: number; retainedUnsafe: number; unmappedDirectories: number;
  failedCopies: number; manifestPath?: string;
}
function hash(value: readonly (string | number)[]): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; } }
function owned(info: Stats): boolean { const uid = process.getuid?.(); return (uid === undefined || info.uid === uid) && (info.mode & 0o022) === 0; }
async function directory(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isDirectory() || info.isSymbolicLink() || !owned(info)) throw new Error('Workspace directory must be an owned directory without links or writes by other accounts.');
}
function resolveOwner(run: Run, runs: ReadonlyMap<string, Run>): Owner | undefined {
  let root = run; const seen = new Set<string>();
  while (root.parentRunId !== null) {
    if (seen.has(root.id)) return undefined;
    seen.add(root.id); const parent = runs.get(root.parentRunId); if (!parent) return undefined; root = parent;
  }
  let raw: unknown; try { raw = JSON.parse(root.sessionKey); } catch { return undefined; }
  const identity = IdentitySchema.safeParse(raw);
  if (!identity.success || !run.agentId || !run.senderId || run.generation !== root.generation) return undefined;
  const [platform, sessionType, sessionId, generationAgentId] = identity.data;
  if (generationAgentId !== root.agentId || run.senderId !== root.senderId) return undefined;
  return { platform, sessionType, sessionId, senderId: run.senderId, agentId: run.agentId, generationAgentId, generation: run.generation };
}
async function inventory(root: string): Promise<FileEntry[]> {
  await directory(root); const result: FileEntry[] = [];
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (depth > 64) throw new Error('Workspace exceeds the migration depth limit.');
    const current = path.join(root, relative); await directory(current);
    for (const name of (await readdir(current)).sort()) {
      if (result.length >= 50_000) throw new Error('Workspace exceeds the migration entry limit.');
      const child = relative ? `${relative}/${name}` : name; const info = await lstat(path.join(root, child));
      if (info.isSymbolicLink() || !owned(info) || !(info.isDirectory() || info.isFile()) || (info.isFile() && info.nlink !== 1)) throw new Error('Workspace contains a link, special file or unsafe ownership.');
      result.push({ path: child, bytes: info.isFile() ? info.size : 0, directory: info.isDirectory() });
      if (info.isDirectory()) await visit(child, depth + 1);
    }
  };
  await visit('', 0); return result;
}
async function copyRegular(source: string, destination: string, bytes: number): Promise<void> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let output: FileHandle | undefined;
  try {
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 || !owned(before) || before.size !== bytes) throw new Error('Migration source changed.');
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600 | (before.mode & 0o100));
    const buffer = Buffer.alloc(64 * 1024); let position = 0;
    while (position < bytes) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, bytes - position), position);
      if (!bytesRead) throw new Error('Migration source became shorter.');
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        if (!result.bytesWritten) throw new Error('Migration destination write failed.');
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    const after = await input.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1) throw new Error('Migration source changed while copying.');
    await output.sync();
  } finally { await output?.close(); await input.close(); }
}
async function copyWorkspace(root: string, entry: MigrationEntry): Promise<void> {
  const source = path.join(root, entry.source); const destination = path.join(root, entry.destination);
  // Exclusive root creation prevents overwriting even an empty existing workspace.
  // On failure, leave any partial copy in place for administrator review. Never delete originals.
  const current = await inventory(source);
  if (JSON.stringify(current) !== JSON.stringify(entry.files)) throw new Error('Workspace changed after planning.');
  await mkdir(destination, { mode: 0o700 });
  for (const item of entry.files) {
    await directory(source); await directory(destination);
    const pieces = item.path.split('/'); pieces.pop();
    let sourceParent = source; let destinationParent = destination;
    for (const piece of pieces) { sourceParent = path.join(sourceParent, piece); destinationParent = path.join(destinationParent, piece); await directory(sourceParent); await directory(destinationParent); }
    if (item.directory) { await directory(path.join(source, item.path)); await mkdir(path.join(destination, item.path), { mode: 0o700 }); }
    else await copyRegular(path.join(source, item.path), path.join(destination, item.path), item.bytes);
  }
}

/** Offline file migration. SQLite is always read-only, including --apply. */
export async function migrateWorkspaceZones(options: WorkspaceMigrationOptions): Promise<WorkspaceMigrationReport> {
  if (options.apply && options.dryRun) throw new Error('Choose either --apply or --dry-run.');
  if (options.apply && !options.runtimeStopped) throw new Error('--apply requires --runtime-stopped.');
  const database = path.resolve(options.database); const databaseInfo = await lstat(database);
  if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) throw new Error('Database must be an existing regular file.');
  const requestedRoot = path.resolve(options.root); await directory(requestedRoot); const root = await realpath(requestedRoot);
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare("SELECT id,json_extract(value,'$.sessionKey') sessionKey,json_extract(value,'$.senderId') senderId,json_extract(value,'$.agentId') agentId,json_extract(value,'$.generation') generation,json_extract(value,'$.parentRunId') parentRunId,json_extract(value,'$.status') status FROM documents WHERE namespace='runs'").all().map(row => RunSchema.parse(row));
    const activeRuns = rows.filter(run => ['queued', 'running', 'paused'].includes(run.status)).length;
    if (options.apply && activeRuns > 0) throw new Error('Active or paused tasks exist. Stop or cancel them before migration.');
    const initialVersion = z.object({ data_version: z.number() }).parse(db.prepare('PRAGMA data_version').get()).data_version;
    const allRuns = new Map(rows.map(run => [run.id, run])); const entries = new Map<string, MigrationEntry>();
    for (const run of rows) {
      const owner = resolveOwner(run, allRuns); if (!owner) continue;
      const source = hash([owner.platform, owner.sessionType, owner.sessionId, owner.senderId, owner.agentId, owner.generation]);
      const destination = hash([owner.platform, owner.sessionType, owner.sessionId, owner.generationAgentId, owner.generation]);
      const existing = entries.get(source);
      if (existing) {
        if (existing.destination !== destination) { existing.disposition = 'retained_conflict'; existing.alternativeOwners = [...(existing.alternativeOwners ?? []), owner]; }
        continue;
      }
      if (!await exists(path.join(root, source))) continue;
      const entry: MigrationEntry = { source, destination, owner, disposition: owner.sessionType === 'group' ? 'retained_group' : 'copy_private', files: [] };
      try { entry.files = await inventory(path.join(root, source)); } catch { entry.disposition = 'retained_unsafe'; }
      entries.set(source, entry);
    }
    const destinations = new Map<string, number>();
    for (const entry of entries.values()) destinations.set(entry.destination, (destinations.get(entry.destination) ?? 0) + 1);
    for (const entry of entries.values()) {
      if (entry.disposition !== 'copy_private') continue;
      if ((destinations.get(entry.destination) ?? 0) > 1) entry.disposition = 'retained_conflict';
      else if (await exists(path.join(root, entry.destination))) entry.disposition = 'retained_destination';
    }
    const known = new Set([...entries.keys(), ...[...entries.values()].map(entry => entry.destination)]);
    const unmapped = (await readdir(root)).filter(name => /^[0-9a-f]{64}$/u.test(name) && !known.has(name));
    const all = [...entries.values()];
    const report: WorkspaceMigrationReport = {
      applied: false, activeRuns, sources: all.length, privateCopiesPlanned: all.filter(entry => entry.disposition === 'copy_private').length, privateCopiesCompleted: 0,
      retainedGroup: all.filter(entry => entry.disposition === 'retained_group').length, retainedConflicts: all.filter(entry => entry.disposition === 'retained_conflict').length,
      retainedExisting: all.filter(entry => entry.disposition === 'retained_destination').length, retainedUnsafe: all.filter(entry => entry.disposition === 'retained_unsafe').length, unmappedDirectories: unmapped.length, failedCopies: 0,
    };
    if (!options.apply) return report;
    const manifests = path.join(root, '.workspace-zone-migrations');
    try { await mkdir(manifests, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
    await directory(manifests);
    const operation = `${Date.now()}-${randomUUID()}`;
    const writeManifest = async (stage: 'plan' | 'result'): Promise<string> => {
      const file = path.join(manifests, `${operation}-${stage}.json`); const handle = await open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ format: 'priestess-workspace-zones-v1', stage, createdAt: Date.now(), entries: all, unmapped, report }, null, 2) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      return file;
    };
    await writeManifest('plan');
    for (const entry of all) {
      if (entry.disposition !== 'copy_private') continue;
      try {
        if (z.object({ data_version: z.number() }).parse(db.prepare('PRAGMA data_version').get()).data_version !== initialVersion) throw new Error('Database changed.');
        await copyWorkspace(root, entry); entry.disposition = 'copied'; report.privateCopiesCompleted++;
      } catch { entry.disposition = 'copy_failed'; report.failedCopies++; }
    }
    report.applied = true;
    report.manifestPath = await writeManifest('result');
    return report;
  } finally { db.close(); }
}

async function main(): Promise<void> {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, root: { type: 'string' }, apply: { type: 'boolean', default: false }, 'runtime-stopped': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false } } });
    if (!values.database || !values.root) throw new Error('Use --database <runtime.sqlite> --root <execution-root> [--dry-run | --apply --runtime-stopped].');
    const report = await migrateWorkspaceZones({ database: values.database, root: values.root, apply: values.apply, runtimeStopped: values['runtime-stopped'], dryRun: values['dry-run'] });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (report.failedCopies > 0) process.exitCode = 1;
  } catch { process.stderr.write('Workspace migration failed. Check the database, owned workspace root, stopped runtime and migration manifest. Original files are never removed.\n'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
