import { RuntimeConfigSchema, type AgentDefinition, type RuntimeConfig } from '../../../packages/contracts/src/index';
import { runtimeNavigation, type RuntimePage } from '../components/typescript/navigation';

const configPagesByField: Readonly<Record<keyof RuntimeConfig, RuntimePage | null>> = {
  runtime: 'settings', schemaVersion: 'settings', revision: null,
  agents: 'agents', platforms: 'platforms', grants: 'permissions', connections: 'providers',
  memoryLibraries: 'memories', knowledgeLibraries: 'knowledge', executionEnvironments: 'execution',
  mcpServers: 'extensions', skillLibraries: 'extensions', embedding: 'knowledge', reranker: 'knowledge', flow: 'flow',
};
const configFields = Object.keys(configPagesByField).filter((field): field is keyof RuntimeConfig => Object.hasOwn(configPagesByField, field));

const configObjectNames: Readonly<Record<string,string>> = {agents:'Agent',connections:'模型连接',platforms:'机器人',grants:'发送者授权',flow:'消息路由',memoryLibraries:'记忆库',knowledgeLibraries:'知识库',executionEnvironments:'执行环境',mcpServers:'MCP 服务',skillLibraries:'Skills 资源库',embedding:'向量模型',reranker:'重排模型'};
const configFieldNames: Readonly<Record<string,string>> = {displayName:'名称',id:'ID',model:'模型名称',baseUrl:'API 地址',websocketUrl:'WebSocket 地址',apiBase:'API 地址',apiKeyEnv:'密钥环境变量名',tokenEnv:'令牌环境变量名',timeoutMs:'超时',maxTurns:'轮数上限',maxTokens:'Token 上限',targetTokens:'压缩后保留量',compactAtTokens:'触发压缩阈值',contextWindowTokens:'上下文窗口',summaryMaxTokens:'摘要输出上限',directory:'目录',root:'工作目录',command:'启动命令',forwardThreshold:'合并转发阈值',emojis:'表情列表',url:'地址',text:'内容',senderIds:'发送者 ID',state:'分配运行态'};

/** Give field-level guidance without displaying submitted values or raw schema diagnostics. */
export function parseEditorConfiguration(raw: unknown): RuntimeConfig {
  const result=RuntimeConfigSchema.safeParse(raw);if(result.success)return result.data;
  const lines=result.error.issues.slice(0,5).map(issue=>{
    const root=issue.path[0];const last=issue.path.at(-1);const ordinal=issue.path.find(value=>typeof value==='number');
    const object=typeof root==='string'?configObjectNames[root] ?? '配置':'配置';
    const field=typeof last==='string'?configFieldNames[last] ?? '字段':'字段';
    let next='按字段说明检查格式和范围。';
    if(issue.code==='invalid_type')next='填写有效值。';
    else if(issue.code==='too_small')next=issue.origin==='string'?`至少填写 ${issue.minimum} 个字符。`:issue.origin==='array'?`至少选择 ${issue.minimum} 项。`:`填写不小于 ${issue.minimum} 的值。`;
    else if(issue.code==='too_big')next=issue.origin==='string'?`最多填写 ${issue.maximum} 个字符。`:issue.origin==='array'?`最多选择 ${issue.maximum} 项。`:`填写不大于 ${issue.maximum} 的值。`;
    else if(issue.code==='invalid_format')next='按字段示例填写有效格式。';
    else if(issue.code==='custom'&&last==='targetTokens')next='设置为小于触发压缩阈值的数值。';
    else if(issue.code==='custom'&&last==='compactAtTokens')next='设置为小于上下文窗口的数值。';
    else if(issue.code==='custom'&&last==='summaryMaxTokens')next='设置为小于压缩后保留量的数值。';
    return `${object}${typeof ordinal==='number'?` ${ordinal+1}`:''} · ${field}：${next}`;
  });
  throw new Error(`配置未通过检查。请修改以下字段：\n${lines.join('\n')}${result.error.issues.length>5?'\n其他错误将在上述字段修正后显示。':''}`);
}

function unknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function ordered(value: unknown): unknown {
  if (unknownArray(value)) return value.map(ordered);
  if (typeof value !== 'object' || value === null) return value;
  const entries: [string, unknown][] = Object.entries(value);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.sort(([left], [right]) => left.localeCompare(right))) result[key] = ordered(item);
  return result;
}
function signature(value: unknown): string { return JSON.stringify(ordered(value)) ?? ''; }
function content(config: RuntimeConfig): RuntimeConfig { return { ...config, revision: 0, flow: { ...config.flow, revision: 0 } }; }

/** Server-managed revisions do not constitute a user edit. Object-key order is not significant; array order is. */
export function runtimeConfigSignature(config: RuntimeConfig): string { return signature(content(config)); }

export function changedConfigPages(before: RuntimeConfig, after: RuntimeConfig): RuntimePage[] {
  const left = content(before); const right = content(after); const pages = new Set<RuntimePage>();
  for (const field of configFields) {
    const page = configPagesByField[field];
    if (page !== null && signature(left[field]) !== signature(right[field])) pages.add(page);
  }
  return runtimeNavigation.filter(item => pages.has(item.id)).map(item => item.id);
}

export function mergeRuntimeConfig(base: RuntimeConfig, local: RuntimeConfig, remote: RuntimeConfig): { config: RuntimeConfig; conflicts: RuntimePage[] } {
  const original = content(base); const edited = content(local); const latest = content(remote);
  const merged: Record<string, unknown> = { ...remote }; const conflicts = new Set<RuntimePage>(); let flow = remote.flow;
  for (const field of configFields) {
    const page = configPagesByField[field]; if (page === null) continue;
    const before = signature(original[field]); const ours = signature(edited[field]); const theirs = signature(latest[field]);
    if (ours === before || ours === theirs) continue;
    if (theirs !== before) conflicts.add(page);
    // Conflicts remain explicit. Callers must not install this draft until the conflicting pages are resolved.
    merged[field] = local[field]; if (field === 'flow') flow = local.flow;
  }
  return {
    config: RuntimeConfigSchema.parse({ ...merged, revision: remote.revision, flow: { ...flow, revision: remote.flow.revision } }),
    conflicts: runtimeNavigation.filter(item => conflicts.has(item.id)).map(item => item.id),
  };
}

export function isRuntimeConfigEditor(page: RuntimePage, section?: string): boolean {
  if (['agents', 'providers', 'platforms', 'permissions', 'flow', 'settings'].includes(page)) return true;
  if (page === 'extensions') return section === 'resources';
  if (page === 'memories' || page === 'knowledge' || page === 'execution') return section === 'settings';
  return false;
}

/** Rebase an atomic Agent save without discarding drafts belonging to other objects/pages. */
export function rebaseAgentSave(base: RuntimeConfig, local: RuntimeConfig, remote: RuntimeConfig, agentId: string): { config: RuntimeConfig; conflicts: RuntimePage[] } {
  const saved = remote.agents.find(agent => agent.id === agentId);
  if (!saved) throw new Error('保存结果未包含目标 Agent，当前草稿已保留。');
  const replace = (config: RuntimeConfig): RuntimeConfig => ({
    ...config,
    agents: config.agents.some(agent => agent.id === agentId)
      ? config.agents.map(agent => agent.id === agentId ? saved : agent)
      : [...config.agents, saved],
  });
  const original = content(replace(base)); const edited = content(replace(local)); const latest = content(remote);
  const merged: RuntimeConfig = { ...remote }; const conflicts = new Set<RuntimePage>();
  function preserveField<K extends keyof RuntimeConfig>(field: K): void {
    const page = configPagesByField[field]; if (page === null) return;
    const before = signature(original[field]); const ours = signature(edited[field]); const theirs = signature(latest[field]);
    if (ours === before || ours === theirs) return;
    if (theirs !== before) conflicts.add(page);
    if (Object.hasOwn(edited, field)) merged[field] = edited[field];
    else Reflect.deleteProperty(merged, field);
  }
  for (const field of configFields) preserveField(field);
  // Other forms may be halfway through an edit. They are already typed internal state,
  // but need not satisfy publication constraints (for example a temporarily empty name).
  return { config: { ...merged, revision: remote.revision, flow: { ...merged.flow, revision: remote.flow.revision } }, conflicts: runtimeNavigation.filter(item => conflicts.has(item.id)).map(item => item.id) };
}

export function agentPublicationChanges(before: AgentDefinition | undefined, after: AgentDefinition): string[] {
  if (!before) return ['新建 Agent', '权限使用发送者的固定运行态', `执行环境：${after.resources.executionEnvironment==='none'?'不使用':after.resources.executionEnvironment}`];
  const changed = (field: keyof AgentDefinition): boolean => signature(before[field]) !== signature(after[field]);
  const labels: string[] = [];
  if (changed('displayName') || changed('model') || changed('connectionId') || changed('enabled')) labels.push('名称、模型或启用状态');
  if (changed('instructions') || changed('persona') || changed('exampleDialogs') || changed('customErrorMessage') || changed('voicePrompt')) labels.push('角色设定、示例对话或回复规则');
  if (changed('resources') || changed('skillAllowlist')) labels.push('工具、知识库与其他资源绑定');
  if (before.resources.executionEnvironment !== after.resources.executionEnvironment) labels.push(`执行环境：${before.resources.executionEnvironment} → ${after.resources.executionEnvironment}`);
  if (changed('capabilities')) labels.push('兼容字段更新（固定运行态权限不变）');
  if (changed('approvalTools')) labels.push(`逐次审批工具：${after.approvalTools.join('、') || '无'}`);
  if (changed('contextPolicy') || changed('memoryExtraction')) labels.push('上下文与长期记忆策略');
  if (changed('budget') || changed('delegationTargets')) labels.push('执行限制与多 Agent 委派');
  if (changed('permissionDenied')) labels.push('权限不足时的回复');
  return labels;
}
