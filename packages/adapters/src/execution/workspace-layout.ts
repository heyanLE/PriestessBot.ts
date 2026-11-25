import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunContext } from '../../../contracts/src/index.js';

/**
 * Workspace v2 layout:
 *
 *   global/{skill,mcp,cache,file}
 *   agents/<agentId>/{skill,mcp,cache,file}
 *   conversations/<platform>/<sessionType>/<sessionId>/{skill,cache,file}
 *
 * Conversation identity deliberately excludes Agent and generation: all Agents
 * participating in the same IM session share the conversation zone.
 */
export const WORKSPACE_ZONES = ['global', 'agent', 'conversation'] as const;
export const WORKSPACE_AREAS = ['skill', 'mcp', 'cache', 'file'] as const;
export type WorkspaceZone = (typeof WORKSPACE_ZONES)[number];
export type WorkspaceArea = (typeof WORKSPACE_AREAS)[number];

export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export type WorkspaceLayoutErrorCode = 'invalid_zone' | 'invalid_area' | 'invalid_path' | 'unsupported' | 'forbidden';
export class WorkspaceLayoutError extends Error {
  constructor(readonly code: WorkspaceLayoutErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceLayoutError';
  }
}

export interface WorkspaceLocation {
  readonly zone: WorkspaceZone;
  readonly area: WorkspaceArea;
  /** Path relative to the workspace root, using forward slashes. */
  readonly relativePath: string;
  /** Virtual path exposed to sandboxed tools and prompts. */
  readonly virtualPath: string;
  readonly segments: readonly string[];
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Keep readable IDs when safe; hash unsafe IDs so paths cannot escape or become ambiguous. */
export function workspaceSegment(value: string, label: string): string {
  if (!value) throw new WorkspaceLayoutError('invalid_path', `${label} is empty.`);
  // Hashing neutralises path separators, traversal tokens and unusual IM IDs.
  // Labels are not interpreted as filesystem paths here.
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0') || !SAFE_SEGMENT.test(value)) {
    return `h-${createHash('sha256').update(value).digest('hex').slice(0, 40)}`;
  }
  return value;
}

export function assertWorkspaceZone(value: string): asserts value is WorkspaceZone {
  if (!WORKSPACE_ZONES.some(zone => zone === value)) throw new WorkspaceLayoutError('invalid_zone', `Unknown workspace zone: ${value}`);
}

export function assertWorkspaceArea(value: string): asserts value is WorkspaceArea {
  if (!WORKSPACE_AREAS.some(area => area === value)) throw new WorkspaceLayoutError('invalid_area', `Unknown workspace area: ${value}`);
}

export function isWorkspaceArea(value: string): value is WorkspaceArea {
  return WORKSPACE_AREAS.some(area => area === value);
}

export function supportsWorkspaceArea(zone: WorkspaceZone, area: WorkspaceArea): boolean {
  return !(zone === 'conversation' && area === 'mcp');
}

export function workspaceZoneSegments(context: RunContext, zone: WorkspaceZone): string[] {
  switch (zone) {
    case 'global':
      return ['global'];
    case 'agent':
      return ['agents', workspaceSegment(context.agentId, 'Agent ID')];
    case 'conversation': {
      const sessionType = context.principal.sessionType ?? 'private';
      if (sessionType !== 'private' && sessionType !== 'group') throw new WorkspaceLayoutError('invalid_path', 'Unsupported session type.');
      return [
        'conversations',
        workspaceSegment(context.principal.platform, 'IM platform'),
        sessionType,
        workspaceSegment(context.principal.sessionId, 'IM session ID'),
      ];
    }
    default:
      throw new WorkspaceLayoutError('invalid_zone', `Unknown workspace zone: ${String(zone)}`);
  }
}

function normaliseRelative(relative: string): string[] {
  if (relative === '') return [];
  if (relative.includes('\0') || relative.includes('\\') || relative.startsWith('/')) {
    throw new WorkspaceLayoutError('invalid_path', 'Use a workspace-relative POSIX path. Absolute paths and backslashes are unavailable.');
  }
  const parts = relative.split('/');
  if (parts.some(part => part === '..' || part === '.' || part === '')) {
    throw new WorkspaceLayoutError('invalid_path', 'Use a workspace-relative path without ., .. or empty segments.');
  }
  return parts;
}

export function workspaceLocation(context: RunContext, zone: WorkspaceZone, area: WorkspaceArea, relative = ''): WorkspaceLocation {
  assertWorkspaceZone(zone);
  assertWorkspaceArea(area);
  if (!supportsWorkspaceArea(zone, area)) throw new WorkspaceLayoutError('unsupported', 'The conversation zone does not support MCP.');
  const segments = [...workspaceZoneSegments(context, zone), area, ...normaliseRelative(relative)];
  return {
    zone,
    area,
    relativePath: segments.join('/'),
    virtualPath: `/workspace/${segments.join('/')}`,
    segments,
  };
}

export function workspaceAreaPath(context: RunContext, zone: WorkspaceZone, area: WorkspaceArea): string {
  return workspaceLocation(context, zone, area).relativePath;
}

/** Non-elite operators may write only agent/conversation cache. Global cache remains elite-only. */
export function canWriteWorkspace(context: RunContext, zone: WorkspaceZone, area: WorkspaceArea): boolean {
  if (!context.effectiveCapabilities.includes('files.write')) return false;
  if (!supportsWorkspaceArea(zone, area)) return false;
  if (area === 'cache') return zone !== 'global' || context.runtimeState === 'elite_operator';
  if (context.runtimeState !== 'elite_operator') return false;
  if (area === 'skill' || area === 'mcp') return context.effectiveCapabilities.includes('resources.manage');
  return true;
}

export function assertWorkspaceWrite(context: RunContext, zone: WorkspaceZone, area: WorkspaceArea): void {
  if (!canWriteWorkspace(context, zone, area)) {
    throw new WorkspaceLayoutError('forbidden', area === 'cache'
      ? 'Writing this cache area requires files.write; global cache requires elite_operator.'
      : 'Only elite_operator with files.write can change skill, mcp or file areas.');
  }
}

export function isCacheLocation(location: WorkspaceLocation): boolean {
  return location.area === 'cache';
}


/** Parse a v2 tool path. Only canonical /workspace paths are accepted. */
export function workspaceToolPath(context: RunContext, name: string): WorkspaceLocation {
  if (!name.startsWith('/workspace/')) throw new WorkspaceLayoutError('invalid_path', 'Use a /workspace/... path for workspace v2.');
  const parts = name.slice('/workspace/'.length).split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new WorkspaceLayoutError('invalid_path', 'Use a canonical workspace path without empty, . or .. segments.');
  let zone: WorkspaceZone; let area: string; let relative: string[];
  if (parts[0] === 'global') {
    zone = 'global'; area = parts[1] ?? ''; relative = parts.slice(2);
  } else if (parts[0] === 'agents') {
    zone = 'agent';
    const expected = workspaceSegment(context.agentId, 'Agent ID');
    if (parts[1] !== expected) throw new WorkspaceLayoutError('forbidden', 'The Agent workspace path does not belong to the current Agent.');
    area = parts[2] ?? ''; relative = parts.slice(3);
  } else if (parts[0] === 'conversations') {
    zone = 'conversation';
    const expected = workspaceZoneSegments(context, 'conversation');
    if (parts[1] !== expected[1] || parts[2] !== expected[2] || parts[3] !== expected[3]) throw new WorkspaceLayoutError('forbidden', 'The conversation workspace path does not belong to the current IM session.');
    area = parts[4] ?? ''; relative = parts.slice(5);
  } else {
    throw new WorkspaceLayoutError('invalid_zone', 'Workspace paths start with global, agents or conversations.');
  }
  assertWorkspaceArea(area);
  const location = workspaceLocation(context, zone, area, relative.join('/'));
  if (location.virtualPath !== name) throw new WorkspaceLayoutError('invalid_path', 'Use the canonical workspace path.');
  return location;
}

export function workspaceHostPath(rootPath: string, location: WorkspaceLocation): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...location.segments);
  if (target !== root && !target.startsWith(root + path.sep)) throw new WorkspaceLayoutError('invalid_path', 'Workspace path leaves the workspace root.');
  return target;
}

/** Validate every existing component and refuse symlinks, hard links and special files. */
export async function workspaceEntryV2(rootPath: string, location: WorkspaceLocation, create = false): Promise<string> {
  await mkdir(rootPath, { recursive: true, mode: 0o700 });
  const root = await realpath(rootPath);
  const target = workspaceHostPath(root, location);
  if (create) await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let cursor = root;
  for (const segment of location.segments) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1 || !info.isFile() && !info.isDirectory()) {
        throw new WorkspaceLayoutError('invalid_path', 'Symlink, hard link or special file is unavailable. Use a regular file inside the selected workspace area.');
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      break;
    }
  }
  return target;
}
