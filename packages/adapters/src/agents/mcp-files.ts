import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServerConfigSchema, type McpServerConfig, type RunContext, type RuntimeConfig } from '../../../contracts/src/index.js';
import { workspaceEntryV2, workspaceLocation, WorkspaceLayoutError, type WorkspaceZone } from '../execution/workspace-layout.js';

const MAX_MCP_FILE_BYTES = 256_000;
const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Load workspace v2 MCP definitions. Agent files override global files; conversations are unsupported. */
export async function loadWorkspaceMcpServers(config: RuntimeConfig, context: RunContext): Promise<McpServerConfig[]> {
  const workspace = config.workspace;
  if (workspace === undefined) return [];
  const definitions = new Map<string, McpServerConfig>();
  const loadZone = async (zone: WorkspaceZone): Promise<void> => {
    const location = workspaceLocation(context, zone, 'mcp');
    let directory: string;
    try { directory = await workspaceEntryV2(workspace.root, location); }
    catch (error) { if (missing(error)) return; throw error; }
    let names: string[];
    try { names = (await readdir(directory)).sort(); }
    catch (error) { if (missing(error)) return; throw error; }
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const file = path.join(directory, name);
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_MCP_FILE_BYTES) continue;
        const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
        const parsed = McpServerConfigSchema.safeParse(raw);
        if (parsed.success) definitions.set(parsed.data.id, parsed.data);
      } catch (error) {
        if (error instanceof WorkspaceLayoutError) continue;
        // Invalid JSON or unreadable files are ignored; the Dashboard reports the file as invalid later.
        if (error instanceof SyntaxError || missing(error)) continue;
        throw error;
      }
    }
  };
  await loadZone('global');
  await loadZone('agent');
  return [...definitions.values()];
}
