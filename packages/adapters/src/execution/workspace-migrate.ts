import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceMigrationResult { movedFiles: number; movedDirectories: number; }

async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

async function moveEntry(source: string, target: string, result: WorkspaceMigrationResult): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Workspace migration refuses symlink: ${source}`);
  if (!await exists(target)) {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    if (info.isDirectory()) result.movedDirectories++; else result.movedFiles++;
    return;
  }
  const destination = await lstat(target);
  if (info.isDirectory() && destination.isDirectory()) {
    for (const name of await readdir(source)) await moveEntry(path.join(source, name), path.join(target, name), result);
    await rmdir(source);
    result.movedDirectories++;
    return;
  }
  throw new Error(`Workspace migration conflict: ${target} already exists.`);
}

/** Move legacy shared files into the global zone: skills to global/skill, other files to global/file. */
export async function migrateSharedToGlobal(root: string): Promise<WorkspaceMigrationResult> {
  const result: WorkspaceMigrationResult = { movedFiles: 0, movedDirectories: 0 };
  const shared = path.join(root, 'shared');
  if (!await exists(shared)) return result;
  const global = path.join(root, 'global');
  await Promise.all(['skill', 'mcp', 'cache', 'file'].map(area => mkdir(path.join(global, area), { recursive: true, mode: 0o700 })));
  for (const name of await readdir(shared)) {
    if (name === '.agent') {
      const skills = path.join(shared, '.agent', 'skill');
      if (await exists(skills)) for (const skill of await readdir(skills)) await moveEntry(path.join(skills, skill), path.join(global, 'skill', skill), result);
      continue;
    }
    await moveEntry(path.join(shared, name), path.join(global, 'file', name), result);
  }
  // Remove empty legacy containers only.
  for (const directory of [path.join(shared, '.agent', 'skill'), path.join(shared, '.agent'), shared]) {
    try { await rmdir(directory); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') { /* Keep non-empty directories. */ } }
  }
  return result;
}
