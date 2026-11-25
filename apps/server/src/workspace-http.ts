import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServerConfigSchema, type RuntimeConfig } from '../../../packages/contracts/src/index.js';
import { skillMetadata } from '../../../packages/adapters/src/resources/skills.js';

type Json = (response: ServerResponse, status: number, value: unknown) => void;
interface AreaCounts { skill: number; mcp: number; cache: number; file: number; }
export interface WorkspaceSkillView { id: string; zone: 'global' | 'agent' | 'conversation'; agentId?: string; conversation?: { platform: string; sessionType: string; sessionId: string }; name: string; description: string; path: string; }
export interface WorkspaceMcpView { id: string; zone: 'global' | 'agent'; agentId?: string; transport: string; path: string; }
export interface WorkspaceZoneView { id: string; zone: 'global' | 'agent' | 'conversation'; label: string; agentId?: string; conversation?: { platform: string; sessionType: string; sessionId: string }; areas: AreaCounts; skills: WorkspaceSkillView[]; mcp: WorkspaceMcpView[]; }

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
async function directories(target: string): Promise<string[]> {
  try { return (await readdir(target, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')).map(entry => entry.name).sort(); }
  catch (error) { if (missing(error)) return []; throw error; }
}
async function files(target: string): Promise<string[]> {
  try { return (await readdir(target, { withFileTypes: true })).filter(entry => entry.isFile() && !entry.isSymbolicLink() && !entry.name.startsWith('.')).map(entry => entry.name).sort(); }
  catch (error) { if (missing(error)) return []; throw error; }
}
async function count(target: string): Promise<number> {
  try { const info = await lstat(target); if (!info.isDirectory()) return 1; return (await readdir(target)).length; }
  catch (error) { if (missing(error)) return 0; throw error; }
}
async function areas(root: string, base: string): Promise<AreaCounts> {
  return {
    skill: (await directories(path.join(base, 'skill'))).length,
    mcp: (await files(path.join(base, 'mcp'))).length,
    cache: await count(path.join(base, 'cache')),
    file: await count(path.join(base, 'file')),
  };
}
async function skills(root: string, zone: 'global' | 'agent' | 'conversation', base: string, extra: { agentId?: string; conversation?: WorkspaceSkillView['conversation'] } = {}): Promise<WorkspaceSkillView[]> {
  const result: WorkspaceSkillView[] = [];
  for (const name of await directories(path.join(base, 'skill'))) {
    const directory = path.join(base, 'skill', name);
    let description: string;
    try {
      const info = await lstat(path.join(directory, 'SKILL.md'));
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64_000) continue;
      description = skillMetadata(await readFile(path.join(directory, 'SKILL.md'), 'utf8'), name).description;
    } catch { description = '无法读取 SKILL.md'; }
    const item: WorkspaceSkillView = { id: `${zone}:${extra.agentId ?? extra.conversation?.sessionId ?? 'global'}:${name}`, zone, name, description, path: path.relative(root, directory) };
    if (extra.agentId !== undefined) item.agentId = extra.agentId;
    if (extra.conversation !== undefined) item.conversation = extra.conversation;
    result.push(item);
  }
  return result;
}
async function mcp(root: string, zone: 'global' | 'agent', base: string, agentId?: string): Promise<WorkspaceMcpView[]> {
  const result: WorkspaceMcpView[] = [];
  for (const name of await files(path.join(base, 'mcp'))) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(base, 'mcp', name);
    try {
      const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000) continue;
      const parsed = McpServerConfigSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      if (!parsed.success) continue;
      result.push({ id: parsed.data.id, zone, ...(agentId === undefined ? {} : { agentId }), transport: parsed.data.transport, path: path.relative(root, file) });
    } catch { /* invalid MCP files are skipped, not exposed to the dashboard */ }
  }
  return result;
}

async function workspaceView(config: RuntimeConfig): Promise<{ workspace: { root: string; sandbox: boolean } | null; zones: WorkspaceZoneView[] }> {
  const workspace = config.workspace;
  if (workspace === undefined) return { workspace: null, zones: [] };
  const root = workspace.root;
  const zones: WorkspaceZoneView[] = [];
  const globalBase = path.join(root, 'global');
  zones.push({ id: 'global', zone: 'global', label: '全局', areas: await areas(root, globalBase), skills: await skills(root, 'global', globalBase), mcp: await mcp(root, 'global', globalBase) });
  for (const agentId of await directories(path.join(root, 'agents'))) {
    const base = path.join(root, 'agents', agentId);
    zones.push({ id: `agent:${agentId}`, zone: 'agent', label: `Agent · ${agentId}`, agentId, areas: await areas(root, base), skills: await skills(root, 'agent', base, { agentId }), mcp: await mcp(root, 'agent', base, agentId) });
  }
  let conversations = 0;
  for (const platform of await directories(path.join(root, 'conversations'))) {
    for (const sessionType of await directories(path.join(root, 'conversations', platform))) {
      for (const sessionId of await directories(path.join(root, 'conversations', platform, sessionType))) {
        if (conversations >= 100) break;
        conversations++;
        const base = path.join(root, 'conversations', platform, sessionType, sessionId);
        const conversation = { platform, sessionType, sessionId };
        zones.push({ id: `conversation:${platform}:${sessionType}:${sessionId}`, zone: 'conversation', label: `会话 · ${platform}/${sessionType}/${sessionId}`, conversation, areas: await areas(root, base), skills: await skills(root, 'conversation', base, { conversation }), mcp: [] });
      }
    }
  }
  return { workspace: { root, sandbox: workspace.sandbox }, zones };
}

export async function handleWorkspaceHttp(options: { config: () => RuntimeConfig; request: IncomingMessage; response: ServerResponse; url: URL; json: Json }): Promise<boolean> {
  if (options.url.pathname !== '/api/ts/workspace') return false;
  if (options.request.method !== 'GET') { options.json(options.response, 405, { error: 'Method not allowed' }); return true; }
  options.json(options.response, 200, await workspaceView(options.config()));
  return true;
}
