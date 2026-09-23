export type PermissionGroup = 'OPERATOR' | 'ADMIN' | 'SUPER_ADMIN';
export interface CredentialRef {
  source: 'ENVIRONMENT';
  key: string;
}
export interface ToolPolicy {
  enabled?: Record<string, boolean> | null;
  minimumPermissionGroups?: Record<string, PermissionGroup>;
  allow: string[];
  deny: string[];
  allowedRiskLevels: string[];
}
export interface ProviderConnection {
  id: string;
  type: string;
  enabled: boolean;
  endpoint: string;
  credentialRef: CredentialRef | null;
  settings: Record<string, string>;
}
export interface SkillLibrary {
  id: string;
  name: string;
  directory: string;
  enabled: boolean;
}
export interface MemoryLibrary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}
export interface McpServer {
  id: string;
  enabled: boolean;
  required: boolean;
  transport: string;
  command: string;
  args: string[];
  url: string;
  credentialRefs: Record<string, CredentialRef>;
  settings: Record<string, string>;
}
export interface SkillSource {
  enabled: boolean;
  permissionGroup: PermissionGroup;
}
export interface AgentProfile {
  id: string;
  displayName: string;
  enabled: boolean;
  instructions: string;
  /** How this Agent operates. The runtime rejects a value that is not in the preset registry. */
  preset: string;
  llm: {
    providerRef: string;
    model: string;
    generation: { temperature: number; maxOutputTokens: number | null };
  };
  configDirectory: string;
  tempDirectory: string;
  context: {
    personaExampleTokens: number;
    compression: { strategy: string; maxRounds: number; maxTokens: number };
    toolResults: {
      inlineTokens: number;
      previewTokens: number;
      ttlSeconds: number;
      maxBytes: number;
      storeMaxBytes: number;
    };
  };
  execution: { maxSteps: number; toolTimeoutMillis: number };
  skills: {
    platformLibraries: Array<SkillSource & { libraryId: string }>;
    configuration: SkillSource;
    temporary: SkillSource;
  };
  memory: {
    libraryIds: string[];
    writeLibraryId: string | null;
    maxInjected: number;
    allowedScopes: string[];
  };
  personaId: string | null;
  mcpServerIds: string[];
  toolPolicy: ToolPolicy;
}
export interface ImRoute {
  id: string;
  name: string;
  enabled: boolean;
  match: {
    sessionTypes: string[];
    attention: 'ANY' | 'MENTION' | 'REPLY' | 'MENTION_OR_REPLY' | 'NONE';
    attentionTarget: 'BOT' | 'ANY';
    stripMentions: boolean;
    textMode: 'GLOB' | 'PREFIX' | 'EXACT';
    textPattern: string;
  };
  action: { type: 'AGENT' | 'COMMAND'; agentId: string | null; commandPrefix: string };
}
export interface ImConnection {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  credentialRefs: Record<string, CredentialRef>;
  settings: Record<string, string>;
  permission: { superAdminIds: string[]; adminIds: string[] };
  routes: ImRoute[];
}
export interface RuntimeConfig {
  server: {
    enabled: boolean;
    host: string;
    port: number;
    corsEnabled: boolean;
    apiCredentialRef: CredentialRef | null;
  };
  database: { path: string };
  plugins: { enabled: boolean; directory: string; autoDiscover: boolean };
  reload: { enabled: boolean; intervalMillis: number; stabilityWindowMillis: number };
  pipeline: {
    wakingPrefix: string;
    whitelistEnabled: boolean;
    whitelistUsers: string[];
    whitelistGroups: string[];
    rateLimitEnabled: boolean;
    rateLimitPerMinute: number;
    maxHistoryMessages: number;
  };
  command: { prefix: string };
  permission: { superAdminIds: string[]; adminIds: string[] };
}
export interface ApplicationConfig {
  schemaVersion: 3;
  runtime: RuntimeConfig;
  platformDirectory: string;
  ims: ImConnection[];
  llms: ProviderConnection[];
  agents: AgentProfile[];
  skillLibraries: SkillLibrary[];
  memoryLibraries: MemoryLibrary[];
  mcpServers: McpServer[];
  toolPolicy: ToolPolicy;
}
export const riskLevels = [
  'SAFE_READ',
  'SESSION_ACTION',
  'EXTERNAL_READ',
  'STATE_WRITE',
  'HIGH_RISK',
];
export const permissions: PermissionGroup[] = ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'];
export const scopes = ['GLOBAL', 'PLATFORM', 'SESSION', 'USER', 'AGENT'];
export const permissionLabels: Record<PermissionGroup, string> = {
  OPERATOR: '普通干员',
  ADMIN: '资深干员',
  SUPER_ADMIN: '高级资深干员',
};
export const newPolicy = (): ToolPolicy => ({
  enabled: {},
  minimumPermissionGroups: {},
  allow: [],
  deny: [],
  allowedRiskLevels: [...riskLevels],
});
/** A preset as the server reports it. Fetched, never hardcoded here, so the two cannot disagree. */
export interface AgentPresetView {  preset: string;
  displayName: string;
  description: string;
  maxSteps: number;
  maxContextTokens: number;
  maxRounds: number;
}

/**
 * Baseline runtime budgets for a newly created Agent. These MUST stay equal to
 * `AgentRuntimeDefaults` in `config/model/AgentRuntimeDefaults.kt`; the Kotlin
 * `AgentRuntimeDefaultsDriftTest` reads this file and fails on any mismatch.
 *
 * They are the *chat* preset's budgets. A different preset brings its own, so `newAgent` prefers the
 * definition the server supplied and only falls back to these when none was given.
 */
export const agentRuntimeDefaults = {
  maxContextTokens: 32768,
  maxSteps: 25,
};

/**
 * Presentation only. The *accepted* strategy values come from `GET /api/compression-strategies`, so a new
 * strategy never leaves this dropdown offering an outdated list.
 */
export const compressionStrategyLabels: Record<string, string> = {
  token_window: 'Token 窗口',
  round_truncation: '按轮次截断',
  llm_summarization: '模型摘要（长任务推荐）',
};

export const newAgent = (id: string, providerRef = '', preset?: AgentPresetView): AgentProfile => ({
  id,
  displayName: id,
  enabled: true,
  instructions: '',
  preset: preset?.preset ?? 'NORMAL',
  llm: { providerRef, model: '', generation: { temperature: 0.7, maxOutputTokens: null } },
  configDirectory: `agents/${id}/config`,
  tempDirectory: `agents/${id}/temp`,
  context: {
    personaExampleTokens: 512,
    compression: {
      strategy: 'token_window',
      maxRounds: preset?.maxRounds ?? 20,
      maxTokens: preset?.maxContextTokens ?? agentRuntimeDefaults.maxContextTokens,
    },
    toolResults: {
      inlineTokens: 2048,
      previewTokens: 512,
      ttlSeconds: 1800,
      maxBytes: 4194304,
      storeMaxBytes: 67108864,
    },
  },
  execution: { maxSteps: preset?.maxSteps ?? agentRuntimeDefaults.maxSteps, toolTimeoutMillis: 30000 },
  skills: {
    platformLibraries: [],
    configuration: { enabled: true, permissionGroup: 'OPERATOR' },
    temporary: { enabled: true, permissionGroup: 'OPERATOR' },
  },
  memory: { libraryIds: [], writeLibraryId: null, maxInjected: 5, allowedScopes: [...scopes] },
  personaId: null,
  mcpServerIds: [],
  toolPolicy: newPolicy(),
});
export const newRoute = (id: string, agentId: string | null = null): ImRoute => ({
  id,
  name: '新路由',
  enabled: true,
  match: {
    sessionTypes: ['GROUP'],
    attention: 'MENTION_OR_REPLY',
    attentionTarget: 'BOT',
    stripMentions: true,
    textMode: 'GLOB',
    textPattern: '*',
  },
  action: { type: 'AGENT', agentId, commandPrefix: '#' },
});
export function defaultRoutes(agentId: string | null): ImRoute[] {
  return ['GROUP', 'PRIVATE'].flatMap((session) =>
    ['COMMAND', 'AGENT'].map((type) => {
      const route = newRoute(`${session.toLowerCase()}-${type.toLowerCase()}`, agentId);
      route.name = `${session === 'GROUP' ? '群聊' : '私聊'}${type === 'COMMAND' ? '命令' : '对话'}`;
      route.match.sessionTypes = [session];
      route.match.attention = session === 'GROUP' ? 'MENTION_OR_REPLY' : 'ANY';
      route.match.textMode = type === 'COMMAND' ? 'PREFIX' : 'GLOB';
      route.match.textPattern = type === 'COMMAND' ? '#' : '*';
      route.action.type = type as 'COMMAND' | 'AGENT';
      route.action.agentId = type === 'COMMAND' ? null : agentId;
      return route;
    }),
  );
}
export function uniqueId(prefix: string, items: Array<{ id: string }>): string {
  let i = 1;
  while (items.some((item) => item.id === `${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}
export function moveItem<T>(items: T[], index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= items.length) return;
  const [item] = items.splice(index, 1);
  items.splice(target, 0, item);
}
export function validateConfiguration(document: ApplicationConfig): string[] {
  const errors: string[] = [];
  const requireText = (value: string | undefined, label: string) => {
    if (!value?.trim()) errors.push(`${label}不能为空`);
  };
  const integer = (value: number, min: number, label: string) => {
    if (!Number.isInteger(value) || value < min)
      errors.push(`${label}必须是大于等于 ${min} 的整数`);
  };
  for (const [label, entities] of Object.entries({
    IM: document.ims,
    LLM: document.llms,
    Agent: document.agents,
    Skill库: document.skillLibraries,
    记忆库: document.memoryLibraries,
    MCP: document.mcpServers,
  })) {
    const ids = new Set<string>();
    entities.forEach((item) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(item.id))
        errors.push(`${label} ID 只能包含字母、数字、点、连字符和下划线`);
      if (ids.has(item.id)) errors.push(`${label} ID 重复：${item.id}`);
      ids.add(item.id);
    });
  }
  requireText(document.platformDirectory, '平台目录');
  integer(document.runtime.server.port, 1, '服务端口');
  if (document.runtime.server.port > 65535) errors.push('服务端口不能超过 65535');
  requireText(document.runtime.server.host, '服务地址');
  requireText(document.runtime.database.path, '数据库路径');
  integer(document.runtime.reload.intervalMillis, 1, '重载间隔');
  integer(document.runtime.reload.stabilityWindowMillis, 0, '重载稳定窗口');
  integer(document.runtime.pipeline.rateLimitPerMinute, 1, '每分钟限额');
  integer(document.runtime.pipeline.maxHistoryMessages, 1, '历史条数');
  document.llms.forEach((llm) => {
    requireText(llm.type, `LLM ${llm.id} 类型`);
    if (llm.endpoint && !/^https?:\/\//.test(llm.endpoint))
      errors.push(`LLM ${llm.id} 地址必须以 http:// 或 https:// 开头`);
    if (llm.credentialRef) requireText(llm.credentialRef.key, `LLM ${llm.id} 环境变量名`);
  });
  document.skillLibraries.forEach((lib) => {
    requireText(lib.name, `Skill 库 ${lib.id} 名称`);
    requireText(lib.directory, `Skill 库 ${lib.id} 目录`);
  });
  document.memoryLibraries.forEach((lib) => requireText(lib.name, `记忆库 ${lib.id} 名称`));
  document.agents.forEach((agent) => {
    const label = `Agent ${agent.id}`;
    requireText(agent.displayName, `${label} 名称`);
    requireText(agent.configDirectory, `${label} 配置目录`);
    requireText(agent.tempDirectory, `${label} 临时目录`);
    if (!document.llms.some((item) => item.id === agent.llm.providerRef))
      errors.push(`${label} 必须选择有效 LLM 连接`);
    requireText(agent.llm.model, `${label} 模型`);
    if (
      !Number.isFinite(agent.llm.generation.temperature) ||
      agent.llm.generation.temperature < 0 ||
      agent.llm.generation.temperature > 2
    )
      errors.push(`${label} temperature 必须介于 0 和 2`);
    if (agent.llm.generation.maxOutputTokens !== null)
      integer(agent.llm.generation.maxOutputTokens, 1, `${label} 最大输出 token`);
    integer(agent.execution.maxSteps, 1, `${label} 执行步数`);
    integer(agent.execution.toolTimeoutMillis, 1, `${label} 工具超时`);
    integer(agent.context.personaExampleTokens, 0, `${label} 人格示例预算`);
    integer(agent.context.compression.maxRounds, 1, `${label} 上下文轮数`);
    integer(agent.context.compression.maxTokens, 1, `${label} 上下文 token`);
    Object.entries(agent.context.toolResults).forEach(([key, value]) =>
      integer(value, 1, `${label} ${key}`),
    );
    integer(agent.memory.maxInjected, 0, `${label} 记忆注入条数`);
    agent.skills.platformLibraries.forEach((mount) => {
      if (!document.skillLibraries.some((lib) => lib.id === mount.libraryId))
        errors.push(`${label} 引用了不存在的 Skill 库 ${mount.libraryId}`);
    });
    agent.memory.libraryIds.forEach((id) => {
      if (!document.memoryLibraries.some((lib) => lib.id === id))
        errors.push(`${label} 引用了不存在的记忆库 ${id}`);
    });
    if (
      agent.memory.writeLibraryId &&
      !agent.memory.libraryIds.includes(agent.memory.writeLibraryId)
    )
      errors.push(`${label} 写入库必须属于已装配的记忆库`);
    agent.mcpServerIds.forEach((id) => {
      if (!document.mcpServers.some((mcp) => mcp.id === id))
        errors.push(`${label} 引用了不存在的 MCP ${id}`);
    });
  });
  document.ims.forEach((im) => {
    requireText(im.name, `IM ${im.id} 名称`);
    if (im.type === 'napcat4_18_6')
      for (const port of ['port', 'wsPort']) {
        const value = im.settings[port];
        if (
          value !== undefined &&
          value !== '' &&
          (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
        )
          errors.push(`IM ${im.id} ${port} 必须介于 1 和 65535`);
      }
    if (im.settings.baseUrl && !/^https?:\/\//.test(im.settings.baseUrl))
      errors.push(`IM ${im.id} API 地址必须以 http:// 或 https:// 开头`);
    Object.entries(im.credentialRefs).forEach(([key, value]) => {
      requireText(key, `IM ${im.id} 凭据用途`);
      requireText(value.key, `IM ${im.id} 凭据环境变量名`);
    });
    const ids = new Set<string>();
    im.routes.forEach((route, index) => {
      const label = `IM ${im.id} 第 ${index + 1} 条路由`;
      requireText(route.id, `${label} ID`);
      if (ids.has(route.id)) errors.push(`${label} ID 重复`);
      ids.add(route.id);
      requireText(route.name, `${label} 名称`);
      if (!route.match.sessionTypes.length) errors.push(`${label} 至少选择一个会话类型`);
      requireText(route.match.textPattern, `${label} 文本规则`);
      if (
        route.action.type === 'AGENT' &&
        !document.agents.some((agent) => agent.id === route.action.agentId)
      )
        errors.push(`${label} 必须选择有效 Agent`);
      if (route.action.type === 'COMMAND')
        requireText(route.action.commandPrefix, `${label} 命令前缀`);
    });
  });
  document.mcpServers.forEach((mcp) => {
    Object.entries(mcp.credentialRefs).forEach(([key, value]) => {
      requireText(key, `MCP ${mcp.id} 凭据用途`);
      requireText(value.key, `MCP ${mcp.id} 凭据环境变量名`);
    });
    if (mcp.transport === 'stdio') requireText(mcp.command, `MCP ${mcp.id} 命令`);
    else if (!/^https?:\/\//.test(mcp.url)) errors.push(`MCP ${mcp.id} 需要有效 HTTP 地址`);
  });
  return errors;
}
