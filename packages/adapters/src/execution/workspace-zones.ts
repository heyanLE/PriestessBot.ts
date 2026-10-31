import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunContext } from '../../../contracts/src/index.js';

export const ISOLATED_WORKSPACE = '/workspace/files';
export const SHARED_WORKSPACE = '/workspace/shared';
export type WorkspaceZone = 'isolated' | 'shared';
export type WorkspacePathErrorCode = 'invalid_path' | 'forbidden' | 'not_found' | 'size_limit' | 'patch_mismatch' | 'file_unavailable';
export class WorkspacePathError extends Error {
  constructor(readonly code: WorkspacePathErrorCode, message: string) { super(message); this.name = 'WorkspacePathError'; }
}
export interface WorkspacePath { readonly zone: WorkspaceZone; readonly relative: string; readonly absolute: string; }

/** Relative paths always select the isolated zone. Absolute paths are container aliases, never host paths. */
export function workspacePath(name: string): WorkspacePath {
  if (name.length > 4096 || name.includes('\0') || name.includes('\\') || name.split('/').includes('..')) {
    throw new WorkspacePathError('invalid_path', 'Path leaves workspace or uses unsupported characters. Use a workspace-relative path, /workspace/files/path, or /workspace/shared/path. Do not use .. or backslashes.');
  }
  let zone: WorkspaceZone = 'isolated'; let relative = name;
  if (path.posix.isAbsolute(name)) {
    if (name === SHARED_WORKSPACE || name.startsWith(`${SHARED_WORKSPACE}/`)) { zone = 'shared'; relative = name.slice(SHARED_WORKSPACE.length); }
    else if (name === ISOLATED_WORKSPACE || name.startsWith(`${ISOLATED_WORKSPACE}/`)) relative = name.slice(ISOLATED_WORKSPACE.length);
    else throw new WorkspacePathError('invalid_path', 'Use a workspace-relative path, /workspace/files/path, or /workspace/shared/path. Other absolute paths are unavailable.');
  }
  relative = relative.split('/').filter(segment => segment && segment !== '.').join('/');
  const root = zone === 'shared' ? SHARED_WORKSPACE : ISOLATED_WORKSPACE;
  return { zone, relative, absolute: relative ? `${root}/${relative}` : root };
}

export function assertWorkspaceWrite(context: RunContext, target: WorkspacePath): void {
  if (target.zone === 'shared' && context.runtimeState !== 'elite_operator') {
    throw new WorkspacePathError('forbidden', 'The shared zone is read-only for this state. Only elite_operator can change it. Write to the isolated zone with a relative path.');
  }
}

/** A conversation includes its Agent and reset generation. Group senders use the same files. */
export function workspaceIdentity(context: RunContext): string {
  return JSON.stringify([context.principal.platform, context.principal.sessionType ?? 'private', context.principal.sessionId, context.generationAgentId ?? context.agentId, context.generation]);
}

export async function workspaceDirectory(rootPath: string, context: RunContext, zone: WorkspaceZone): Promise<string> {
  await mkdir(rootPath, { recursive: true, mode: 0o700 });
  const root = await realpath(rootPath);
  const name = zone === 'shared' ? 'shared' : createHash('sha256').update(workspaceIdentity(context)).digest('hex');
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new WorkspacePathError('invalid_path', 'Workspace directory is unavailable. It must be a directory, not a symlink.');
  return directory;
}

/** Check the bind source as well as the container path. Link aliases cannot change a skill or zone reference. */
export async function workspaceEntry(rootPath: string, context: RunContext, target: WorkspacePath): Promise<string> {
  const root = await workspaceDirectory(rootPath, context, target.zone);
  let cursor = root;
  for (const segment of target.relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1 || !info.isFile() && !info.isDirectory()) throw new WorkspacePathError('invalid_path', 'Symlink, hard link or special file is unavailable. Use a regular file inside the selected workspace zone.');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      break;
    }
  }
  return path.join(root, target.relative);
}

/** Do not return SDK or host exception text: it can contain host paths and subprocess details. */
export function workspaceFailure(error: unknown): WorkspacePathError {
  if (error instanceof WorkspacePathError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : '';
  if (code === 'ENOENT' || message === 'ENOENT' || /path does not exist|file not found|directory not found/iu.test(message)) return new WorkspacePathError('not_found', 'File or directory not found. List its parent directory. Use a path from that result.');
  if (/read limit|byte read limit|size limit|write limit/iu.test(message)) return new WorkspacePathError('size_limit', 'File exceeds the size limit. Text reads and writes allow 1000000 bytes. Attachments allow 20000000 bytes.');
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || /read-only mount|read-only file system/iu.test(message)) return new WorkspacePathError('forbidden', 'File access is denied. Check the zone and current permissions. The shared zone allows writes only for elite_operator.');
  return new WorkspacePathError('file_unavailable', 'File operation failed. List the parent directory and check the file type. Do not report success.');
}
