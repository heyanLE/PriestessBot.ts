import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function moduleUrl(path, imports = {}) {
  let source = readFileSync(resolve(root, path), 'utf8');
  for (const [name, url] of Object.entries(imports))
    source = source.replaceAll(`from '${name}'`, `from '${url}'`);
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
export const modelUrl = moduleUrl('src/models/configV3.ts');
export const model = await import(modelUrl);
export function fixture() {
  const agent = model.newAgent('assistant', 'main');
  agent.llm.model = 'gpt-4.1';
  agent.displayName = '日常助手';
  return {
    schemaVersion: 3,
    platformDirectory: 'data/platform',
    runtime: {
      server: {
        enabled: true,
        host: '127.0.0.1',
        port: 18080,
        corsEnabled: true,
        apiCredentialRef: null,
      },
      database: { path: 'data/priestess.db' },
      plugins: { enabled: true, directory: 'plugins', autoDiscover: true },
      reload: { enabled: false, intervalMillis: 2000, stabilityWindowMillis: 500 },
      pipeline: {
        wakingPrefix: '/',
        whitelistEnabled: false,
        whitelistUsers: [],
        whitelistGroups: [],
        rateLimitEnabled: true,
        rateLimitPerMinute: 20,
        maxHistoryMessages: 50,
      },
      command: { prefix: '/' },
      permission: { superAdminIds: [], adminIds: [] },
    },
    ims: [
      {
        id: 'qq',
        name: 'QQ 日常群',
        type: 'napcat4_18_6',
        enabled: true,
        credentialRefs: {},
        settings: { host: '127.0.0.1', port: '3000', wsPort: '3001' },
        permission: { superAdminIds: [], adminIds: [] },
        routes: model.defaultRoutes('assistant'),
      },
    ],
    llms: [
      {
        id: 'main',
        type: 'openai',
        enabled: true,
        endpoint: 'https://api.example.com/v1',
        credentialRef: { source: 'ENVIRONMENT', key: 'MODEL_API_KEY' },
        settings: {},
      },
    ],
    agents: [agent],
    skillLibraries: [
      { id: 'shared', name: '通用技能库', directory: 'skills/shared', enabled: true },
    ],
    memoryLibraries: [
      { id: 'shared', name: '公共记忆', description: '跨 Agent 共享的记忆', enabled: true },
    ],
    mcpServers: [
      {
        id: 'search',
        enabled: true,
        required: false,
        transport: 'streamable_http',
        command: '',
        args: [],
        url: 'https://example.com/mcp',
        credentialRefs: {},
        settings: {},
      },
    ],
    toolPolicy: { ...model.newPolicy(), enabled: null },
  };
}
