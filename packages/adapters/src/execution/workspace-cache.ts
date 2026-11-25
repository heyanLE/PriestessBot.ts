import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface CacheCleanupResult {
  removedFiles: number;
  removedDirectories: number;
  removedBytes: number;
  scannedDirectories: number;
}

const CACHE = 'cache';

async function cacheDirectories(root: string): Promise<string[]> {
  const result = [path.join(root, 'global', CACHE)];
  const addChildren = async (parent: string, depth: number): Promise<void> => {
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const directory = path.join(parent, entry.name);
      if (depth === 1) result.push(path.join(directory, CACHE));
      else await addChildren(directory, depth - 1);
    }
  };
  await addChildren(path.join(root, 'agents'), 1);
  // conversations/<platform>/<sessionType>/<sessionId>/cache
  await addChildren(path.join(root, 'conversations'), 3);
  return result;
}

async function cleanDirectory(directory: string, cutoff: number, result: CacheCleanupResult): Promise<boolean> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
  result.scannedDirectories++;
  let empty = true;
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { empty = false; continue; }
    if (entry.isDirectory()) {
      const childEmpty = await cleanDirectory(target, cutoff, result);
      if (!childEmpty) empty = false;
      else { try { await rmdir(target); result.removedDirectories++; } catch { empty = false; } }
      continue;
    }
    if (!entry.isFile()) { empty = false; continue; }
    const info = await lstat(target);
    if (info.isSymbolicLink() || info.nlink !== 1) { empty = false; continue; }
    if (info.mtimeMs < cutoff) {
      await unlink(target);
      result.removedFiles++;
      result.removedBytes += info.size;
    } else empty = false;
  }
  return empty;
}

/** Delete cache entries older than ttl. Never follows links and never removes the cache root itself. */
export async function cleanupWorkspaceCaches(root: string, options: { ttlMs: number; now?: number } = { ttlMs: 7 * 24 * 60 * 60 * 1000 }): Promise<CacheCleanupResult> {
  const result: CacheCleanupResult = { removedFiles: 0, removedDirectories: 0, removedBytes: 0, scannedDirectories: 0 };
  const cutoff = (options.now ?? Date.now()) - options.ttlMs;
  for (const directory of await cacheDirectories(root)) await cleanDirectory(directory, cutoff, result);
  return result;
}
