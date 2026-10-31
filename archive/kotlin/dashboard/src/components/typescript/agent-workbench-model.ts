import type { AgentCapability } from '../../../../typescript/packages/contracts/src/agent-workbench';
import { RuntimeConfigSchema, requiredRuntimeState, type RuntimeState, type PlatformType, type RuntimeConfig } from '../../../../typescript/packages/contracts/src/index';
export type AgentWorkbenchTab = 'persona' | 'tools' | 'context' | 'permissions';
export function agentWorkbenchTab(value: unknown): AgentWorkbenchTab {
  if (value === 'tools' || value === 'resources') return 'tools';
  if (value === 'context') return 'context';
  if (value === 'permissions' || value === 'budget') return 'permissions';
  return 'persona';
}
export function isGeneralModelTool(entry: AgentCapability): boolean { return entry.scope === 'general' && entry.kind === 'tool' && entry.toolName !== undefined; }
export function isPlatformCapability(entry: AgentCapability, platform: PlatformType): boolean { return entry.scope === 'platform' && entry.platforms.includes(platform); }
export function capabilityBindingName(entry: AgentCapability): string | undefined {
  if (entry.kind === 'tool' || entry.kind === 'command') return entry.toolName;
  return entry.bindingName;
}
export function canMountCapability(entry: AgentCapability): boolean { return entry.availability !== 'not_implemented' && capabilityBindingName(entry) !== undefined; }
export function capabilityMinimumState(entry: AgentCapability): RuntimeState { return requiredRuntimeState(entry.requiredCapabilities); }
export function capabilityIsMounted(entry: AgentCapability, bindings: readonly string[]): boolean { const name = capabilityBindingName(entry); return name !== undefined && bindings.includes(name); }

export function draftModelTestConfig(source: RuntimeConfig, published: RuntimeConfig, agentId: string): RuntimeConfig {
  const agent = source.agents.find(item => item.id === agentId);
  if (!agent) throw new Error('找不到要测试的 Agent。请选择一个已有 Agent。');
  const connectionIds = new Set([agent.connectionId, agent.contextPolicy.summaryConnectionId].filter(Boolean));
  const parsed = RuntimeConfigSchema.safeParse({ ...published, agents: [agent], connections: source.connections.filter(item => connectionIds.has(item.id)), flow: { ...published.flow, routing: { defaultAgentId: agent.id, rules: [] } } });
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path ?? [];
    const field = path.includes('connections') ? '模型连接' : path.includes('contextPolicy') ? '上下文参数' : path.includes('displayName') ? 'Agent 名称' : path.includes('model') ? '模型名称' : '当前 Agent 设置';
    throw new Error(`${field}未通过检查。请完成必填项，并按字段范围修改。其他页面的草稿不影响此测试。`);
  }
  if (!parsed.data.connections.some(item => item.id === agent.connectionId)) throw new Error('所选模型连接不存在。请重新选择模型服务。');
  if (agent.contextPolicy.summaryConnectionId && !parsed.data.connections.some(item => item.id === agent.contextPolicy.summaryConnectionId)) throw new Error('摘要模型连接不存在。请在“上下文与记忆”中重新选择摘要服务。');
  return parsed.data;
}
