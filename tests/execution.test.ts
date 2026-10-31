import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile, stat, link } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, type Capability, type RunContext } from '../packages/contracts/src/index.js';
import { ExecutionService, type ProcessSnapshot } from '../packages/adapters/src/execution/environment.js';
const capabilities: readonly Capability[] = ['files.read', 'files.write', 'process.execute.restricted', 'process.execute', 'process.pty', 'external.write', 'resources.manage'];
function context(signal = new AbortController().signal): RunContext { return { runId: RunIdSchema.parse('run'), turnId: 'turn', principal: { platform: 'telegram', senderId: 'alice', sessionId: SessionIdSchema.parse('chat') }, agentId: AgentIdSchema.parse('agent'), generation: 0, configRevision: 0, flowRevision: 0, runtimeState: 'elite_operator', effectiveCapabilities: capabilities, resources: ResourceBindingsSchema.parse({ executionEnvironment: 'local' }), grantVersion: 0, signal, budget: BudgetSchema.parse({}), depth: 0 }; }
function authorize(ctx: RunContext, capability: Capability): void { ctx.signal.throwIfAborted(); if (!ctx.effectiveCapabilities.includes(capability)) throw new Error('permission denied'); }
async function waitFor(service: ExecutionService, ctx: RunContext, id: string, predicate: (snapshot: ProcessSnapshot) => boolean, timeoutMs = 5000): Promise<ProcessSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const snapshot = service.poll(ctx, id); if (predicate(snapshot)) return snapshot; if (Date.now() > deadline) throw new Error(`Process did not reach expected state: ${snapshot.status}`); await new Promise<void>(resolve => setTimeout(resolve, 20)); }
}
await test('Execution files reject missing permissions, traversal, absolute paths and escaping symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-exec-')); const outside = await mkdtemp(path.join(tmpdir(), 'priestess-outside-'));
  const service = new ExecutionService({ root, backend: 'local' }, authorize); const ctx = context();
  try {
    await assert.rejects(service.write({ ...ctx, effectiveCapabilities: ['files.read'] }, 'file.txt', 'denied'), /permission/);
    await service.write(ctx, 'safe/file.txt', 'first'); assert.equal(await service.read(ctx, 'safe/file.txt'), 'first');
    await service.patch(ctx, 'safe/file.txt', 'first', 'second'); assert.equal(await service.read(ctx, 'safe/file.txt'), 'second');
    await assert.rejects(service.patch(ctx, 'safe/file.txt', 'absent', 'new'), /exactly one/);
    await assert.rejects(service.write(ctx, '../escape.txt', 'denied'), /leaves workspace/); await assert.rejects(service.read(ctx, '/etc/passwd'), /workspace-relative/);
    await writeFile(path.join(outside, 'secret.txt'), 'outside'); const workspace = (await readdir(root))[0]; assert.ok(workspace);
    await symlink(outside, path.join(root, workspace, 'escape'));
    await assert.rejects(service.read(ctx, 'escape/secret.txt'), /Symlink/); await assert.rejects(service.write(ctx, 'escape/secret.txt', 'overwrite'), /Symlink/);
    assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'outside');
    await assert.rejects(service.write(ctx, 'large.txt', 'x'.repeat(1_000_001)), /write limit/);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
await test('Execution writes recheck authorization before publication', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-exec-revoke-')); let writes = 0;
  const service = new ExecutionService({ root, backend: 'local' }, (ctx, capability) => { authorize(ctx, capability); if (capability === 'files.write' && ++writes > 1) throw new Error('grant revoked'); });
  try { await assert.rejects(service.write(context(), 'secret.txt', 'never published'), /revoked/); await assert.rejects(service.read(context(), 'secret.txt'), /not found/); }
  finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});
await test('File zones share within a conversation and keep other conversations and reset generations separate', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-zones-')); const service = new ExecutionService({ root, backend: 'local' }, authorize);
  const first = context(); const participant = { ...first, principal: { ...first.principal, senderId: 'bob' } };
  const other = { ...first, principal: { ...first.principal, sessionId: SessionIdSchema.parse('other') } };
  try {
    await service.write(first, '/workspace/files/note.txt', 'isolated');
    assert.equal(await service.read(participant, 'note.txt'), 'isolated');
    await assert.rejects(service.read(other, 'note.txt'), /not found/);
    await assert.rejects(service.read({ ...first, generation: 1 }, 'note.txt'), /not found/);
    await service.write(first, '/workspace/shared/library.txt', 'shared');
    for (const role of ['operator', 'senior_operator'] as const) {
      const reader: RunContext = { ...other, runtimeState: role };
      assert.equal(await service.read(reader, '/workspace/shared/library.txt'), 'shared');
      assert.deepEqual(await service.listFiles(reader, '/workspace/shared'), ['library.txt']);
      await assert.rejects(service.write(reader, '/workspace/shared/library.txt', 'denied'), /read-only/);
      await assert.rejects(service.patch(reader, '/workspace/shared/library.txt', 'shared', 'denied'), /read-only/);
      await assert.rejects(service.removeFile(reader, '/workspace/shared/library.txt'), /read-only/);
    }
    assert.equal(await service.read(first, '/workspace/shared/library.txt'), 'shared');
    await assert.rejects(service.read(first, '/workspace/shared/../files/note.txt'), /leaves workspace/);
    await service.write(first, 'delete.txt', 'temporary'); await service.removeFile(first, 'delete.txt');
    await assert.rejects(service.read(first, 'delete.txt'), /not found/);
    await assert.rejects(service.removeFile(first, '/workspace/shared'), /roots cannot/);
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('File zones reject shared symlinks, hard links and non-file deletion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-zone-links-')); const service = new ExecutionService({ root, backend: 'local' }, authorize); const ctx = context();
  try {
    await service.write(ctx, '/workspace/shared/original.txt', 'shared');
    await link(path.join(root, 'shared', 'original.txt'), path.join(root, 'shared', 'hard.txt'));
    await assert.rejects(service.removeFile(ctx, '/workspace/shared/hard.txt'), /hard link/);
    await service.write(ctx, 'private.txt', 'private');
    const isolated = (await readdir(root)).find(name => name !== 'shared'); assert.ok(isolated);
    await symlink(path.join(root, 'shared'), path.join(root, isolated, 'alias'));
    await assert.rejects(service.write({ ...ctx, runtimeState: 'senior_operator' }, 'alias/bypass.txt', 'bad'), /Symlink/);
    await assert.rejects(service.removeFile(ctx, 'alias'), /Symlink/);
    assert.equal(await readFile(path.join(root, 'shared', 'original.txt'), 'utf8'), 'shared');
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('Real PTY accepts input and process access is isolated by sender, chat, Agent and generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-pty-')); const service = new ExecutionService({ root, backend: 'local' }, authorize); const ctx = context();
  try {
    const started = await service.execute(ctx, "read value; printf 'received:%s' \"$value\"", 30); assert.equal(started.status, 'running');
    const others = [{ ...ctx, principal: { ...ctx.principal, senderId: 'bob' } }, { ...ctx, principal: { ...ctx.principal, sessionId: SessionIdSchema.parse('other') } }, { ...ctx, agentId: AgentIdSchema.parse('other-agent') }, { ...ctx, generation: 1 }];
    for (const other of others) { assert.throws(() => service.poll(other, started.id), /not found/); assert.throws(() => service.writeStdin(other, started.id, 'bad\n'), /not found/); assert.throws(() => service.kill(other, started.id), /not found/); assert.equal(service.list(other).length, 0); }
    service.writeStdin(ctx, started.id, 'hello\n'); const finished = await waitFor(service, ctx, started.id, result => result.status !== 'running'); assert.equal(finished.status, 'completed'); assert.match(finished.output, /received:hello/);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});
await test('Real PTY cancellation kills work and prevents completion wakeups', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-cancel-')); const service = new ExecutionService({ root, backend: 'local' }, authorize); const controller = new AbortController(); const ctx = context(controller.signal); let woke = false;
  service.onCompletion(() => { woke = true; return Promise.resolve(); });
  try {
    const started = await service.execute(ctx, 'sleep 30', 20); controller.abort();
    assert.equal(service.list({ ...ctx, signal: new AbortController().signal })[0]?.status, 'cancelled');
    await new Promise<void>(resolve => setTimeout(resolve, 100)); assert.equal(woke, false); assert.throws(() => service.poll(ctx, started.id));
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});
await test('Process output is bounded and poll cursors report truncation without duplicates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-output-')); const service = new ExecutionService({ root, backend: 'local' }, authorize); const ctx = context();
  try {
    const started = await service.execute(ctx, "awk 'BEGIN { for (i = 0; i < 200000; i++) printf \"x\" }'", 30);
    const completed = await waitFor(service, ctx, started.id, result => result.status !== 'running'); assert.equal(completed.status, 'completed'); assert.ok(completed.output.length <= 128_000); assert.equal(completed.truncated, true); assert.ok(completed.offset >= 200_000);
    assert.equal(service.poll(ctx, started.id, completed.offset).output, '');
    const last = service.poll(ctx, started.id, completed.offset - 3); assert.equal(last.output, 'xxx'); assert.equal(last.truncated, false);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});
await test('Execution refuses unassigned environments and enforces process capacity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-capacity-')); const service = new ExecutionService({ root, backend: 'local', maxProcesses: 1 }, authorize); const ctx = context();
  try {
    await assert.rejects(service.execute({ ...ctx, resources: { ...ctx.resources, executionEnvironment: 'none' } }, 'true'), /not assigned/);
    const started = await service.execute(ctx, 'sleep 30', 10); await assert.rejects(service.execute(ctx, 'true'), /capacity/); service.kill(ctx, started.id);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});

await test('Restricted roles cannot run local binaries or access higher-state processes', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'priestess-role-process-'));const service=new ExecutionService({root,backend:'local'},authorize);const elite=context();
  const ordinary: RunContext={...elite,runtimeState:'operator',effectiveCapabilities:['process.execute.restricted','files.read']};
  const senior: RunContext={...elite,runtimeState:'senior_operator',effectiveCapabilities:['process.execute.restricted','files.read','files.write','external.write']};
  try {
    await assert.rejects(service.execute(ordinary,'pwd'),/Docker/);
    await assert.rejects(service.execute(senior,'touch safe'),/Docker/);
    const started=await service.execute(elite,'sleep 30',10);
    assert.throws(()=>service.poll(ordinary,started.id),/not found/);
    assert.throws(()=>service.poll({...elite,grantVersion:elite.grantVersion+1},started.id),/not found/);
    assert.throws(()=>service.writeStdin(senior,started.id,'bad'),/高级资深/);
    assert.equal(service.list(ordinary).length,0);
    service.kill(elite,started.id);
  } finally {service.stop();await service.drain();await rm(root,{recursive:true,force:true});}
});

await test('Docker restricted writes use the service UID and remain readable by host file tools', { timeout: 120_000 }, async t => {
  const root=await mkdtemp(path.join(tmpdir(),'priestess-restricted-uid-'));const service=new ExecutionService({root,backend:'docker',dockerImage:process.env['RESTRICTED_TEST_IMAGE'] ?? 'priestess-ts:integration'},authorize);
  const base=context();const elite:RunContext={...base,resources:{...base.resources,executionEnvironment:'docker'}};
  const ordinary:RunContext={...elite,runtimeState:'operator',effectiveCapabilities:['process.execute.restricted','files.read']};
  const senior:RunContext={...elite,runtimeState:'senior_operator',effectiveCapabilities:['process.execute.restricted','files.read','files.write']};
  try{
    if(!await service.available()){t.skip('Docker unavailable');return;}
    await service.write(elite,'input.txt','scoped content');
    const read=await service.execute(ordinary,'cat input.txt',20);assert.match((await waitFor(service,ordinary,read.id,item=>item.status!=='running',30_000)).output,/scoped content/);
    const copy=await service.execute(senior,'cp input.txt output.txt',20);const finished=await waitFor(service,senior,copy.id,item=>item.status!=='running',30_000);assert.equal(finished.status,'completed',finished.output);
    assert.equal(await service.read(senior,'output.txt'),'scoped content');
    const workspace=(await readdir(root)).find(name=>!name.startsWith('.'));assert.ok(workspace);assert.equal((await stat(path.join(root,workspace,'output.txt'))).uid,process.getuid?.());
    assert.equal(service.writeStdin(senior,copy.id,'').status,'completed');
  } finally {service.stop();await service.drain();await rm(root,{recursive:true,force:true});}
});

await test('Docker enforces read-only root, no network and workspace boundary, then removes cancelled container', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-docker-'));
  const service = new ExecutionService({ root, backend: 'docker', dockerImage: 'alpine:3.21' }, authorize);
  const controller = new AbortController(); const base = context(controller.signal); const ctx: RunContext = { ...base, resources: { ...base.resources, executionEnvironment: 'docker' } };
  try {
    if (!await service.available()) { t.skip('Docker daemon unavailable; real isolation is not qualified on this host'); return; }
    await service.write(ctx, 'input.txt', 'workspace-content');
    const check = await service.execute(ctx, 'cat input.txt; printf "\\n"; if touch /forbidden-root-write 2>/dev/null; then printf ROOT_WRITABLE; else printf ROOT_READONLY; fi; printf "\\n"; ls /sys/class/net; printf worker-output > output.txt', 50);
    const completed = await waitFor(service, ctx, check.id, result => result.status !== 'running', 90_000);
    assert.equal(completed.status, 'completed', completed.output); assert.match(completed.output, /workspace-content/); assert.match(completed.output, /ROOT_READONLY/); assert.doesNotMatch(completed.output, /ROOT_WRITABLE/); assert.match(stripVTControlCharacters(completed.output), /\blo\b/); assert.doesNotMatch(completed.output, /eth0/); assert.equal(await service.read(ctx, 'output.txt'), 'worker-output');
    const running = await service.execute(ctx, 'printf CONTAINER_READY; sleep 60', 50);
    await waitFor(service, ctx, running.id, result => result.output.includes('CONTAINER_READY'), 10_000);
    controller.abort(); await service.drain();
    const result = await promisify(execFile)('docker', ['ps', '-a', '--filter', `name=priestess-${running.id}`, '--format', '{{.Names}}'], { timeout: 5000 });
    assert.equal(result.stdout.trim(), '', 'Cancelled container must be removed');
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
