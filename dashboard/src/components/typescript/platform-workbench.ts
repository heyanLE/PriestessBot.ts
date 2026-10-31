import { PlatformConfigSchema, RouteRuleSchema, type PlatformConfig, type PlatformType, type RuntimeConfig } from '../../../../packages/contracts/src/index';
export const platformLabels: Readonly<Record<PlatformType, string>> = { napcat: 'NapCat', telegram: 'Telegram', weixin: '微信' };
export function createPlatformDraft(type: PlatformType, suffix: string): PlatformConfig {
  const base = { id: `${type}-${suffix}`, displayName: `我的 ${platformLabels[type]} 机器人`, enabled: true };
  if (type === 'napcat') return PlatformConfigSchema.parse({ ...base, type, websocketUrl: 'ws://127.0.0.1:3001' });
  if (type === 'telegram') return PlatformConfigSchema.parse({ ...base, type, tokenEnv: 'TELEGRAM_TOKEN' });
  return PlatformConfigSchema.parse({ ...base, type });
}
export const platformIssueText = {
  name: '机器人名称为空。填写一个便于区分的名称。',
  id: '实例 ID 为空。填写一个未使用的 ID。',
  duplicateId: '实例 ID 已存在。填写一个未使用的 ID。',
  websocket: 'WebSocket 地址格式错误。填写 ws:// 或 wss:// 开头的地址。',
  api: 'API 地址格式错误。填写 http:// 或 https:// 开头的地址。',
  httpApi: 'HTTP API 地址格式错误。填写 http:// 或 https:// 开头的地址。',
  agent: '目标 Agent 不可用。选择一个已启用的 Agent。',
  rules: '消息路由已达到 100 条。删除不再使用的规则后重试。',
};
export function platformConfigurationIssues(platform: PlatformConfig, others: readonly PlatformConfig[]): string[] {
  const parsed = PlatformConfigSchema.safeParse(platform);
  const corrections: Readonly<Record<string, string>> = {
    id: platformIssueText.id, displayName: platformIssueText.name,
    type: '平台类型无效。重新选择接入平台。', enabled: '启用开关无效。重新选择是否启用。',
    tokenEnv: '令牌环境变量名无效。填写服务器上用于保存令牌的变量名。',
    accessTokenEnv: '令牌环境变量名无效。填写服务器上用于保存令牌的变量名。',
    apiBase: platform.type === 'napcat' ? platformIssueText.httpApi : platformIssueText.api,
    websocketUrl: platformIssueText.websocket,
    pollingTimeoutSeconds: '长轮询超时超出范围。填写 1 到 60 的整数秒数。',
    forwardThreshold: '合并转发字数阈值超出范围。填写 0 到 200000 的整数。',
    preAckEmoji: '开始处理表情列表无效。每行填写一个 QQ 表情数字 ID 或单个 Unicode 表情，最多 32 行。',
    accountId: '账号 ID 无效。填写微信账号 ID。', stateFile: '登录状态文件路径无效。填写服务器上的文件路径。',
  };
  const issues = parsed.success ? [] : parsed.error.issues.map(issue => {
    if (issue.path[0] === 'preAckEmoji' && typeof issue.path[2] === 'number') return `开始处理表情第 ${issue.path[2] + 1} 行无效。填写一个 QQ 表情数字 ID 或单个 Unicode 表情。`;
    return corrections[String(issue.path[0])] ?? `字段 ${issue.path.join('.')} 无效。重新填写此字段。`;
  });
  if (!platform.displayName.trim()) issues.push(platformIssueText.name);
  if (platform.id.trim() !== platform.id) issues.push('实例 ID 包含首尾空格。删除这些空格。');
  if (others.some(item => item.id === platform.id)) issues.push(platformIssueText.duplicateId);
  if (platform.type === 'napcat' && !/^wss?:\/\//u.test(platform.websocketUrl)) issues.push(platformIssueText.websocket);
  if (platform.type !== 'napcat' && !/^https?:\/\//u.test(platform.apiBase)) issues.push(platformIssueText.api);
  if (platform.type === 'napcat' && platform.apiBase && !/^https?:\/\//u.test(platform.apiBase)) issues.push(platformIssueText.httpApi);
  return [...new Set(issues)];
}
export function platformRouteSummary(config: RuntimeConfig, platformId: string): string {
  const names = new Map(config.agents.map(agent => [agent.id, agent.displayName]));
  const rules = config.flow.routing.rules.filter(rule => rule.platform === platformId);
  if (rules.length) return `${rules.length} 条实例规则 · ${[...new Set(rules.map(rule => names.get(rule.agentId) ?? rule.agentId))].join('、')}`;
  return `全局路由 · 默认 ${names.get(config.flow.routing.defaultAgentId) ?? config.flow.routing.defaultAgentId}`;
}

export type PreparedPlatformConnection = { ok: true; config: RuntimeConfig; platformId: string } | { ok: false; issues: string[] };
/** Build a complete draft update before the caller replaces its configuration. No input is mutated. */
export function preparePlatformConnection(config: RuntimeConfig, draft: PlatformConfig, agentId: string, ruleSuffix: string): PreparedPlatformConnection {
  const issues = platformConfigurationIssues(draft, config.platforms);
  if (agentId && !config.agents.some(agent => agent.id === agentId && agent.enabled)) issues.push(platformIssueText.agent);
  if (agentId && config.flow.routing.rules.length >= 100) issues.push(platformIssueText.rules);
  if (issues.length) return { ok: false, issues };
  const platform = PlatformConfigSchema.parse(draft);
  if (!agentId) return { ok: true, config: { ...config, platforms: [...config.platforms, platform] }, platformId: platform.id };
  const route = RouteRuleSchema.safeParse({ id: `route-${ruleSuffix}`, platform: platform.id, agentId });
  if (!route.success) return { ok: false, issues: ['目标 Agent 的 ID 无效。到 Agent 页面修正该 ID。'] };
  return { ok: true, platformId: platform.id, config: { ...config, platforms: [...config.platforms, platform], flow: { ...config.flow, routing: { ...config.flow.routing, rules: [route.data, ...config.flow.routing.rules] } } } };
}
