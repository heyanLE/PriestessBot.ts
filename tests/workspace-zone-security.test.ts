import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentDefinitionSchema, AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, type Capability, type RunContext } from '../packages/contracts/src/index.js';
import { AuthorizationService } from '../packages/core/src/authorization.js';
import { ExecutionService } from '../packages/adapters/src/execution/environment.js';
import { workspaceFailure, workspacePath } from '../packages/adapters/src/execution/workspace-zones.js';

function context(): RunContext {
  return { runId: RunIdSchema.parse('parent-run'), turnId: 'turn', principal: { platform: 'qq', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('chat') }, agentId: AgentIdSchema.parse('parent'), generation: 3, configRevision: 1, flowRevision: 1, runtimeState: 'elite_operator', effectiveCapabilities: ['files.read', 'files.write', 'resources.manage'], resources: ResourceBindingsSchema.parse({ executionEnvironment: 'local' }), grantVersion: 1, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
}
function authorize(ctx: RunContext, capability: Capability): void { ctx.signal.throwIfAborted(); if (!ctx.effectiveCapabilities.includes(capability)) throw new Error('permission denied'); }

await test('workspace aliases use exact zone boundaries and never decode traversal-like filenames', () => {
  assert.deepEqual(workspacePath('/workspace/shared/./reports//weekly.txt'), { zone: 'shared', relative: 'reports/weekly.txt', absolute: '/workspace/shared/reports/weekly.txt' });
  assert.deepEqual(workspacePath('shared/report.txt'), { zone: 'isolated', relative: 'shared/report.txt', absolute: '/workspace/files/shared/report.txt' });
  assert.deepEqual(workspacePath('%2e%2e/%2fetc/passwd'), { zone: 'isolated', relative: '%2e%2e/%2fetc/passwd', absolute: '/workspace/files/%2e%2e/%2fetc/passwd' });
  for (const forbidden of ['/workspace/sharedness/secret', '/workspace/files-other/secret', '/workspace/shared/../files/secret', 'safe/../../secret', '/etc/passwd', 'safe\\..\\secret', 'safe\0secret']) {
    assert.throws(() => workspacePath(forbidden), error => error instanceof Error && 'code' in error && error.code === 'invalid_path');
  }
});

await test('delegated Agents use their parent conversation files without crossing Agent or reset boundaries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-delegated-zones-'));
  const service = new ExecutionService({ root, backend: 'local' }, authorize);
  const parent = context();
  const child: RunContext = { ...parent, runId: RunIdSchema.parse('child-run'), parentRunId: parent.runId, agentId: AgentIdSchema.parse('researcher'), generationAgentId: parent.agentId, depth: 1 };
  try {
    await service.write(parent, 'handoff.txt', 'parent context');
    assert.equal(await service.read(child, 'handoff.txt'), 'parent context');
    await service.write(child, 'result.txt', 'delegated result');
    assert.equal(await service.read(parent, 'result.txt'), 'delegated result');
    await assert.rejects(service.read({ ...child, generationAgentId: AgentIdSchema.parse('other-parent') }, 'handoff.txt'), /not found/);
    await assert.rejects(service.read({ ...child, generation: parent.generation + 1 }, 'handoff.txt'), /not found/);
    await assert.rejects(service.read({ ...child, principal: { ...child.principal, sessionType: 'private' } }, 'handoff.txt'), /not found/);
    await service.write(parent, '/workspace/shared/common.txt', 'shared context');
    assert.equal(await service.read({ ...child, generation: parent.generation + 1 }, '/workspace/shared/common.txt'), 'shared context');
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});

await test('shared writes require the state and the write capability independently', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-zone-grants-'));
  const service = new ExecutionService({ root, backend: 'local' }, authorize);
  const elite = context();
  try {
    await service.write(elite, '/workspace/shared/common.txt', 'original');
    await assert.rejects(service.write({ ...elite, effectiveCapabilities: ['files.read'] }, '/workspace/shared/common.txt', 'no capability'), /permission denied/);
    await assert.rejects(service.write({ ...elite, effectiveCapabilities: ['files.read', 'files.write'] }, '/workspace/shared/common.txt', 'no management capability'), /permission denied/);
    await assert.rejects(service.write({ ...elite, runtimeState: 'senior_operator' }, '/workspace/shared/common.txt', 'wrong state'), /read-only/);
    await assert.rejects(service.write({ ...elite, runtimeState: 'operator' }, '/workspace/shared/common.txt', 'wrong state'), /read-only/);
    assert.equal(await readFile(path.join(root, 'shared/common.txt'), 'utf8'), 'original');
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});

await test('file failure messages preserve useful codes without returning host paths or process details', () => {
  const failures = [
    { error: Object.assign(new Error('open /private/runtime/secret-key'), { code: 'ENOENT' }), code: 'not_found' },
    { error: Object.assign(new Error('write /private/runtime/secret-key'), { code: 'EROFS' }), code: 'forbidden' },
    { error: new Error('Docker file exceeds the 1000000 byte read limit: /private/runtime/secret-key'), code: 'size_limit' },
    { error: new Error('SDK subprocess failed with credential=secret-key'), code: 'file_unavailable' },
  ];
  for (const failure of failures) {
    const mapped = workspaceFailure(failure.error);
    assert.equal(mapped.code, failure.code);
    assert.doesNotMatch(mapped.message, /private|credential|secret-key|subprocess/);
  }
});

await test('a forged elite context cannot write shared storage when the current server grant is senior', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-zone-server-grant-'));
  const auth = new AuthorizationService([{ platform: 'qq', senderIds: ['alice'], state: 'senior_operator' }]);
  const agent = AgentDefinitionSchema.parse({ id: 'parent', displayName: 'Parent', resources: { executionEnvironment: 'local' } });
  const forged = context();
  const service = new ExecutionService({ root, backend: 'local' }, (ctx, capability) => auth.assert(ctx, capability, agent));
  try {
    await service.write(forged, 'permitted.txt', 'senior isolated write');
    await assert.rejects(service.write(forged, '/workspace/shared/denied.txt', 'not permitted'), /Missing capability: resources.manage/);
    assert.equal(await service.read(forged, 'permitted.txt'), 'senior isolated write');
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
