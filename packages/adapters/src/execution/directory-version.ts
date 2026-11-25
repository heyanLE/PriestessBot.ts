import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

function attributes(info: BigIntStats): string {
  return [info.dev, info.ino, info.mode, info.uid, info.gid, info.nlink, info.size, info.mtimeNs, info.ctimeNs].join(':');
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Fingerprint direct entries and one named child per directory without reading file contents. */
export async function directoryVersion(directory: string, childFile: string): Promise<string | undefined> {
  if (!childFile || childFile === '.' || childFile === '..' || childFile.includes('/') || childFile.includes('\\') || childFile.includes('\0')) throw new Error('Expected a child filename');
  let root: BigIntStats;
  try { root = await lstat(directory, { bigint: true }); }
  catch (error) { return missing(error) ? 'missing-directory' : undefined; }
  try {
    if (!root.isDirectory() || root.isSymbolicLink()) return undefined;
    const entries = await readdir(directory);
    // Discovery itself is bounded. Large directories use the existing uncached path.
    if (entries.length > 500) return undefined;
    const parts = [attributes(root)];
    for (const name of entries.sort()) {
      const target = path.join(directory, name);
      const entry = await lstat(target, { bigint: true });
      if (entry.isSymbolicLink()) return undefined;
      parts.push(name, attributes(entry));
      if (!entry.isDirectory()) continue;
      try {
        const child = await lstat(path.join(target, childFile), { bigint: true });
        if (child.isSymbolicLink() || child.isFile() && child.nlink !== 1n) return undefined;
        parts.push(attributes(child));
      } catch (error) {
        if (!missing(error)) return undefined;
        parts.push('missing-child');
      }
    }
    const after = await lstat(directory, { bigint: true });
    if (attributes(after) !== attributes(root)) return undefined;
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  } catch {
    // Concurrent changes and unreadable entries use the original uncached path.
    return undefined;
  }
}
