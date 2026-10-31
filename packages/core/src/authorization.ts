import { GrantListSchema, runtimeStateCapabilities, runtimeStateRanks, type AgentDefinition, type Capability, type Grant, type Principal, type ResourceBindings, type RunContext, type RuntimeState } from '../../contracts/src/index.js';
import type { RuntimeStore } from './storage.js';

export class AuthorizationError extends Error { readonly code = 'forbidden'; }
export const stateRanks = runtimeStateRanks;
export function principalKey(principal: Principal): string { return JSON.stringify([principal.platform, principal.sessionType ?? 'private', principal.sessionId, principal.senderId]); }
export function conversationKey(principal: Principal, agentId: string): string { return JSON.stringify([principal.platform, principal.sessionType ?? 'private', principal.sessionId, agentId]); }
export function historyKey(context: RunContext): string { return JSON.stringify([principalKey(context.principal), context.agentId, context.generation, context.runtimeState, context.grantVersion]); }
function intersection(left: readonly string[], right: readonly string[]): string[] { return left.filter(value => right.includes(value)); }
export function intersectResources(left: ResourceBindings, right: ResourceBindings): ResourceBindings {
  return { memoryLibraries: intersection(left.memoryLibraries, right.memoryLibraries), knowledgeLibraries: intersection(left.knowledgeLibraries, right.knowledgeLibraries), skills: intersection(left.skills, right.skills), mcpServers: intersection(left.mcpServers, right.mcpServers), tools: intersection(left.tools, right.tools), directories: intersection(left.directories, right.directories), executionEnvironment: left.executionEnvironment === right.executionEnvironment ? left.executionEnvironment : 'none' };
}
export interface AuthorizationSnapshot { readonly runtimeState: RuntimeState; readonly effectiveCapabilities: Capability[]; readonly resources: ResourceBindings; readonly grantVersion: number; }
export class AuthorizationService {
  private grants: readonly Grant[];
  private version = 1;
  constructor(grants: readonly Grant[], private readonly store?: RuntimeStore) {
    this.grants = GrantListSchema.parse(grants);
    // Configuration revision survives restart; an in-memory counter alone could reopen
    // a broader historical authorization domain after a later, restricted config boots.
    this.version = Math.max(1, store?.getConfig()?.revision ?? 1);
  }
  replaceGrants(grants: readonly Grant[]): void { this.grants = GrantListSchema.parse(grants); this.version = Math.max(this.version + 1, this.store?.getConfig()?.revision ?? 0); }
  private grant(principal: Principal): Grant | undefined {
    const matches = this.grants.filter(grant => grant.platform === principal.platform && grant.senderIds.includes(principal.senderId) && (grant.sessionType === undefined || grant.sessionType === (principal.sessionType ?? 'private')) && (grant.sessionId === undefined || grant.sessionId === principal.sessionId));
    const specificity = (grant: Grant): number => (grant.sessionId === undefined ? 0 : 2) + (grant.sessionType === undefined ? 0 : 1);
    return matches.sort((left, right) => specificity(right) - specificity(left))[0];
  }
  state(principal: Principal): RuntimeState {
    // Historic requested-state records cannot override the administrator's fixed assignment.
    return this.grant(principal)?.state ?? 'operator';
  }
  requestState(principal: Principal, state: RuntimeState): RuntimeState {
    const assigned = this.state(principal);
    if (state !== assigned) throw new AuthorizationError('运行态由管理员分配。请在发送者授权中修改。');
    return assigned;
  }
  resolve(principal: Principal, agent: AgentDefinition, ceiling: RuntimeState = 'elite_operator', environmentCapabilities: readonly Capability[] = runtimeStateCapabilities.elite_operator): AuthorizationSnapshot {
    const requested = this.state(principal);
    const runtimeState = stateRanks[requested] <= stateRanks[ceiling] ? requested : ceiling;
    const effectiveCapabilities = runtimeStateCapabilities[runtimeState].filter(capability => environmentCapabilities.includes(capability));
    // The fixed role controls operation categories. Agent bindings still limit concrete resources.
    return { runtimeState, effectiveCapabilities, resources: agent.resources, grantVersion: this.version };
  }
  assert(context: RunContext, capability: Capability, agent: AgentDefinition, resource?: { kind: 'memoryLibraries' | 'knowledgeLibraries' | 'skills' | 'mcpServers' | 'tools' | 'directories'; id: string }): void {
    if (context.signal.aborted) throw new AuthorizationError('Run cancelled');
    if (this.store !== undefined && this.store.generation(conversationKey(context.principal, context.generationAgentId ?? context.agentId)) !== context.generation) throw new AuthorizationError('Conversation generation superseded');
    if (context.grantVersion !== this.version) throw new AuthorizationError('Authorization changed; restart the run');
    const current = this.resolve(context.principal, agent, context.runtimeState);
    if (!context.effectiveCapabilities.includes(capability) || !current.effectiveCapabilities.includes(capability)) throw new AuthorizationError(`Missing capability: ${capability}`);
    if (resource !== undefined && (!context.resources[resource.kind].includes(resource.id) || !current.resources[resource.kind].includes(resource.id))) throw new AuthorizationError('Resource is not authorized');
  }
}
