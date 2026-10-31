import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, mkdir, rename, unlink, rmdir, open } from 'node:fs/promises';
import type { RuntimeConfig } from '../../../packages/contracts/src/index.js';
import type { WorkspaceEntry } from '../../../packages/contracts/src/operator.js';

/** Operator-only file operations, confined to configured environment work roots. */
export class WorkspaceFiles {
  constructor(private readonly config: () => RuntimeConfig) {}
  environments(): Pick<RuntimeConfig['executionEnvironments'][number], 'id' | 'type' | 'root'>[] { return this.config().executionEnvironments.map(({ id, type, root }) => ({ id, type, root })); }
  private async root(id: string): Promise<string> { const environment = this.config().executionEnvironments.find(item => item.id === id); if (!environment) throw new Error('Environment not found'); return realpath(path.resolve(environment.root)); }
  private async target(id: string, relative: string, create = false): Promise<{ root: string; target: string }> {
    if (relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Workspace path denied');
    const root = await this.root(id); const candidate = path.resolve(root, relative || '.');
    if (candidate !== root && !candidate.startsWith(root + path.sep)) throw new Error('Workspace path denied');
    const parent = candidate === root ? root : await realpath(path.dirname(candidate));
    if (parent !== root && !parent.startsWith(root + path.sep)) throw new Error('Workspace path denied');
    const target = candidate === root ? root : path.join(parent, path.basename(candidate));
    try { const info = await lstat(target); if (info.isSymbolicLink()) throw new Error('Symlink operations are not allowed'); const canonical = await realpath(target); if (canonical !== root && !canonical.startsWith(root + path.sep)) throw new Error('Workspace path denied'); }
    catch (error) { if (!create || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    return { root, target };
  }
  async list(id: string, relative: string): Promise<{ environmentId: string; path: string; entries: WorkspaceEntry[]; truncated: boolean }> {
    const { root, target } = await this.target(id, relative); if (!(await lstat(target)).isDirectory()) throw new Error('Not a directory');
    const names = (await readdir(target)).sort(); const entries: WorkspaceEntry[] = [];
    for (const name of names.slice(0, 1000)) { const file = path.join(target, name); const info = await lstat(file); entries.push({ name, path: path.relative(root, file), kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size, modifiedAt: info.mtimeMs }); }
    return { environmentId: id, path: path.relative(root, target), entries, truncated: names.length > 1000 };
  }
  async read(id: string, relative: string, maxBytes = 10_000_000): Promise<Buffer> {
    const { target } = await this.target(id, relative); const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const info = await file.stat(); if (!info.isFile() || info.size > maxBytes) throw new Error('File exceeds download size limit or is not regular'); const bytes = await file.readFile(); if (bytes.length > maxBytes) throw new Error('File exceeds download size limit'); return bytes; } finally { await file.close(); }
  }
  async upload(id: string, relative: string, bytes: Buffer): Promise<void> {
    if (bytes.length > 10_000_000) throw new Error('Upload exceeds 10 MB');
    const { root, target } = await this.target(id, relative, true); if (target === root) throw new Error('Cannot replace workspace root');
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
  }
  async mkdir(id: string, relative: string): Promise<void> { const { root, target } = await this.target(id, relative, true); if (target === root) throw new Error('Cannot modify workspace root'); await mkdir(target, { mode: 0o700 }); }
  async move(id: string, from: string, to: string): Promise<void> {
    const source = await this.target(id, from); const destination = await this.target(id, to, true);
    if (source.target === source.root || destination.target === destination.root) throw new Error('Cannot move workspace root');
    try { await lstat(destination.target); throw new Error('Destination already exists'); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    await rename(source.target, destination.target);
  }
  async delete(id: string, relative: string): Promise<void> { const { root, target } = await this.target(id, relative); if (target === root) throw new Error('Cannot delete workspace root'); const info = await lstat(target); if (info.isDirectory()) await rmdir(target); else if (info.isFile()) await unlink(target); else throw new Error('Unsupported file type'); }
}
