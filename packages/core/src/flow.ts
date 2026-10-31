import { FlowSimulationSchema, RuntimeConfigSchema, messageText, type FlowNodeId, type FlowSimulation, type MessageEvent, type RuntimeConfig } from '../../contracts/src/index.js';
import { AuthorizationService } from './authorization.js';
import type { RuntimeStore } from './storage.js';

export const fixedFlowNodes: readonly { id: FlowNodeId; label: string }[] = [
  { id: 'input', label: 'IM 输入' }, { id: 'normalize', label: '归一化与去重' }, { id: 'accept', label: '接收条件与限流' }, { id: 'authorize', label: '身份与运行态' }, { id: 'route', label: 'Agent 路由' }, { id: 'command', label: '指令分派' }, { id: 'context', label: '上下文' }, { id: 'agent', label: '运行 Agent' }, { id: 'deliver', label: '回复投递' }, { id: 'end', label: '结束' },
];
export const fixedFlowEdges: readonly { from: FlowNodeId; to: FlowNodeId; label?: string }[] = [
  { from: 'input', to: 'normalize' }, { from: 'normalize', to: 'accept' }, { from: 'accept', to: 'authorize' }, { from: 'accept', to: 'end', label: '忽略/拒绝' }, { from: 'authorize', to: 'route' }, { from: 'route', to: 'command' }, { from: 'command', to: 'context', label: '未命中' }, { from: 'command', to: 'deliver', label: '指令' }, { from: 'context', to: 'agent' }, { from: 'agent', to: 'deliver' }, { from: 'deliver', to: 'end' },
];
export function validateConfiguration(input: unknown): { valid: boolean; issues: string[] } {
  const parsed = RuntimeConfigSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const config = parsed.data;
  const issues: string[] = [];
  const activeIds = new Set(config.agents.filter(agent => agent.enabled).map(agent => agent.id));
  const references = [config.flow.routing.defaultAgentId, ...config.flow.routing.rules.map(rule => rule.agentId)];
  for (const id of references) if (!activeIds.has(id)) issues.push(`Flow references missing or disabled Agent: ${id}`);
  for (const agent of config.agents) {
    if (!config.connections.some(connection => connection.id === agent.connectionId)) issues.push(`Agent ${agent.id}: unknown connection ${agent.connectionId}`);
    if (agent.contextPolicy.summaryConnectionId && !config.connections.some(connection => connection.id === agent.contextPolicy.summaryConnectionId)) issues.push(`Agent ${agent.id}: unknown context summary connection ${agent.contextPolicy.summaryConnectionId}`);
    for (const id of agent.delegationTargets) if (!activeIds.has(id)) issues.push(`Agent ${agent.id}: unavailable delegation target ${id}`);
    for (const id of agent.resources.memoryLibraries) if (!config.memoryLibraries.some(library => library.id === id)) issues.push(`Agent ${agent.id}: unknown memory library ${id}`);
    if (agent.memoryExtraction.enabled && (agent.memoryExtraction.libraryId === undefined || !agent.resources.memoryLibraries.includes(agent.memoryExtraction.libraryId))) issues.push(`Agent ${agent.id}: memory extraction requires an assigned memory library`);
    for (const id of agent.resources.knowledgeLibraries) if (!config.knowledgeLibraries.some(library => library.id === id)) issues.push(`Agent ${agent.id}: unknown knowledge library ${id}`);
    for (const id of agent.resources.skills) if (!config.skillLibraries.some(library => library.id === id)) issues.push(`Agent ${agent.id}: unknown skill library ${id}`);
    for (const id of agent.resources.mcpServers) if (!config.mcpServers.some(server => server.id === id)) issues.push(`Agent ${agent.id}: unknown MCP server ${id}`);
    if (agent.resources.executionEnvironment !== 'none' && !config.executionEnvironments.some(environment => environment.id === agent.resources.executionEnvironment)) issues.push(`Agent ${agent.id}: unknown execution environment`);
  }
  for (const server of config.mcpServers) {
    if (server.transport === 'stdio' && !server.command?.trim()) issues.push(`MCP ${server.id}: stdio requires a command`);
    if (server.transport !== 'stdio' && server.url === undefined) issues.push(`MCP ${server.id}: HTTP transport requires URL`);
  }
  if (config.embedding !== undefined && !config.connections.some(connection => connection.id === config.embedding?.connectionId)) issues.push('Embedding connection not found');
  const idGroups: readonly [string, readonly string[]][] = [
    ['Agents', config.agents.map(agent => agent.id)], ['platforms', config.platforms.map(platform => platform.id)], ['connections', config.connections.map(connection => connection.id)], ['rules', config.flow.routing.rules.map(rule => rule.id)],
    ['memory libraries', config.memoryLibraries.map(library => library.id)], ['knowledge libraries', config.knowledgeLibraries.map(library => library.id)], ['skill libraries', config.skillLibraries.map(library => library.id)], ['MCP servers', config.mcpServers.map(server => server.id)], ['execution environments', config.executionEnvironments.map(environment => environment.id)],
  ];
  for (const [label, ids] of idGroups) if (new Set(ids).size !== ids.length) issues.push(`Duplicate ${label} IDs`);
  return { valid: issues.length === 0, issues };
}

/** Preview is pure: it never reserves dedupe IDs, consumes rate limits or executes commands. */
export function simulateFlow(config: RuntimeConfig, message: MessageEvent, auth = new AuthorizationService(config.grants)): FlowSimulation {
  const path: FlowSimulation['path'] = [];
  const pass = (nodeId: FlowNodeId, summary: string): void => { path.push({ nodeId, status: 'passed', summary: summary.slice(0, 500), durationMs: 0 }); };
  const terminal = (outcome: 'ignored' | 'rejected', nodeId: FlowNodeId, reason: string): FlowSimulation => {
    path.push({ nodeId, status: outcome, summary: reason, durationMs: 0 }); pass('end', reason);
    return { revision: config.flow.revision, outcome, reason, path };
  };
  pass('input', `${message.platform}/${message.sessionType}`);
  const text = messageText(message);
  if (text.length > config.flow.normalization.maxMessageChars) return terminal('rejected', 'normalize', 'Message exceeds character budget');
  pass('normalize', `${message.parts.length} content parts`);
  const allowlist = config.flow.acceptance.allowlist;
  if (allowlist.enabled && message.platform !== 'dashboard') {
    const listed = allowlist.entries.some(entry => entry.platform === message.platform && entry.sessionType === message.sessionType && entry.sessionId === message.sessionId);
    const administrator = allowlist.administrators.some(entry => entry.platform === message.platform && entry.senderId === message.senderId);
    const bypass = administrator && (message.sessionType === 'private' ? allowlist.bypassAdministratorsInPrivate : allowlist.bypassAdministratorsInGroups);
    if (!listed && !bypass) return terminal('ignored', 'accept', 'Conversation is not in the allowlist');
  }
  const group = config.flow.acceptance.groupPolicy;
  const hasAttention = message.parts.some(part => (part.type === 'mention' && part.userId === message.botId) || (part.type === 'quote' && part.senderId === message.botId));
  const commandPrefix = text.startsWith(config.flow.commands.prefix);
  if (message.sessionType === 'private' && !config.flow.acceptance.privateEnabled) return terminal('ignored', 'accept', 'Private messages disabled');
  if (message.sessionType === 'group' && (group === 'disabled' || (!hasAttention && ((commandPrefix && config.flow.acceptance.groupCommandsRequireAttention) || (group === 'mention_or_reply' && !commandPrefix))))) return terminal('ignored', 'accept', 'Group message does not mention or reply to this bot');
  pass('accept', 'Accepted');
  const rule = config.flow.routing.rules.find(candidate => (candidate.platform === undefined || candidate.platform === message.platform) && (candidate.sessionId === undefined || candidate.sessionId === message.sessionId) && (candidate.sessionType === undefined || candidate.sessionType === message.sessionType) && (candidate.senderId === undefined || candidate.senderId === message.senderId) && (candidate.textIncludes === undefined || text.includes(candidate.textIncludes)));
  const agent = config.agents.find(candidate => candidate.id === (rule?.agentId ?? config.flow.routing.defaultAgentId) && candidate.enabled);
  if (agent === undefined) return terminal('rejected', 'route', 'No enabled Agent selected');
  let state;
  try { state = auth.resolve({ platform: message.platform, senderId: message.senderId, sessionId: message.sessionId, sessionType: message.sessionType }, agent); }
  catch (error) { return terminal('rejected', 'authorize', error instanceof Error ? error.message : 'Authorization failed'); }
  pass('authorize', state.runtimeState); pass('route', agent.id);
  const commandName = text.startsWith(config.flow.commands.prefix) ? text.slice(config.flow.commands.prefix.length).trim().split(/\s/, 1)[0]?.toLowerCase() : undefined;
  const command = commandName !== undefined && ['help', 'new', 'reset', 'stop', 'state'].includes(commandName);
  pass('command', command ? `Command: ${commandName}` : 'Normal conversation');
  if (!command) { if (!state.effectiveCapabilities.includes('chat')) return terminal('rejected', 'agent', 'Chat capability denied'); pass('context', 'Authorized memory and knowledge only'); pass('agent', agent.displayName); }
  pass('deliver', 'Preview only'); pass('end', 'Complete');
  return FlowSimulationSchema.parse({ revision: config.flow.revision, outcome: command ? 'command' : 'agent', agentId: agent.id, runtimeState: state.runtimeState, path });
}
export class FlowService {
  private readonly rates = new Map<string, number[]>();
  constructor(private readonly store: RuntimeStore, private readonly auth: AuthorizationService) {}
  publish(config: RuntimeConfig, expectedRevision: number, commitRelated?: () => void): RuntimeConfig {
    const validation = validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.issues.join('; '));
    const result = this.store.publishConfig(config, expectedRevision, commitRelated);
    this.auth.replaceGrants(result.grants);
    return result;
  }
  saveDraft(config: RuntimeConfig): void { this.store.put('flow', 'draft', RuntimeConfigSchema.parse(config)); }
  draft(): RuntimeConfig | undefined { return this.store.get('flow', 'draft', RuntimeConfigSchema); }
  rollback(revision: number, expectedRevision: number): RuntimeConfig {
    const previous = this.store.getConfig(revision);
    if (previous === undefined) throw new Error('Unknown configuration revision');
    return this.publish(previous, expectedRevision);
  }
  simulate(config: RuntimeConfig, message: MessageEvent): FlowSimulation { return simulateFlow(config, message, new AuthorizationService(config.grants, this.store)); }
  accept(config: RuntimeConfig, message: MessageEvent, now = Date.now()): FlowSimulation {
    const preview = simulateFlow(config, message, this.auth);
    if (preview.outcome === 'ignored' || preview.outcome === 'rejected') return preview;
    const reject = (reason: string): FlowSimulation => ({ ...preview, outcome: 'ignored', reason });
    if (!this.store.claimEvent(JSON.stringify([message.platform, message.sessionType, message.sessionId, message.messageId]), config.flow.normalization.dedupeWindowMs, now)) return reject('Duplicate message');
    const text = messageText(message);
    const command = text.startsWith(config.flow.commands.prefix) ? text.slice(config.flow.commands.prefix.length).trim().split(/\s/, 1)[0]?.toLowerCase() : undefined;
    // Stop/reset controls still undergo identity and command authorization, but a full
    // conversation's rate budget must not prevent the caller from stopping its work.
    if (command === 'stop' || command === 'new' || command === 'reset' || config.flow.acceptance.rateLimitCount === 0) return preview;
    const rateKey = JSON.stringify([message.platform, message.sessionType, message.sessionId, message.senderId]);
    const timestamps = (this.rates.get(rateKey) ?? []).filter(timestamp => timestamp > now - config.flow.acceptance.rateLimitWindowMs);
    if (timestamps.length >= config.flow.acceptance.rateLimitCount) return reject('Rate limit exceeded');
    timestamps.push(now); this.rates.set(rateKey, timestamps);
    for (const [key, times] of this.rates) if ((times.at(-1) ?? 0) < now - config.flow.acceptance.rateLimitWindowMs) this.rates.delete(key);
    return preview;
  }
}
