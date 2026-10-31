import { randomUUID } from 'node:crypto';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, type EngineInput, type RunEvent } from '../../../packages/contracts/src/index.js';
import { AgentDraftTestSchema, AgentDraftTestResultSchema, type AgentDraftTest, type AgentDraftTestResult } from '../../../packages/contracts/src/agent-workbench.js';
import { RuntimeStore } from '../../../packages/core/src/storage.js';
import type { ManagementService } from '../../../packages/core/src/management.js';
import { AgentsSdkEngine, type AgentsEngineDependencies } from '../../../packages/adapters/src/agents/engine.js';

export class DraftTestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
interface Dependencies { management: ManagementService; secret: (name: string) => string | undefined; model?: AgentsEngineDependencies['model']; }

/** Only an SDK engine and ephemeral SQLite session are created. No platform, scheduler, extension or tool is started. */
export class AgentDraftTester {
  private readonly active = new Set<AbortController>();
  constructor(private readonly dependencies: Dependencies) {}
  stop(): void { for (const controller of this.active) controller.abort(); }
  async run(raw: AgentDraftTest, requestSignal: AbortSignal): Promise<AgentDraftTestResult> {
    const data = AgentDraftTestSchema.parse(raw);
    if (this.active.size >= 2) throw new DraftTestError(429, 'Too many draft tests');
    const candidate = data.config.agents.find(agent => agent.id === data.agentId);
    if (!candidate) throw new DraftTestError(404, 'Draft Agent not found');
    if (!candidate.enabled) throw new DraftTestError(400, 'Draft Agent is disabled');
    const connection = data.config.connections.find(item => item.id === candidate.connectionId);
    if (!connection) throw new DraftTestError(400, 'Draft model connection not found');
    if (!this.dependencies.model && !this.dependencies.secret(connection.apiKeyEnv)) throw new DraftTestError(400, 'Model credential reference unavailable');
    const resolved = this.dependencies.management.resolveAgent(candidate, data.personaId);
    const limits = { timeoutMs: Math.min(candidate.budget.timeoutMs, 120000), maxTurns: Math.min(candidate.budget.maxTurns, 3), maxTokens: Math.min(candidate.budget.maxTokens, 8192) };
    const agent = AgentDefinitionSchema.parse({ ...resolved, approvalTools: [], delegationTargets: [], capabilities: ['chat'], resources: {}, budget: { ...resolved.budget, ...limits } });
    const controller = new AbortController(); this.active.add(controller);
    const signal = AbortSignal.any([controller.signal, requestSignal, AbortSignal.timeout(limits.timeoutMs)]);
    const store = new RuntimeStore(':memory:');
    try {
      const runId = RunIdSchema.parse(randomUUID());
      const message = MessageEventSchema.parse({ platform: 'dashboard-draft-test', platformType: 'telegram', sessionId: randomUUID(), sessionType: 'private', senderId: 'dashboard-test', senderName: 'Dashboard 草稿测试', messageId: randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text: data.message }], botId: 'dashboard-draft-test' });
      const input: EngineInput = { agent, message, additionalContext: 'This is an isolated Dashboard draft test. No tools, long-term memory, knowledge, filesystem or IM delivery are available. Only test the supplied persona, example dialogs, model and context settings. Do not claim that any external action was performed.', session: { engine: 'agents_sdk', version: '0.21.0', id: `draft:${runId}` }, context: { runId, turnId: randomUUID(), principal: { platform: message.platform, senderId: message.senderId, sessionId: message.sessionId, sessionType: 'private' }, agentId: agent.id, generation: 0, configRevision: data.config.revision, flowRevision: data.config.flow.revision, runtimeState: 'operator', effectiveCapabilities: ['chat'], resources: agent.resources, grantVersion: 0, signal, budget: agent.budget, depth: 0 } };
      const events: RunEvent[] = [];
      const engine = new AgentsSdkEngine({ store, config: () => data.config, secret: this.dependencies.secret, assertCurrent: current => current.context.signal.throwIfAborted(), tools: () => Promise.resolve([]), ...(this.dependencies.model ? { model: this.dependencies.model } : {}) });
      const result = await engine.run(input, event => {
        if (event.type === 'tool' || event.type === 'paused' || event.type === 'node') return;
        const safe = event.type === 'failed' ? { ...event, error: { code: event.error.code, message: '草稿测试失败，请检查模型连接、模型名称与上下文设置。', retryable: false } } : event;
        events.push(safe); if (events.length > 512) events.shift();
      });
      return AgentDraftTestResultSchema.parse({ mode: 'draft_model_only', saved: false, deliveredToIm: false, tools: [], agentId: agent.id, personaId: data.personaId, status: result.status === 'paused' ? 'failed' : result.status, text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, events, limits });
    } catch {
      if (signal.aborted) return AgentDraftTestResultSchema.parse({ mode: 'draft_model_only', saved: false, deliveredToIm: false, tools: [], agentId: agent.id, personaId: data.personaId, status: 'cancelled', text: '草稿测试已停止或超时。', inputTokens: 0, outputTokens: 0, events: [], limits });
      throw new DraftTestError(400, 'Draft model test failed; check model connection and context settings');
    } finally { store.close(); this.active.delete(controller); }
  }
}
