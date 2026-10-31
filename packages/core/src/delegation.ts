import { randomUUID } from 'node:crypto';
import { RunIdSchema, type AgentDefinition, type AgentEngine, type EngineResult, type MessageEvent, type RunContext, type RunEvent } from '../../contracts/src/index.js';
import type { AuthorizationService} from './authorization.js';
import { intersectResources } from './authorization.js';

interface SharedBudget { count: number; active: number; tokens: number; reservedTokens: number; limit: number; deadline: number; readonly children: Set<AbortController>; readonly reservations: Map<string, number>; }
export class DelegationService {
  private readonly budgets = new Map<string, SharedBudget>();
  constructor(private readonly auth: AuthorizationService, private readonly getAgent: (id: string) => AgentDefinition | undefined, private readonly getEngine: (id: string) => AgentEngine | undefined) {}
  async delegate(parent: RunContext, parentAgent: AgentDefinition, targetId: string, task: string, message: MessageEvent, emit: (event: RunEvent) => void): Promise<EngineResult> {
    this.auth.assert(parent, 'agent.delegate', parentAgent);
    if (!parentAgent.delegationTargets.some(id => id === targetId)) throw new Error('Agent is not a permitted delegation target');
    const target = this.getAgent(targetId);
    if (target === undefined || !target.enabled) throw new Error('Delegation target is unavailable');
    const engine = this.getEngine(target.engine);
    if (engine === undefined) throw new Error('Delegation target engine is unavailable');
    if (parent.depth >= parent.budget.maxDelegationDepth) throw new Error('Delegation depth exceeded');
    const root = parent.parentRunId ?? parent.runId;
    let shared = this.budgets.get(root);
    if (shared === undefined) { shared = { count: 0, active: 0, tokens: 0, reservedTokens: 0, limit: parent.budget.maxTokens, deadline: Date.now() + parent.budget.timeoutMs, children: new Set(), reservations: new Map() }; this.budgets.set(root, shared); }
    else if (parent.parentRunId === undefined && parent.budget.tokenLimitMode === 'cumulative') shared.limit = Math.min(shared.limit, parent.budget.maxTokens + shared.tokens);
    const parentReservation = shared.reservations.get(parent.runId);
    const cumulativeParent = parent.budget.tokenLimitMode === 'cumulative';
    const cumulativeChild = cumulativeParent || target.budget.tokenLimitMode === 'cumulative';
    const availableTokens = cumulativeParent ? Math.min(parent.budget.maxTokens, parentReservation ?? shared.limit - shared.tokens - shared.reservedTokens) : target.budget.maxTokens;
    if (shared.count >= parent.budget.maxDelegations || shared.active >= parent.budget.maxConcurrentChildren || availableTokens <= 0 || Date.now() >= shared.deadline) throw new Error('Delegation shared budget exhausted');
    const reservedTokens = cumulativeParent ? Math.min(target.budget.maxTokens, Math.floor(availableTokens / (parent.budget.maxConcurrentChildren - shared.active))) : target.budget.maxTokens;
    if (reservedTokens < 1) throw new Error('Delegation shared token budget exhausted');
    const authorized = this.auth.resolve(parent.principal, target, parent.runtimeState);
    const controller = new AbortController();
    const cancel = (): void => controller.abort(parent.signal.reason);
    parent.signal.addEventListener('abort', cancel, { once: true });
    if (parent.signal.aborted) cancel();
    const timeoutMs = Math.min(parent.budget.timeoutMs, target.budget.timeoutMs, shared.deadline - Date.now());
    const timeout = setTimeout(() => controller.abort(new Error('Delegation deadline exceeded')), timeoutMs);
    const context: RunContext = { ...parent, runId: RunIdSchema.parse(randomUUID()), turnId: randomUUID(), agentId: target.id, generationAgentId: parent.generationAgentId ?? parent.agentId, effectiveCapabilities: authorized.effectiveCapabilities.filter(capability => parent.effectiveCapabilities.includes(capability)), resources: intersectResources(parent.resources, authorized.resources), parentRunId: root, depth: parent.depth + 1, signal: controller.signal, budget: { ...target.budget, tokenLimitMode: cumulativeChild ? 'cumulative' : 'context', maxTokens: reservedTokens, timeoutMs, maxTurns: Math.min(parent.budget.maxTurns, target.budget.maxTurns), maxDelegationDepth: parent.budget.maxDelegationDepth, maxDelegations: parent.budget.maxDelegations, maxConcurrentChildren: parent.budget.maxConcurrentChildren } };
    shared.count += 1; shared.active += 1;
    if (cumulativeChild) {
      if (parentReservation === undefined) shared.reservedTokens += reservedTokens;
      else shared.reservations.set(parent.runId, parentReservation - reservedTokens);
      shared.reservations.set(context.runId, reservedTokens);
    }
    shared.children.add(controller);
    let consumedTokens = 0; let reportedTokens = 0; let reportedOwnTokens = 0;
    const childEmit = (event: RunEvent): void => {
      if (event.type === 'usage' && event.runId === context.runId) { reportedTokens += event.inputTokens + event.outputTokens; if (event.source !== 'delegation') reportedOwnTokens += event.inputTokens + event.outputTokens; }
      emit(event);
    };
    try {
      // Children bypass the parent conversation lock but share explicit count/concurrency budgets.
      const result = await engine.run({ agent: target, context, message: { ...message, messageId: context.turnId, parts: [{ type: 'text', text: task }] }, additionalContext: 'Delegated task. Return the result to the parent Agent; do not send unsolicited IM messages.', session: { engine: engine.id, version: engine.version, id: `child:${context.runId}` } }, childEmit);
      consumedTokens = result.inputTokens + result.outputTokens;
      controller.signal.throwIfAborted();
      if (cumulativeChild && Math.max(consumedTokens, reportedTokens) > reservedTokens) throw new Error('Child exceeded its allocated token budget');
      this.auth.assert(parent, 'agent.delegate', parentAgent);
      return result;
    } finally {
      clearTimeout(timeout); parent.signal.removeEventListener('abort', cancel); shared.active -= 1;
      const remaining = shared.reservations.get(context.runId) ?? 0;
      const nestedTokens = cumulativeChild ? reservedTokens - remaining : 0;
      // The child's result/usage already includes delegated descendants. Their costs
      // were charged when they finished; only charge this level's additional cost.
      const ownTokens = Math.max(reportedOwnTokens, Math.max(consumedTokens, reportedTokens) - nestedTokens, 0);
      shared.tokens += ownTokens;
      const parentRemaining = shared.reservations.get(parent.runId);
      if (cumulativeChild) {
        if (parentRemaining === undefined) shared.reservedTokens -= remaining;
        else { const unused = Math.max(0, remaining - ownTokens); shared.reservations.set(parent.runId, parentRemaining + unused); shared.reservedTokens -= remaining - unused; }
      }
      shared.reservations.delete(context.runId); shared.children.delete(controller);
    }
  }
  release(parentRunId: string): void { const budget = this.budgets.get(parentRunId); if (budget === undefined) return; for (const controller of budget.children) controller.abort(new Error('Parent run finished')); this.budgets.delete(parentRunId); }
}
