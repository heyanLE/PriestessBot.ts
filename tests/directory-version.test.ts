import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { directoryVersion } from '../packages/adapters/src/execution/directory-version.js';
import { workspaceDirectory } from '../packages/adapters/src/execution/workspace-zones.js';
import { SdkDockerExecutionService } from '../packages/adapters/src/execution/sdk-docker.js';
import { AgentDefinitionSchema, BudgetSchema, RunIdSchema, SessionIdSchema, type RunContext } from '../packages/contracts/src/index.js';

void test('directory versions detect nested skill creation and reject reusable link fingerprints', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-catalog-version-'));
  try {
    const catalog = path.join(root, 'skills');
    const missing = await directoryVersion(catalog, 'SKILL.md');
    await mkdir(path.join(catalog, 'draft'), { recursive: true });
    const initial = await directoryVersion(catalog, 'SKILL.md'); assert.ok(initial); assert.notEqual(initial, missing);
    await writeFile(path.join(catalog, 'draft/SKILL.md'), 'entry');
    const published = await directoryVersion(catalog, 'SKILL.md'); assert.ok(published); assert.notEqual(published, initial);
    assert.equal(await directoryVersion(catalog, 'SKILL.md'), published);
    await link(path.join(catalog, 'draft/SKILL.md'), path.join(root, 'linked.md'));
    assert.equal(await directoryVersion(catalog, 'SKILL.md'), undefined);
    await rm(path.join(root, 'linked.md'));
    await mkdir(path.join(catalog, 'alias'));
    await symlink(path.join(catalog, 'draft/SKILL.md'), path.join(catalog, 'alias/SKILL.md'));
    assert.equal(await directoryVersion(catalog, 'SKILL.md'), undefined);
    await assert.rejects(directoryVersion(catalog, '../SKILL.md'), /filename/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test('SDK workspace metadata checks avoid container startup and still enforce current scope and cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-catalog-version-'));
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'Agent', resources: { executionEnvironment: 'sandbox' } });
  const controller = new AbortController();
  const context: RunContext = { runId: RunIdSchema.parse('run'), turnId: 'turn', principal: { platform: 'qq', sessionType: 'private', sessionId: SessionIdSchema.parse('room'), senderId: 'alice' }, agentId: agent.id, generation: 0, configRevision: 1, flowRevision: 1, runtimeState: 'operator', effectiveCapabilities: ['files.read'], resources: agent.resources, grantVersion: 1, signal: controller.signal, budget: BudgetSchema.parse({}), depth: 0 };
  let authorized = true; let started = 0;
  const backend = new SdkDockerExecutionService({ root, backend: 'sdk_docker', id: 'sandbox' }, () => { if (!authorized) throw new Error('Authorization revoked'); }, () => { started++; return Promise.reject(new Error('Unexpected container startup')); });
  try {
    const workspace = await workspaceDirectory(root, context, 'isolated'); await mkdir(path.join(workspace, '.agent/skill/example'), { recursive: true }); await writeFile(path.join(workspace, '.agent/skill/example/SKILL.md'), 'Version one');
    const first = await backend.directoryVersion(context, '.agent/skill', 'SKILL.md'); assert.ok(first);
    assert.equal(await backend.directoryVersion(context, '/workspace/files/.agent/skill', 'SKILL.md'), first);
    await writeFile(path.join(workspace, '.agent/skill/example/SKILL.md'), 'Version two');
    assert.notEqual(await backend.directoryVersion(context, '.agent/skill', 'SKILL.md'), first);
    assert.equal(started, 0);
    await assert.rejects(backend.directoryVersion({ ...context, resources: { ...context.resources, executionEnvironment: 'unassigned' } }, '.agent/skill', 'SKILL.md'), /not assigned/);
    authorized = false; await assert.rejects(backend.directoryVersion(context, '.agent/skill', 'SKILL.md'), /revoked/);
    authorized = true; controller.abort(); await assert.rejects(backend.directoryVersion(context, '.agent/skill', 'SKILL.md'));
    assert.equal(started, 0);
  } finally { backend.stop(); await backend.drain(); await rm(root, { recursive: true, force: true }); }
});
