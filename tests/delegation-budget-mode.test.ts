import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, type AgentDefinition, type AgentEngine, type EngineInput, type EngineResult, type RunContext, type RunEvent } from '../packages/contracts/src/index.js';
import { AuthorizationService, DelegationService, RuntimeStore } from '../packages/core/src/index.js';
const message = MessageEventSchema.parse({ platform: 'tg', platformType: 'telegram', sessionId: 'room', sessionType: 'group', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'Delegate' }] });
function definition(id: string, mode: 'context' | 'cumulative', maxTokens: number, targets: string[] = []): AgentDefinition { return AgentDefinitionSchema.parse({ id, displayName: id, capabilities: ['chat', 'agent.delegate'], resources: { memoryLibraries: ['shared'] }, delegationTargets: targets, budget: { tokenLimitMode: mode, maxTokens, maxConcurrentChildren: 2, maxDelegations: 8, maxDelegationDepth: 3 } }); }
function fixture(parent: AgentDefinition, children: AgentDefinition[], run: (input: EngineInput, emit: (event: RunEvent) => void) => Promise<EngineResult>) {
  const store = new RuntimeStore(':memory:');
  const auth = new AuthorizationService([GrantSchema.parse({ platform: 'tg', senderId: 'alice', maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities: parent.capabilities, resources: parent.resources })], store);
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
  const context: RunContext = { runId: RunIdSchema.parse('parent'), turnId: 'parent-turn', principal, agentId: parent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, parent), signal: new AbortController().signal, budget: parent.budget, depth: 0 };
  const engine: AgentEngine = { id: 'agents_sdk', version: 'test', capabilities: { streaming: false, images: false, files: false, cancellation: true, approvals: false, steering: false }, run };
  const service = new DelegationService(auth, id => children.find(child => child.id === id), () => engine);
  return { context, service, auth, close: () => { service.release(context.runId); store.close(); } };
}
function usage(input: EngineInput, tokens: number): RunEvent { return { type: 'usage', runId: input.context.runId, turnId: input.context.turnId, sequence: 1, timestamp: Date.now(), inputTokens: tokens, outputTokens: 0, source: 'model' }; }
await test('context parent permits aggregate child usage above its maxTokens while preserving each child mode', async () => {
  const parent = definition('parent', 'context', 10, ['child', 'bounded']); const child = definition('child', 'context', 20); const bounded = definition('bounded', 'cumulative', 30); let calls = 0;
  const f = fixture(parent, [child, bounded], async input => { await Promise.resolve(); calls++; assert.equal(input.context.budget.tokenLimitMode, input.agent.budget.tokenLimitMode); assert.equal(input.context.budget.maxTokens, input.agent.budget.maxTokens); assert.equal(input.context.principal.senderId, 'alice'); return { status: 'completed', text: '', inputTokens: input.agent.id === 'child' ? 100 : 25, outputTokens: 0 }; });
  try { for (const id of ['child', 'child', 'bounded']) await f.service.delegate(f.context, parent, id, 'task', message, () => {}); assert.equal(calls, 3); }
  finally { f.close(); }
});
await test('cumulative parent forces a context child into allocated cumulative mode and cannot overspend', async () => {
  const parent = definition('parent', 'cumulative', 100, ['child']); const child = definition('child', 'context', 1000); const allocations: number[] = [];
  const f = fixture(parent, [child], async input => { await Promise.resolve(); assert.equal(input.context.budget.tokenLimitMode, 'cumulative'); allocations.push(input.context.budget.maxTokens); return { status: 'completed', text: '', inputTokens: input.context.budget.maxTokens + 1, outputTokens: 0 }; });
  try { await assert.rejects(f.service.delegate(f.context, parent, 'child', 'task', message, () => {}), /allocated token/); assert.equal(allocations[0], 50); await assert.rejects(f.service.delegate(f.context, parent, 'child', 'task', message, () => {}), /allocated token/); assert.equal(allocations[1], 24); }
  finally { f.close(); }
});
await test('failed child usage is charged and concurrent reservation is released for the next child', async () => {
  const parent = definition('parent', 'cumulative', 100, ['child']); const child = definition('child', 'cumulative', 100); let calls = 0; const allocations: number[] = []; const emitted: RunEvent[] = [];
  const f = fixture(parent, [child], async (input, emit) => { await Promise.resolve(); calls++; allocations.push(input.context.budget.maxTokens); if (calls === 1) { emit(usage(input, 40)); throw new Error('child provider failed after usage'); } return { status: 'completed', text: 'recovered', inputTokens: 10, outputTokens: 0 }; });
  try { await assert.rejects(f.service.delegate(f.context, parent, 'child', 'task', message, event => emitted.push(event)), /provider failed/); assert.equal(emitted.filter(event => event.type === 'usage').length, 1); assert.equal((await f.service.delegate(f.context, parent, 'child', 'task', message, () => {})).text, 'recovered'); assert.deepEqual(allocations, [50, 30]); }
  finally { f.close(); }
});
await test('nested cumulative allocation under a context root respects the intermediate child cap', async () => {
  const parent = definition('parent', 'context', 10, ['child']); const child = definition('child', 'cumulative', 100, ['grand']); const grand = definition('grand', 'context', 1000); const allocations: number[] = [];
  const f = fixture(parent, [child, grand], async input => {
    if (input.agent.id === 'child') { const result = await f.service.delegate(input.context, child, 'grand', 'nested', message, () => {}); return { status: 'completed', text: '', inputTokens: result.inputTokens + 5, outputTokens: 0 }; }
    assert.equal(input.context.budget.tokenLimitMode, 'cumulative'); allocations.push(input.context.budget.maxTokens); return { status: 'completed', text: '', inputTokens: 50, outputTokens: 0 };
  });
  try { await f.service.delegate(f.context, parent, 'child', 'task', message, () => {}); await f.service.delegate(f.context, parent, 'child', 'task', message, () => {}); assert.deepEqual(allocations, [100, 100]); }
  finally { f.close(); }
});
await test('nested usage included in child totals is not deducted twice from the root cumulative budget', async () => {
  const parent = definition('parent', 'cumulative', 100, ['child', 'grand']); const child = definition('child', 'cumulative', 100, ['grand']); const grand = definition('grand', 'cumulative', 100); const allocations: number[] = [];
  const f = fixture(parent, [child, grand], async input => {
    if (input.agent.id === 'child') { const result = await f.service.delegate(input.context, child, 'grand', 'nested', message, () => {}); return { status: 'completed', text: '', inputTokens: result.inputTokens + 10, outputTokens: 0 }; }
    allocations.push(input.context.budget.maxTokens); return { status: 'completed', text: '', inputTokens: 20, outputTokens: 0 };
  });
  try { await f.service.delegate(f.context, parent, 'child', 'task', message, () => {}); await f.service.delegate(f.context, parent, 'grand', 'task', message, () => {}); assert.deepEqual(allocations, [50, 35]); }
  finally { f.close(); }
});
await test('a failed intermediate child charges its own usage as well as already completed descendants', async () => {
  const parent = definition('parent', 'cumulative', 100, ['child', 'grand']); const child = definition('child', 'cumulative', 100, ['grand']); const grand = definition('grand', 'cumulative', 100); const allocations: number[] = [];
  const f = fixture(parent, [child, grand], async (input, emit) => {
    if (input.agent.id === 'child') { await f.service.delegate(input.context, child, 'grand', 'nested', message, () => {}); emit(usage(input, 15)); throw new Error('intermediate failed'); }
    allocations.push(input.context.budget.maxTokens); return { status: 'completed', text: '', inputTokens: 20, outputTokens: 0 };
  });
  try { await assert.rejects(f.service.delegate(f.context, parent, 'child', 'task', message, () => {}), /intermediate failed/); await f.service.delegate(f.context, parent, 'grand', 'task', message, () => {}); assert.deepEqual(allocations, [50, 32]); }
  finally { f.close(); }
});
