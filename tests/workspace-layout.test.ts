import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, WorkspaceConfigSchema, type RunContext } from '../packages/contracts/src/index.js';
import {
  DEFAULT_CACHE_CLEANUP_INTERVAL_MS,
  DEFAULT_CACHE_TTL_MS,
  WorkspaceLayoutError,
  canWriteWorkspace,
  workspaceAreaPath,
  workspaceLocation,
} from '../packages/adapters/src/execution/workspace-layout.js';

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: RunIdSchema.parse('run-v2'),
    turnId: 'turn-v2',
    principal: { platform: 'qq', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('group-42') },
    agentId: AgentIdSchema.parse('assistant'),
    generation: 3,
    configRevision: 1,
    flowRevision: 1,
    runtimeState: 'elite_operator',
    effectiveCapabilities: ['files.read', 'files.write', 'resources.manage'],
    resources: ResourceBindingsSchema.parse({}),
    grantVersion: 1,
    signal: new AbortController().signal,
    budget: BudgetSchema.parse({}),
    depth: 0,
    ...overrides,
  };
}

await test('workspace v2 maps global, agent and conversation zones', () => {
  const ctx = context();
  assert.equal(workspaceAreaPath(ctx, 'global', 'skill'), 'global/skill');
  assert.equal(workspaceAreaPath(ctx, 'global', 'mcp'), 'global/mcp');
  assert.equal(workspaceAreaPath(ctx, 'agent', 'file'), 'agents/assistant/file');
  assert.equal(workspaceAreaPath(ctx, 'conversation', 'cache'), 'conversations/qq/group/group-42/cache');
  assert.equal(workspaceLocation(ctx, 'conversation', 'file', 'reports/today.md').virtualPath, '/workspace/conversations/qq/group/group-42/file/reports/today.md');
});

await test('conversation zone is shared by Agents but separated by IM source and session', () => {
  const first = context();
  const second = { ...first, agentId: AgentIdSchema.parse('researcher') };
  assert.equal(workspaceAreaPath(first, 'conversation', 'file'), workspaceAreaPath(second, 'conversation', 'file'));
  const otherGroup = { ...first, principal: { ...first.principal, sessionId: SessionIdSchema.parse('group-43') } };
  assert.notEqual(workspaceAreaPath(first, 'conversation', 'file'), workspaceAreaPath(otherGroup, 'conversation', 'file'));
  const otherPlatform = { ...first, principal: { ...first.principal, platform: 'telegram' } };
  assert.notEqual(workspaceAreaPath(first, 'conversation', 'file'), workspaceAreaPath(otherPlatform, 'conversation', 'file'));
});

await test('conversation zone does not support MCP', () => {
  assert.throws(() => workspaceAreaPath(context(), 'conversation', 'mcp'), (error: unknown) => error instanceof WorkspaceLayoutError && error.code === 'unsupported');
});

await test('unsafe IM identifiers are hashed and cannot escape the workspace root', () => {
  const ctx = { ...context(), principal: { ...context().principal, sessionId: SessionIdSchema.parse('../../etc/passwd') } };
  const path = workspaceAreaPath(ctx, 'conversation', 'file');
  assert.match(path, /^conversations\/qq\/group\/h-[a-f0-9]{40}\/file$/u);
  assert.equal(path.includes('..'), false);
  assert.throws(() => workspaceLocation(ctx, 'global', 'file', '../secret'), (error: unknown) => error instanceof WorkspaceLayoutError && error.code === 'invalid_path');
  assert.throws(() => workspaceLocation(ctx, 'global', 'file', '/etc/passwd'), (error: unknown) => error instanceof WorkspaceLayoutError && error.code === 'invalid_path');
});

await test('write policy allows elite all areas and non-elite only agent/conversation cache', () => {
  const elite = context();
  for (const zone of ['global', 'agent', 'conversation'] as const) {
    for (const area of ['skill', 'mcp', 'cache', 'file'] as const) {
      if (zone === 'conversation' && area === 'mcp') continue;
      assert.equal(canWriteWorkspace(elite, zone, area), true, `${zone}/${area}`);
    }
  }
  const operator = { ...elite, runtimeState: 'operator' as const };
  assert.equal(canWriteWorkspace(operator, 'agent', 'cache'), true);
  assert.equal(canWriteWorkspace(operator, 'conversation', 'cache'), true);
  assert.equal(canWriteWorkspace(operator, 'global', 'cache'), false);
  assert.equal(canWriteWorkspace(operator, 'agent', 'file'), false);
  assert.equal(canWriteWorkspace(operator, 'agent', 'skill'), false);
  assert.equal(canWriteWorkspace(operator, 'agent', 'mcp'), false);
  assert.equal(canWriteWorkspace({ ...elite, effectiveCapabilities: ['files.read'] }, 'agent', 'cache'), false);
  assert.equal(canWriteWorkspace({ ...elite, effectiveCapabilities: ['files.read', 'files.write'] }, 'agent', 'skill'), false);
});

await test('workspace config and cache defaults are explicit', () => {
  const config = WorkspaceConfigSchema.parse({ root: '/srv/priestess/workspace', sandbox: true });
  assert.deepEqual(config, { root: '/srv/priestess/workspace', sandbox: true, networkEnabled: true });
  assert.equal(DEFAULT_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(DEFAULT_CACHE_CLEANUP_INTERVAL_MS, 60 * 60 * 1000);
});
