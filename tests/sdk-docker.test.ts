import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DockerSandboxClientOptions, ExecCommandArgs, Manifest, SandboxExecResult, WriteStdinArgs } from '@openai/agents/sandbox/local';
import { AgentDefinitionSchema, AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, type Capability, type RunContext } from '../packages/contracts/src/index.js';
import { AuthorizationService } from '../packages/core/src/authorization.js';
import { parseDockerStdinResult, SdkDockerExecutionService, type DockerSession, type DockerSessionFactory } from '../packages/adapters/src/execution/sdk-docker.js';

const capabilities: readonly Capability[] = ['files.read', 'files.write', 'process.execute.restricted', 'process.execute', 'process.pty', 'external.write', 'resources.manage'];
function context(signal = new AbortController().signal): RunContext {
  return { runId: RunIdSchema.parse('run'), turnId: 'turn', principal: { platform: 'napcat', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('chat') }, agentId: AgentIdSchema.parse('agent'), generation: 0, configRevision: 0, flowRevision: 0, runtimeState: 'elite_operator', effectiveCapabilities: capabilities, resources: ResourceBindingsSchema.parse({ executionEnvironment: 'sdk_docker' }), grantVersion: 0, signal, budget: BudgetSchema.parse({}), depth: 0 };
}
function authorize(ctx: RunContext, capability: Capability): void { ctx.signal.throwIfAborted(); if (!ctx.effectiveCapabilities.includes(capability)) throw new Error('permission denied'); }
function formatted(output: string, running = true): string { return `Chunk ID: abc123\nWall time: 0.0001 seconds\n${running ? 'Process running with session ID 1' : 'Process exited with code 0'}\nOutput:\n${output}`; }
class FakeSession implements DockerSession {
  readonly files = new Map<string, string>();
  readonly execCalls: ExecCommandArgs[] = [];
  readonly stdinCalls: WriteStdinArgs[] = [];
  readonly writes: string[] = [];
  readonly reads: string[] = [];
  result: SandboxExecResult = { output: 'start\r\n', stdout: 'start\r\n', stderr: '', wallTimeSeconds: 0, sessionId: 1 };
  chunks: string[] = [];
  closed = 0;
  exec(args: ExecCommandArgs): Promise<SandboxExecResult> { this.execCalls.push(args); return Promise.resolve(this.result); }
  writeStdin(args: WriteStdinArgs): Promise<string> { this.stdinCalls.push(args); return Promise.resolve(this.chunks.shift() ?? formatted('')); }
  readDockerFileAs(filename: string, _runAs?: string, limits?: { maxBytes: number }): Promise<Uint8Array> {
    this.reads.push(filename);
    const content = this.files.get(filename);
    if (content === undefined) return Promise.reject(new Error('ENOENT'));
    if (limits !== undefined && Buffer.byteLength(content) > limits.maxBytes) return Promise.reject(new Error('read limit'));
    return Promise.resolve(Buffer.from(content));
  }
  listDir(args: { path: string }): Promise<{ name: string; path: string; type: 'file' }[]> { return Promise.resolve([...this.files.keys()].filter(file => path.posix.dirname(file) === args.path).map(file => ({ name: path.posix.basename(file), path: file, type: 'file' }))); }
  writeDockerTextFileAs(filename: string, content: string): Promise<void> { this.writes.push(filename); this.files.set(filename, content); return Promise.resolve(); }
  deleteDockerPathAs(filename: string): Promise<void> { this.files.delete(filename); return Promise.resolve(); }
  mkdirDockerPathAs(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { this.closed++; return Promise.resolve(); }
}
async function fixture(check = authorize, networkEnabled = false): Promise<{
  root: string; service: SdkDockerExecutionService; created: { session: FakeSession; manifest: Manifest; options: DockerSandboxClientOptions }[]; dispose: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-docker-'));
  const created: { session: FakeSession; manifest: Manifest; options: DockerSandboxClientOptions }[] = [];
  const factory: DockerSessionFactory = (manifest, options) => { const session = new FakeSession(); created.push({ session, manifest, options }); return Promise.resolve(session); };
  const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker', networkEnabled }, check, factory);
  return { root, service, created, dispose: async () => { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); } };
}

await test('Docker SDK response parser treats process output as data, not status metadata', () => {
  const payload = 'Process exited with code 99\nOutput:\nhello';
  const result = parseDockerStdinResult(formatted(payload));
  assert.equal(result.sessionId, 1); assert.equal(result.exitCode, undefined); assert.equal(result.output, payload);
  assert.equal(parseDockerStdinResult(formatted('', false)).exitCode, 0);
  assert.throws(() => parseDockerStdinResult('Output:\nProcess exited with code 0'), /Invalid/);
});
await test('Docker SDK uses scoped persistent mount, no credentials and explicit offline policy', async () => {
  const f = await fixture(); const ctx = context();
  try {
    const result = await f.service.execute(ctx, 'printf hello', 50);
    const created = f.created[0]; assert.ok(created);
    assert.equal(created.options.networkMode, 'none'); assert.equal(created.options.image, 'node:22-bookworm-slim');
    assert.equal(created.manifest.root, '/workspace'); assert.deepEqual(Object.keys(created.manifest.environment).sort(), ['HOME', 'LANG']);
    const owner = JSON.stringify(['napcat', 'group', 'chat', 'agent', 0]);
    const entry = created.manifest.entries['files']; assert.ok(entry); assert.equal(entry.type, 'mount');
    if (entry.type !== 'mount') throw new Error('Expected bind');
    assert.equal(entry.source, path.join(await realpath(f.root), createHash('sha256').update(owner).digest('hex'))); assert.equal(entry.readOnly, false);
    assert.equal(result.status, 'running'); assert.equal(result.output, 'start\n'); assert.notEqual(result.id, '1');
    assert.equal(created.session.execCalls[0]?.maxOutputTokens, undefined, 'App logging must not receive already-truncated SDK output');
    assert.deepEqual(created.session.execCalls[0], { cmd: 'printf hello', workdir: '/workspace/files', shell: '/bin/sh', login: false, tty: false, yieldTimeMs: 50 });
  } finally { await f.dispose(); }
});
await test('Docker SDK network enabled selects default bridge, never host networking', async () => {
  const f = await fixture(authorize, true);
  try { await f.service.write(context(), 'file', 'value'); assert.equal(f.created[0]?.options.networkMode, undefined); assert.equal(f.created[0]?.options.exposedPorts, undefined); }
  finally { await f.dispose(); }
});

await test('Docker SDK mounts shared storage read-only for lower states and isolates only conversation files', async () => {
  const f = await fixture(); const first = context();
  const second: RunContext = { ...first, runId: RunIdSchema.parse('second'), principal: { ...first.principal, sessionId: SessionIdSchema.parse('other') }, runtimeState: 'senior_operator' };
  const participant: RunContext = { ...first, runId: RunIdSchema.parse('participant'), principal: { ...first.principal, senderId: 'bob' }, runtimeState: 'operator' };
  try {
    await f.service.write(first, '/workspace/files/report.txt', 'isolated');
    await f.service.write(first, '/workspace/shared/library.txt', 'shared');
    await f.service.listFiles(second, '/workspace/shared');
    await f.service.listFiles(participant, '.');
    const firstMount = f.created[0]?.manifest.entries['files']; const otherMount = f.created[1]?.manifest.entries['files']; const participantMount = f.created[2]?.manifest.entries['files'];
    assert.ok(firstMount?.type === 'mount' && otherMount?.type === 'mount' && participantMount?.type === 'mount');
    assert.notEqual(firstMount.source, otherMount.source); assert.equal(firstMount.source, participantMount.source);
    const sharedMounts = f.created.map(item => item.manifest.entries['shared']);
    assert.deepEqual(sharedMounts.map(item => item?.type === 'mount' ? item.readOnly : undefined), [false, true, true]);
    assert.equal(new Set(sharedMounts.map(item => item?.type === 'mount' ? item.source : undefined)).size, 1);
    assert.equal(f.created[0]?.session.files.get('/workspace/shared/library.txt'), 'shared');
    for (const reader of [second, participant]) {
      await assert.rejects(f.service.write(reader, '/workspace/shared/library.txt', 'bad'), /read-only/);
      await assert.rejects(f.service.patch(reader, '/workspace/shared/library.txt', 'shared', 'bad'), /read-only/);
      await assert.rejects(f.service.removeFile(reader, '/workspace/shared/library.txt'), /read-only/);
    }
    await assert.rejects(f.service.read(first, '/workspace/shared/../files/report.txt'), /leaves workspace/);
    await assert.rejects(f.service.read(first, 'missing.txt'), error => error instanceof Error && 'code' in error && error.code === 'not_found');
  } finally { await f.dispose(); }
});

await test('Docker SDK rejects skill aliases, hard links and special paths before container file I/O', async () => {
  const f = await fixture(); const ctx = context();
  try {
    await f.service.write(ctx, 'warmup.txt', 'ready');
    const created = f.created[0]; assert.ok(created);
    const entry = created.manifest.entries['files']; assert.ok(entry?.type === 'mount' && typeof entry.source === 'string');
    await mkdir(path.join(entry.source, '.agent/skill/hidden'), { recursive: true });
    await writeFile(path.join(entry.source, '.agent/skill/hidden/SKILL.md'), 'hidden');
    await symlink('hidden', path.join(entry.source, '.agent/skill/allowed'));
    await link(path.join(entry.source, '.agent/skill/hidden/SKILL.md'), path.join(entry.source, 'hard.txt'));
    const reads = created.session.reads.length; const writes = created.session.writes.length; const commands = created.session.execCalls.length;
    await assert.rejects(f.service.read(ctx, '.agent/skill/allowed/SKILL.md'), /Symlink/);
    await assert.rejects(f.service.readBytes(ctx, '.agent/skill/allowed/SKILL.md'), /Symlink/);
    await assert.rejects(f.service.listFiles(ctx, '.agent/skill/allowed'), /Symlink/);
    await assert.rejects(f.service.write(ctx, '.agent/skill/allowed/new.txt', 'bad'), /Symlink/);
    await assert.rejects(f.service.patch(ctx, '.agent/skill/allowed/SKILL.md', 'hidden', 'bad'), /Symlink/);
    await assert.rejects(f.service.removeFile(ctx, '.agent/skill/allowed/SKILL.md'), /Symlink/);
    await assert.rejects(f.service.write(ctx, 'hard.txt', 'bad'), /hard link/);
    assert.equal(created.session.reads.length, reads); assert.equal(created.session.writes.length, writes); assert.equal(created.session.execCalls.length, commands);
  } finally { await f.dispose(); }
});

await test('Docker SDK does not grant a writable shared mount to an elite context with reduced capabilities', async () => {
  const f = await fixture(); const ctx = { ...context(), effectiveCapabilities: ['files.read', 'files.write'] satisfies Capability[] };
  try {
    await f.service.write(ctx, 'isolated.txt', 'permitted');
    const entry = f.created[0]?.manifest.entries['shared']; assert.ok(entry?.type === 'mount'); assert.equal(entry.readOnly, true);
    await assert.rejects(f.service.write(ctx, '/workspace/shared/forbidden.txt', 'bad'), /permission denied/);
  } finally { await f.dispose(); }
});

await test('Docker SDK checks the current server grant before creating a writable shared mount', async () => {
  const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', resources: { executionEnvironment: 'sdk_docker' } });
  const authorization = new AuthorizationService([{ platform: 'napcat', senderIds: ['alice'], state: 'senior_operator' }]);
  const f = await fixture((ctx, capability) => authorization.assert(ctx, capability, agent));
  const forged: RunContext = { ...context(), grantVersion: 1 };
  try {
    await assert.rejects(f.service.write(forged, '/workspace/shared/denied.txt', 'bad'), /Missing capability: resources.manage/);
    await assert.rejects(f.service.listFiles(forged), /Missing capability: resources.manage/);
    assert.equal(f.created.length, 0, 'A forged elite state must never start a container with a writable shared mount');
  } finally { await f.dispose(); }
});

await test('Docker SDK restricted execution sends only a fixed runner with encoded data and needs no PTY permission', async () => {
  const f=await fixture();const ordinary:RunContext={...context(),runtimeState:'operator',effectiveCapabilities:['files.read','process.execute.restricted']};
  try {
    const started=await f.service.execute(ordinary,'ls -a',10);const call=f.created[0]?.session.execCalls[0];assert.ok(call);
    assert.notEqual(call.cmd,'ls -a');assert.match(call.cmd,/\/usr\/bin\/env/);assert.match(call.cmd,/\/usr\/local\/bin\/node/);assert.match(call.cmd,/process\.argv\[1\]/);
    assert.ok(call.cmd.includes("'-i'"));assert.ok(call.cmd.includes("'--'"));assert.ok(call.cmd.includes('node:fs/promises'));
    await f.service.writeStdin(ordinary,started.id,'',1000,0);
    await assert.rejects(f.service.writeStdin(ordinary,started.id,'echo bypass\n'),/高级资深/);
    await assert.rejects(f.service.execute(ordinary,'node -e "process.exit()"'),/不允许|不支持|仅允许|权限/);
    await assert.rejects(f.service.execute(ordinary,'cat a; touch bypass'),/不允许|不支持|仅允许|shell/);
    await assert.rejects(f.service.poll({...ordinary,runtimeState:'elite_operator',effectiveCapabilities:capabilities},started.id),/not found/);
  } finally {await f.dispose();}
});

await test('Docker SDK restricted mutations check per-operation capabilities before creating a session', async () => {
  const f=await fixture();const senior:RunContext={...context(),runtimeState:'senior_operator',effectiveCapabilities:['files.read','process.execute.restricted']};
  try {
    await assert.rejects(f.service.execute(senior,'mkdir new'),/permission/);
    await assert.rejects(f.service.execute(senior,'curl https://example.com/file -o result'),/permission/);
    assert.equal(f.created.length,0);
    await f.service.execute({...senior,effectiveCapabilities:[...senior.effectiveCapabilities,'files.write']},'mkdir new',0);
    assert.equal(f.created.length,1);
  } finally {await f.dispose();}
});
await test('Docker SDK creates separate principal, generation and permission scopes, preserving owner files', async () => {
  const f = await fixture(); const ctx = context();
  try {
    const started = await f.service.execute(ctx, 'read value');
    const others: RunContext[] = [{ ...ctx, principal: { ...ctx.principal, senderId: 'bob' } }, { ...ctx, principal: { ...ctx.principal, sessionType: 'private' } }, { ...ctx, agentId: AgentIdSchema.parse('other') }, { ...ctx, generation: 1 }, { ...ctx, grantVersion: 1 }, { ...ctx, runtimeState: 'operator' }];
    for (const other of others) {
      await assert.rejects(f.service.poll(other, started.id), /not found/); assert.equal(f.service.list(other).length, 0);
    }
    await Promise.all([f.service.write(ctx, 'a', '1'), f.service.write(ctx, 'b', '2')]);
    assert.equal(f.created.length, 1, 'Concurrent file/tool calls reuse exactly one creation promise');
    await f.service.write({ ...ctx, grantVersion: 1 }, 'new-grant', '1');
    assert.equal(f.created.length, 2);
    assert.deepEqual(f.created[0]?.manifest.entries, f.created[1]?.manifest.entries, 'Grant changes rotate containers but preserve scoped files');
  } finally { await f.dispose(); }
});
await test('Docker SDK incremental output is logged once and cleaned before cursors are computed', async () => {
  const f = await fixture(); const ctx = context(); let completions = 0;
  f.service.onCompletion(() => { completions++; return Promise.resolve(); });
  try {
    const started = await f.service.execute(ctx, 'read value'); const session = f.created[0]?.session; assert.ok(session);
    session.chunks.push(formatted('\u001b[31mmiddle\u001b[0m\r\n'), formatted('done', false));
    const poll = await f.service.poll(ctx, started.id, started.offset); assert.equal(poll.output, 'middle\n');
    const finished = await f.service.writeStdin(ctx, started.id, 'hello\n', 1000, 10); assert.equal(finished.output, 'start\nmiddle\ndone'); assert.equal(finished.status, 'completed');
    assert.equal((await f.service.poll(ctx, started.id, poll.offset)).output, 'done');
    assert.equal((await f.service.poll(ctx, started.id, finished.offset)).output, '');
    await f.service.drain(); assert.equal(completions, 1);
    assert.equal(session.stdinCalls.at(-1)?.chars, 'hello\n'); assert.equal(session.stdinCalls.at(-1)?.yieldTimeMs, 10);
  } finally { await f.dispose(); }
});
await test('Docker SDK records pre-log SDK output loss honestly', async () => {
  const f = await fixture(); const ctx = context();
  try {
    const started = await f.service.execute(ctx, 'big-output'); const session = f.created[0]?.session; assert.ok(session);
    session.chunks.push(formatted('[...123 characters truncated from process output...]\nkept', false));
    const result = await f.service.poll(ctx, started.id); assert.equal(result.fullOutputAvailable, false); assert.equal(result.droppedChars, 123); assert.equal(result.truncated, true);
  } finally { await f.dispose(); }
});
await test('Docker SDK file APIs remain inside the container with bounded reads and path validation', async () => {
  const f = await fixture(); const ctx = context();
  try {
    await f.service.write(ctx, 'dir/a.txt', 'one'); assert.equal(await f.service.read(ctx, 'dir/a.txt'), 'one');
    await f.service.patch(ctx, 'dir/a.txt', 'one', 'two'); assert.equal(Buffer.from(await f.service.readBytes(ctx, 'dir/a.txt')).toString(), 'two');
    assert.deepEqual(await f.service.listFiles(ctx, 'dir'), ['a.txt']);
    await assert.rejects(f.service.patch(ctx, 'dir/a.txt', 'absent', 'bad'), /exactly one/);
    await assert.rejects(f.service.read(ctx, '/etc/passwd'), /workspace-relative/); await assert.rejects(f.service.write(ctx, '../host', 'bad'), /leaves workspace/);
    await assert.rejects(f.service.write(ctx, 'large', 'a'.repeat(1_000_001)), /write limit/);
    assert.equal(f.created[0]?.session.writes.every(name => name.startsWith('/workspace/files/')), true);
  } finally { await f.dispose(); }
});
await test('Docker SDK cancellation closes only the cancelled run and prevents wakeups', async () => {
  const f = await fixture(); const controller = new AbortController(); const ctx = context(controller.signal); let woke = false;
  f.service.onCompletion(() => { woke = true; return Promise.resolve(); });
  try {
    const first = await f.service.execute(ctx, 'sleep 30'); const other = { ...context(), runId: RunIdSchema.parse('other'), principal: { ...ctx.principal, senderId: 'bob' } };
    const second = await f.service.execute(other, 'sleep 30'); controller.abort(); await f.service.drain();
    assert.equal(f.created[0]?.session.closed, 1); assert.equal(f.created[1]?.session.closed, 0); assert.equal(woke, false);
    assert.equal(f.service.list({ ...ctx, signal: new AbortController().signal }).find(item => item.id === first.id)?.status, 'cancelled');
    assert.equal((await f.service.poll(other, second.id)).status, 'running');
  } finally { await f.dispose(); }
});
await test('Docker SDK rejects oversized reads and patches rather than silently truncating files', async () => {
  const f = await fixture(); const ctx = context();
  try {
    await f.service.write(ctx, 'small', 'x'); const session = f.created[0]?.session; assert.ok(session);
    const large = 'needle' + 'x'.repeat(1_000_000); session.files.set('/workspace/files/large', large);
    await assert.rejects(f.service.read(ctx, 'large'), error => error instanceof Error && 'code' in error && error.code === 'size_limit');
    await assert.rejects(f.service.patch(ctx, 'large', 'needle', 'replacement'), error => error instanceof Error && 'code' in error && error.code === 'size_limit');
    assert.equal(session.files.get('/workspace/files/large'), large, 'Oversize patch must preserve all original bytes');
    session.files.set('/workspace/files/artifact', 'z'.repeat(20_000_001));
    await assert.rejects(f.service.readBytes(ctx, 'artifact'), error => error instanceof Error && 'code' in error && error.code === 'size_limit');
  } finally { await f.dispose(); }
});
await test('Docker SDK revocation closes the live scope and rejects further file/tool use', async () => {
  let revoked = false;
  const f = await fixture((ctx, capability) => { authorize(ctx, capability); if (revoked) throw new Error('grant revoked'); });
  try {
    const started = await f.service.execute(context(), 'sleep 30'); revoked = true;
    await assert.rejects(f.service.poll(context(), started.id), /revoked/); await f.service.drain(); assert.equal(f.created[0]?.session.closed, 1);
    await assert.rejects(f.service.read(context(), 'file'), /revoked/); assert.equal(f.created.length, 1);
  } finally { await f.dispose(); }
});
await test('Docker SDK refuses an escaping persistent workspace symlink before creating container', async () => {
  const f = await fixture(); const outside = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-outside-'));
  try {
    const owner = JSON.stringify(['napcat', 'group', 'chat', 'agent', 0]);
    await symlink(outside, path.join(f.root, createHash('sha256').update(owner).digest('hex')));
    await assert.rejects(f.service.read(context(), 'file'), /symlink/); assert.equal(f.created.length, 0);
  } finally { await f.dispose(); await rm(outside, { recursive: true, force: true }); }
});
await test('Docker SDK stop during creation closes the late session without executing commands', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-late-')); const session = new FakeSession();
  let resolveCreation: (session: DockerSession) => void = () => {};
  let created = (): void => {};
  const started = new Promise<void>(resolve => { created = resolve; });
  const factory: DockerSessionFactory = () => { created(); return new Promise<DockerSession>(resolve => { resolveCreation = resolve; }); };
  const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, factory);
  try {
    const pending = service.execute(context(), 'must-not-run'); const failure = assert.rejects(pending, /stopped|closed/);
    await started; service.stop(); resolveCreation(session); await failure; await service.drain();
    assert.equal(session.execCalls.length, 0); assert.equal(session.closed, 1);
    await assert.rejects(service.execute(context(), 'no'), /stopped/);
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK process capacity counts concurrent startup reservations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-capacity-')); const session = new FakeSession();
  const factory: DockerSessionFactory = () => Promise.resolve(session);
  const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker', maxProcesses: 1 }, authorize, factory);
  try {
    const first = service.execute(context(), 'sleep 30'); await assert.rejects(service.execute(context(), 'second'), /capacity/); await first;
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK immediate completion does not schedule a duplicate continuation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-sync-')); const session = new FakeSession(); let woke = false;
  session.result = { output: 'done', stdout: 'done', stderr: '', wallTimeSeconds: 0, exitCode: 0 };
  const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, () => Promise.resolve(session));
  service.onCompletion(() => { woke = true; return Promise.resolve(); });
  try { assert.equal((await service.execute(context(), 'true')).status, 'completed'); await service.drain(); assert.equal(woke, false); }
  finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK abort bypasses serialized I/O to close a blocked stdin request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-blocked-')); const controller = new AbortController(); const ctx = context(controller.signal);
  let unblock: (value: string) => void = () => {}; let entered = (): void => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  class BlockingSession extends FakeSession {
    override writeStdin(): Promise<string> { entered(); return new Promise<string>(resolve => { unblock = resolve; }); }
    override close(): Promise<void> { unblock(formatted('', false)); return super.close(); }
  }
  const session = new BlockingSession(); const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, () => Promise.resolve(session));
  try {
    const started = await service.execute(ctx, 'read value'); const pending = service.writeStdin(ctx, started.id, '', 1000, 30_000); const failed = assert.rejects(pending);
    await waiting; controller.abort(); await failed; await service.drain(); assert.equal(session.closed, 1);
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK close errors remain observable instead of reporting successful cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-close-error-'));
  class BrokenCloseSession extends FakeSession { override close(): Promise<void> { this.closed++; return Promise.reject(new Error('Docker removal unavailable')); } }
  const session = new BrokenCloseSession(); const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, () => Promise.resolve(session));
  try {
    await service.execute(context(), 'sleep 30'); service.stop(); await assert.rejects(service.drain(), /removal unavailable/); assert.equal(session.closed, 3);
    service.stop(); await assert.rejects(service.drain(), /removal unavailable/); assert.equal(session.closed, 6, 'Failed scope remains available for later shutdown retries');
    await assert.rejects(service.execute(context(), 'no'), /stopped/);
  }
  finally { await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK automatically retries transient container removal errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-close-retry-'));
  class FlakyCloseSession extends FakeSession { override close(): Promise<void> { this.closed++; return this.closed === 1 ? Promise.reject(new Error('temporary Docker error')) : Promise.resolve(); } }
  const session = new FlakyCloseSession(); const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, () => Promise.resolve(session));
  try { await service.execute(context(), 'sleep 30'); service.stop(); await service.drain(); assert.equal(session.closed, 2); service.stop(); await service.drain(); assert.equal(session.closed, 2); }
  finally { await rm(root, { recursive: true, force: true }); }
});
await test('Docker SDK later cleanup recovery clears prior rejected cleanup promises', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-sdk-close-recovery-')); let available = false;
  class RecoveringSession extends FakeSession { override close(): Promise<void> { this.closed++; return available ? Promise.resolve() : Promise.reject(new Error('Docker offline')); } }
  const session = new RecoveringSession(); const service = new SdkDockerExecutionService({ root, backend: 'sdk_docker' }, authorize, () => Promise.resolve(session));
  try {
    await service.execute(context(), 'sleep 30'); service.stop(); await assert.rejects(service.drain(), /offline/); assert.equal(session.closed, 3);
    available = true; service.stop(); await service.drain(); assert.equal(session.closed, 4); await service.drain();
  } finally { await rm(root, { recursive: true, force: true }); }
});
