import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, type Capability, type RunContext } from '../packages/contracts/src/index.js';
import { ExecutionService } from '../packages/adapters/src/execution/environment.js';

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: RunIdSchema.parse('v2-run'),
    turnId: 'v2-turn',
    principal: { platform: 'qq', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('group-42') },
    agentId: AgentIdSchema.parse('assistant'),
    generation: 1,
    configRevision: 1,
    flowRevision: 1,
    runtimeState: 'elite_operator',
    effectiveCapabilities: ['files.read', 'files.write', 'resources.manage'],
    resources: ResourceBindingsSchema.parse({ executionEnvironment: 'workspace' }),
    grantVersion: 1,
    signal: new AbortController().signal,
    budget: BudgetSchema.parse({}),
    depth: 0,
    ...overrides,
  };
}

function authorize(ctx: RunContext, capability: Capability): void {
  if (!ctx.effectiveCapabilities.includes(capability)) throw new Error('permission denied');
}

await test('workspace v2 local backend reads and writes global, agent and conversation paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-workspace-v2-'));
  const service = new ExecutionService({ root, backend: 'local', id: 'workspace', layout: 'v2' }, authorize);
  const elite = context();
  try {
    await service.write(elite, '/workspace/global/file/note.txt', 'global');
    await service.write(elite, '/workspace/agents/assistant/file/report.txt', 'agent');
    await service.write(elite, '/workspace/conversations/qq/group/group-42/file/context.txt', 'conversation');
    assert.equal(await service.read(elite, '/workspace/global/file/note.txt'), 'global');
    assert.equal(await service.read(elite, '/workspace/agents/assistant/file/report.txt'), 'agent');
    assert.equal(await service.read(elite, '/workspace/conversations/qq/group/group-42/file/context.txt'), 'conversation');
    assert.deepEqual(await service.listFiles(elite, '/workspace/global/file'), ['note.txt']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('workspace v2 conversation files are shared by Agents but isolated by IM session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-workspace-v2-shared-'));
  const service = new ExecutionService({ root, backend: 'local', id: 'workspace', layout: 'v2' }, authorize);
  const first = context();
  const second = { ...first, agentId: AgentIdSchema.parse('researcher') };
  try {
    await service.write(first, '/workspace/conversations/qq/group/group-42/file/shared.txt', 'shared');
    assert.equal(await service.read(second, '/workspace/conversations/qq/group/group-42/file/shared.txt'), 'shared');
    const otherGroup = { ...first, principal: { ...first.principal, sessionId: SessionIdSchema.parse('group-43') } };
    await assert.rejects(service.read(otherGroup, '/workspace/conversations/qq/group/group-42/file/shared.txt'), /does not belong/u);
    await assert.rejects(service.write(first, '/workspace/agents/researcher/file/private.txt', 'no'), /does not belong/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('workspace v2 allows non-elite cache writes but rejects skill, mcp and file writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-workspace-v2-permissions-'));
  const service = new ExecutionService({ root, backend: 'local', id: 'workspace', layout: 'v2' }, authorize);
  const operator = { ...context(), runtimeState: 'operator' as const };
  try {
    await service.write(operator, '/workspace/agents/assistant/cache/tmp.txt', 'cache');
    assert.equal(await service.read(operator, '/workspace/agents/assistant/cache/tmp.txt'), 'cache');
    await assert.rejects(service.write(operator, '/workspace/agents/assistant/file/no.txt', 'no'), /Only elite_operator/u);
    await assert.rejects(service.write(operator, '/workspace/agents/assistant/skill/no/SKILL.md', 'no'), /Only elite_operator/u);
    await assert.rejects(service.write(operator, '/workspace/global/cache/no.txt', 'no'), /elite_operator/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('workspace v2 rejects conversation MCP and path traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-workspace-v2-invalid-'));
  const service = new ExecutionService({ root, backend: 'local', id: 'workspace', layout: 'v2' }, authorize);
  const elite = context();
  try {
    await assert.rejects(service.write(elite, '/workspace/conversations/qq/group/group-42/mcp/x.json', '{}'), /does not support MCP/u);
    await assert.rejects(service.write(elite, '/workspace/global/file/../secret.txt', 'no'), /canonical/u);
    await assert.rejects(service.write(elite, '/etc/passwd', 'no'), /workspace v2/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
