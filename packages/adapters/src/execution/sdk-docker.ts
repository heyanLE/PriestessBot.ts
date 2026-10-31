import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DockerSandboxClient, Manifest } from '@openai/agents/sandbox/local';
import type { DockerSandboxClientOptions, DockerSandboxSession, ExecCommandArgs, SandboxExecResult } from '@openai/agents/sandbox/local';
import { z } from 'zod';
import type { Capability, RunContext } from '../../../contracts/src/index.js';
import type { Authorize, ExecutionBackend, ExecutionConfig, ProcessSnapshot } from './environment.js';
import { compileCommandPolicy } from '../../../core/src/command-policy.js';
import { restrictedRunnerLaunch } from './restricted-runner.js';
import { assertWorkspaceWrite, ISOLATED_WORKSPACE, workspaceDirectory, workspaceEntry, workspaceFailure, WorkspacePathError, workspacePath, type WorkspacePath } from './workspace-zones.js';
import { cleanTerminalOutput, DEFAULT_MAX_OUTPUT_TOKENS, ProcessOutputLog, truncateOutput } from './output.js';

/** The SDK, including file access, owns all interactions with the container. */
export type DockerSession = Pick<DockerSandboxSession, 'exec' | 'writeStdin' | 'readDockerFileAs' | 'listDir' | 'writeDockerTextFileAs' | 'mkdirDockerPathAs' | 'deleteDockerPathAs' | 'close'>;
export type DockerSessionFactory = (manifest: Manifest, options: DockerSandboxClientOptions) => Promise<DockerSession>;
export type SdkDockerErrorCode = 'start_failed' | 'session_not_found' | 'cancelled' | 'capacity' | 'invalid_path' | 'failed';
export class SdkDockerExecutionError extends Error {
  constructor(readonly code: SdkDockerErrorCode, message: string) { super(message); this.name = 'SdkDockerExecutionError'; }
}
const inspectSchema = z.array(z.object({
  HostConfig: z.object({ Privileged: z.boolean(), NetworkMode: z.string(), Memory: z.number(), NanoCpus: z.number(), PidsLimit: z.number().nullable() }),
  Config: z.object({ User: z.string(), ExposedPorts: z.record(z.string(), z.unknown()).nullable().optional() }),
  Mounts: z.array(z.object({ Type: z.string(), Source: z.string(), Destination: z.string(), RW: z.boolean() })),
  State: z.object({ Running: z.boolean() }),
})).length(1);
const docker = promisify(execFile);

/** SDK creation has no resource-limit options. Apply/verify limits before handing it to tools. */
const createSession: DockerSessionFactory = async (manifest, options) => {
  let session: DockerSandboxSession | undefined;
  try {
    session = await new DockerSandboxClient(options).create(manifest);
    const id = session.state.containerId;
    if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid SDK container identity');
    await docker('docker', ['update', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64', id], { timeout: 10_000, maxBuffer: 32_000 });
    const result = await docker('docker', ['inspect', id], { timeout: 10_000, maxBuffer: 256_000 });
    const container = inspectSchema.parse(JSON.parse(result.stdout))[0];
    if (container === undefined || !container.State.Running || container.HostConfig.Privileged || container.HostConfig.Memory !== 536_870_912 || container.HostConfig.NanoCpus !== 1_000_000_000 || container.HostConfig.PidsLimit !== 64) throw new Error('Docker isolation verification failed');
    const expectedNetwork = options.networkMode === 'none' ? 'none' : 'default';
    if (container.HostConfig.NetworkMode !== expectedNetwork && !(expectedNetwork === 'default' && container.HostConfig.NetworkMode === 'bridge')) throw new Error('Unexpected Docker network policy');
    if (!/^[1-9][0-9]*(?::[0-9]+)?$/u.test(container.Config.User) || Object.keys(container.Config.ExposedPorts ?? {}).length > 0) throw new Error('Docker must use a non-root host identity and publish no ports');
    const expected = new Map<string, { source: string; writable: boolean }>([[manifest.root, { source: await realpath(session.state.workspaceRootPath), writable: true }]]);
    for (const mount of manifest.mountTargets()) {
      if (mount.entry.type !== 'mount' || typeof mount.entry.source !== 'string') throw new Error('Unsupported Docker mount');
      expected.set(mount.mountPath, { source: await realpath(mount.entry.source), writable: !(mount.entry.readOnly ?? true) });
    }
    if (container.Mounts.length !== expected.size || container.Mounts.some(mount => mount.Type !== 'bind' || expected.get(mount.Destination)?.writable !== mount.RW || expected.get(mount.Destination)?.source !== mount.Source)) throw new Error('Unexpected Docker filesystem mount');
    return session;
  } catch {
    try { await session?.close(); } catch { throw new SdkDockerExecutionError('start_failed', 'Docker SDK setup failed and container cleanup failed; inspect server Docker state before retrying.'); }
    throw new SdkDockerExecutionError('start_failed', 'Docker SDK setup failed: verify Docker access, image GNU utilities, non-root service identity, and container resource limits.');
  }
};
const WORKSPACE = ISOLATED_WORKSPACE;
const IDLE_MS = 60_000;

interface Scope {
  readonly key: string;
  readonly context: RunContext;
  readonly session: Promise<DockerSession>;
  queue: Promise<void>;
  busy: number;
  closed: boolean;
  closing?: Promise<void>;
  failedClosing?: Promise<void>;
  idle?: ReturnType<typeof setTimeout>;
  removeAbort: () => void;
}
interface ManagedProcess {
  readonly id: string;
  readonly owner: string;
  readonly context: RunContext;
  readonly requiredCapabilities: readonly Capability[];
  readonly scope: Scope;
  readonly log: ProcessOutputLog;
  status: ProcessSnapshot['status'];
  nativeId?: number;
  exitCode?: number;
  timer?: ReturnType<typeof setTimeout>;
  timeout?: ReturnType<typeof setTimeout>;
  sdkDropped: number;
  notified: boolean;
  completionEligible: boolean;
}

/** writeStdin has a text response in SDK 0.21; only parse its fixed header, never process text. */
export function parseDockerStdinResult(value: string): SandboxExecResult {
  const match = /^Chunk ID: [a-zA-Z0-9]+\nWall time: ([0-9.]+) seconds\n(?:Process running with session ID ([0-9]+)|Process exited with code (-?[0-9]+))\n(?:Original token count: ([0-9]+)\n)?Output:\n([\s\S]*)$/u.exec(value);
  if (match === null || match[1] === undefined || match[5] === undefined) throw new Error('Invalid Docker SDK process response');
  const wallTimeSeconds = Number(match[1]);
  const sessionId = match[2] === undefined ? undefined : Number(match[2]);
  const exitCode = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isFinite(wallTimeSeconds) || (sessionId !== undefined && !Number.isSafeInteger(sessionId)) || (exitCode !== undefined && !Number.isSafeInteger(exitCode))) throw new Error('Invalid Docker SDK process status');
  return { output: match[5], stdout: '', stderr: '', wallTimeSeconds, ...(sessionId === undefined ? {} : { sessionId }), ...(exitCode === undefined ? {} : { exitCode }), ...(match[4] === undefined ? {} : { originalTokenCount: Number(match[4]) }) };
}

/** Persistent files are the only host bind; SDK lifecycle owns its disposable root. */
export class SdkDockerExecutionService implements ExecutionBackend {
  private readonly scopes = new Map<string, Scope>();
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly cleanup = new Set<Promise<void>>();
  private completion: ((context: RunContext, result: ProcessSnapshot) => Promise<void>) | undefined;
  private stopped = false;
  private starting = 0;
  constructor(readonly config: ExecutionConfig, private readonly authorize: Authorize, private readonly factory: DockerSessionFactory = createSession) {}
  onCompletion(callback: (context: RunContext, result: ProcessSnapshot) => Promise<void>): void { this.completion = callback; }
  private fileOwner(context: RunContext): string { return JSON.stringify([context.principal.platform, context.principal.sessionType ?? 'private', context.principal.sessionId, context.principal.senderId, context.agentId, context.generation]); }
  private owner(context: RunContext): string { return JSON.stringify([this.fileOwner(context), context.runtimeState, context.grantVersion]); }
  private key(context: RunContext): string { return JSON.stringify([this.owner(context), context.runId]); }
  private check(context: RunContext, capability: Capability): void {
    try {
      if (this.stopped) throw new SdkDockerExecutionError('cancelled', 'Execution service is stopped');
      context.signal.throwIfAborted();
      if (context.resources.executionEnvironment !== (this.config.id ?? this.config.backend)) throw new Error('Execution environment is not assigned');
      this.authorize(context, capability);
    } catch (error) {
      const scope = this.scopes.get(this.key(context));
      if (scope !== undefined) this.track(this.close(scope));
      throw error;
    }
  }
  private track(promise: Promise<void>): void {
    this.cleanup.add(promise);
    void promise.then(() => this.cleanup.delete(promise), () => { /* drain reports cleanup errors. */ });
  }
  private scope(context: RunContext, capability: Capability): Scope {
    this.check(context, capability);
    const key = this.key(context);
    const existing = this.scopes.get(key);
    if (existing !== undefined) {
      if (existing.closed) throw new Error('Execution session is closing');
      return existing;
    }
    if (this.scopes.size >= (this.config.maxProcesses ?? 8) * 2) throw new SdkDockerExecutionError('capacity', 'Docker session capacity exceeded');
    const sharedWritable = context.runtimeState === 'elite_operator' && context.effectiveCapabilities.includes('resources.manage');
    const session = Promise.all([workspaceDirectory(this.config.root, context, 'isolated'), workspaceDirectory(this.config.root, context, 'shared')]).then(([directory, shared]) => {
      this.check(context, capability);
      if (sharedWritable) this.check(context, 'resources.manage');
      return this.factory(new Manifest({ root: '/workspace', entries: { files: { type: 'mount', source: directory, mountStrategy: { type: 'local_bind' }, readOnly: false }, shared: { type: 'mount', source: shared, mountStrategy: { type: 'local_bind' }, readOnly: !sharedWritable } }, environment: { HOME: WORKSPACE, LANG: 'C.UTF-8' } }), {
        image: this.config.dockerImage ?? 'node:22-bookworm-slim',
        ...(this.config.networkEnabled === true ? {} : { networkMode: 'none' }),
        labels: { 'priestess.execution': 'sdk-docker', 'priestess.owner': createHash('sha256').update(key).digest('hex') },
      });
    });
    const scope: Scope = { key, context, session, queue: Promise.resolve(), busy: 0, closed: false, removeAbort: () => {} };
    const cancel = (): void => { this.track(this.close(scope)); };
    scope.removeAbort = () => context.signal.removeEventListener('abort', cancel);
    this.scopes.set(key, scope);
    context.signal.addEventListener('abort', cancel, { once: true });
    void session.catch(() => { scope.closed = true; scope.removeAbort(); if (this.scopes.get(key) === scope) this.scopes.delete(key); });
    if (context.signal.aborted) cancel();
    return scope;
  }
  private async use<T>(scope: Scope, context: RunContext, capability: Capability, action: (session: DockerSession) => Promise<T>): Promise<T> {
    const previous = scope.queue;
    let release = (): void => {};
    scope.queue = new Promise<void>(resolve => { release = resolve; });
    scope.busy++;
    if (scope.idle !== undefined) clearTimeout(scope.idle);
    await previous;
    try {
      this.check(context, capability);
      if (scope.closed) throw new Error('Execution session is closed');
      const session = await scope.session;
      this.check(context, capability);
      if (scope.closed) throw new Error('Execution session is closed');
      const result = await action(session);
      this.check(context, capability);
      return result;
    } finally { scope.busy--; release(); this.scheduleIdle(scope); }
  }
  private scheduleIdle(scope: Scope): void {
    if (scope.closed || scope.busy > 0 || [...this.processes.values()].some(item => item.scope === scope && item.status === 'running')) return;
    if (scope.idle !== undefined) clearTimeout(scope.idle);
    scope.idle = setTimeout(() => { this.track(this.close(scope)); }, IDLE_MS);
    scope.idle.unref();
  }
  private file(name: string): WorkspacePath { return workspacePath(name); }
  private async fileAction<T>(context: RunContext, target: WorkspacePath, action: () => Promise<T>, writing = false): Promise<T> {
    try {
      await workspaceEntry(this.config.root, context, target);
      if (writing) { this.check(context, 'files.write'); this.checkWrite(context, target); }
      const result = await action();
      if (writing) { this.check(context, 'files.write'); this.checkWrite(context, target); }
      await workspaceEntry(this.config.root, context, target);
      return result;
    } catch (error) { throw workspaceFailure(error); }
  }
  private checkWrite(context: RunContext, target: WorkspacePath): void {
    assertWorkspaceWrite(context, target);
    if (target.zone === 'shared') this.check(context, 'resources.manage');
  }
  async read(context: RunContext, name: string): Promise<string> {
    const target = this.file(name);
    return this.use(this.scope(context, 'files.read'), context, 'files.read', session => this.fileAction(context, target, async () => Buffer.from(await session.readDockerFileAs(target.absolute, undefined, { maxBytes: 1_000_000 })).toString('utf8')));
  }
  async readBytes(context: RunContext, name: string): Promise<Uint8Array> {
    const target = this.file(name);
    return this.use(this.scope(context, 'files.read'), context, 'files.read', session => this.fileAction(context, target, () => session.readDockerFileAs(target.absolute, undefined, { maxBytes: 20_000_000 })));
  }
  async listFiles(context: RunContext, name = '.'): Promise<string[]> {
    const target = this.file(name);
    return this.use(this.scope(context, 'files.read'), context, 'files.read', session => this.fileAction(context, target, async () => (await session.listDir({ path: target.absolute })).slice(0, 500).map(entry => entry.name)));
  }
  async write(context: RunContext, name: string, content: string): Promise<void> {
    if (Buffer.byteLength(content) > 1_000_000) throw new WorkspacePathError('size_limit', 'File exceeds the 1000000 byte write limit.');
    const target = this.file(name); this.checkWrite(context, target);
    return this.use(this.scope(context, 'files.write'), context, 'files.write', async session => {
      this.check(context, 'files.write'); this.checkWrite(context, target);
      await this.fileAction(context, target, () => session.writeDockerTextFileAs(target.absolute, content), true);
    });
  }
  async patch(context: RunContext, name: string, oldText: string, newText: string): Promise<void> {
    const target = this.file(name); this.checkWrite(context, target);
    this.check(context, 'files.read');
    return this.use(this.scope(context, 'files.write'), context, 'files.write', async session => {
      this.check(context, 'files.read');
      const content = await this.fileAction(context, target, async () => Buffer.from(await session.readDockerFileAs(target.absolute, undefined, { maxBytes: 1_000_000 })).toString('utf8'));
      if (!oldText || content.split(oldText).length !== 2) throw new WorkspacePathError('patch_mismatch', 'Patch must match exactly one location. Read the file and use a unique non-empty oldText value.');
      const replacement = content.replace(oldText, newText);
      if (Buffer.byteLength(replacement) > 1_000_000) throw new WorkspacePathError('size_limit', 'File exceeds the 1000000 byte write limit.');
      this.check(context, 'files.write'); this.checkWrite(context, target);
      await this.fileAction(context, target, () => session.writeDockerTextFileAs(target.absolute, replacement), true);
    });
  }
  async removeFile(context: RunContext, name: string): Promise<void> {
    const target = this.file(name); this.checkWrite(context, target);
    if (!target.relative) throw new WorkspacePathError('invalid_path', 'Workspace roots cannot be removed. Specify a regular file.');
    return this.use(this.scope(context, 'files.write'), context, 'files.write', async session => {
      // This fixed check is file I/O, not a model-supplied command. Never follow a leaf symlink.
      const quoted = "'" + target.absolute.replaceAll("'", "'\"'\"'") + "'";
      const result = await this.fileAction(context, target, () => session.exec({ cmd: `test ! -L ${quoted} && test -f ${quoted} && test "$(stat -c %h -- ${quoted})" = 1`, workdir: WORKSPACE, shell: '/bin/sh', login: false, tty: false, yieldTimeMs: 30_000 }));
      if (result.exitCode !== 0 || result.sessionId !== undefined) throw new WorkspacePathError('invalid_path', 'Only an existing regular file can be removed. Directories, symlinks and hard links are unavailable.');
      this.check(context, 'files.write'); this.checkWrite(context, target);
      await this.fileAction(context, target, () => session.deleteDockerPathAs(target.absolute), true);
    });
  }
  async execute(context: RunContext, command: string, yieldMs = 1000, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): Promise<ProcessSnapshot> {
    this.check(context, 'process.execute.restricted');
    const plan = compileCommandPolicy(command, context.runtimeState);
    for (const capability of plan.requiredCapabilities) this.check(context, capability);
    if ([...this.processes.values()].filter(item => item.status === 'running').length + this.starting >= (this.config.maxProcesses ?? 8)) throw new SdkDockerExecutionError('capacity', 'Process capacity exceeded');
    this.starting++;
    let item: ManagedProcess | undefined;
    try {
      const scope = this.scope(context, 'process.execute.restricted');
      const id = randomUUID();
      const log = await ProcessOutputLog.create(path.join(this.config.root, '.process-logs'), id);
      item = { id, owner: this.owner(context), context, requiredCapabilities: plan.requiredCapabilities, scope, log, status: 'running', sdkDropped: 0, notified: false, completionEligible: false };
      this.processes.set(id, item);
      this.starting--;
      const managed = item;
      managed.timeout = setTimeout(() => { this.track(this.close(scope)); }, context.budget.timeoutMs);
      managed.timeout.unref();
      const launch = plan.mode === 'restricted' ? restrictedRunnerLaunch(plan.operation, WORKSPACE, this.config.networkEnabled === true) : undefined;
      const args: ExecCommandArgs = { cmd: launch?.shellCommand ?? command, workdir: WORKSPACE, shell: '/bin/sh', login: false, tty: false, yieldTimeMs: Math.max(0, Math.min(30_000, yieldMs)) };
      const result = await this.use(scope, context, 'process.execute.restricted', async session => { for (const capability of plan.requiredCapabilities) this.check(context, capability); const result = await session.exec(args); for (const capability of plan.requiredCapabilities) this.check(context, capability); return result; });
      this.accept(managed, result);
      if (managed.status === 'running') { managed.completionEligible = true; this.schedulePoll(managed); }
      return this.snapshot(managed, 0, maxOutputTokens);
    } catch (error) {
      if (item === undefined) this.starting--;
      else {
        if (item.status === 'running') item.status = context.signal.aborted || this.stopped ? 'cancelled' : 'failed';
        this.track(item.log.close());
        this.track(this.close(item.scope));
      }
      throw error;
    }
  }
  private accept(item: ManagedProcess, result: SandboxExecResult): void {
    if (item.status !== 'running') return;
    // The SDK bounds each unread process chunk to 1 MiB. Expose that loss honestly.
    const dropped = /^\[\.\.\.([0-9]+) characters truncated from process output\.\.\.\]\n/u.exec(result.output);
    if (dropped?.[1] !== undefined) item.sdkDropped += Number(dropped[1]);
    item.log.append(cleanTerminalOutput(result.output));
    if (result.sessionId !== undefined) { item.nativeId = result.sessionId; return; }
    if (typeof result.exitCode !== 'number') throw new Error('Docker SDK omitted process status');
    item.exitCode = result.exitCode;
    item.status = result.exitCode === 0 ? 'completed' : 'failed';
    if (item.timer !== undefined) clearTimeout(item.timer);
    if (item.timeout !== undefined) clearTimeout(item.timeout);
    this.track(item.log.close());
    this.scheduleIdle(item.scope);
    const callback = this.completion;
    if (callback !== undefined && item.completionEligible && !item.notified && !item.context.signal.aborted && !this.stopped) {
      item.notified = true;
      const notify = Promise.resolve().then(async () => {
        this.check(item.context, 'process.execute.restricted');
        for (const capability of item.requiredCapabilities) this.check(item.context, capability);
        await callback(item.context, this.snapshot(item, Math.max(0, item.log.read(0, 0).total - 1200)));
      }).catch(() => { /* Status remains queryable if completion delivery fails. */ });
      this.track(notify);
    }
  }
  private schedulePoll(item: ManagedProcess): void {
    if (item.status !== 'running' || item.scope.closed || this.stopped) return;
    item.timer = setTimeout(() => {
      const poll = this.refresh(item, '', 100).then(() => { this.schedulePoll(item); }).catch(() => {
        if (item.status === 'running') item.status = 'failed';
        this.track(this.close(item.scope));
      });
      this.track(poll);
    }, 100);
    item.timer.unref();
  }
  private async refresh(item: ManagedProcess, chars = '', yieldTimeMs = 0): Promise<void> {
    if (item.status !== 'running') return;
    await this.use(item.scope, item.context, 'process.execute.restricted', async session => {
      for (const capability of item.requiredCapabilities) this.check(item.context, capability);
      if (item.status !== 'running' || item.nativeId === undefined) return;
      this.accept(item, parseDockerStdinResult(await session.writeStdin({ sessionId: item.nativeId, chars, yieldTimeMs })));
    });
  }
  private snapshot(item: ManagedProcess, offset = 0, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, limit = Number.MAX_SAFE_INTEGER): ProcessSnapshot {
    const range = item.log.read(offset, limit);
    const result = truncateOutput(range.text, maxOutputTokens);
    return { id: item.id, status: item.status, output: result.output, offset: range.total,
      truncated: result.truncated || range.from !== Math.min(offset, range.total) || range.droppedChars > 0 || item.sdkDropped > 0,
      originalChars: range.text.length, originalEstimatedTokens: Math.ceil(range.text.length / 4),
      returnedFrom: range.from, nextOffset: result.truncated ? range.from + result.headChars : range.through,
      fullOutputAvailable: range.fullOutputAvailable && item.sdkDropped === 0, droppedChars: range.droppedChars + item.sdkDropped, retainedThrough: range.retainedThrough,
      ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }) };
  }
  private owned(context: RunContext, id: string): ManagedProcess {
    this.check(context, 'process.execute.restricted');
    const item = this.processes.get(id);
    if (item === undefined || item.owner !== this.owner(context)) throw new SdkDockerExecutionError('session_not_found', 'Process not found in this session');
    for (const capability of item.requiredCapabilities) this.check(context, capability);
    return item;
  }
  async poll(context: RunContext, id: string, offset = 0, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, yieldMs = 0): Promise<ProcessSnapshot> {
    const item = this.owned(context, id); await this.refresh(item, '', Math.max(0, Math.min(30_000, yieldMs))); this.check(context, 'process.execute.restricted'); return this.snapshot(item, offset, maxOutputTokens);
  }
  async readOutput(context: RunContext, id: string, offset = 0, limit = 40_000, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): Promise<ProcessSnapshot> {
    const item = this.owned(context, id); await this.refresh(item); this.check(context, 'process.execute.restricted'); return this.snapshot(item, offset, maxOutputTokens, limit);
  }
  async writeStdin(context: RunContext, id: string, input: string, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, yieldMs = 250): Promise<ProcessSnapshot> {
    if (input.length > 0) { if (context.runtimeState !== 'elite_operator') throw new Error('只有高级资深干员可以向进程输入内容。'); this.check(context, 'process.pty'); }
    const item = this.owned(context, id);
    if (input.length > 16_000 || input.length > 0 && item.status !== 'running') throw new Error('Process input unavailable');
    await this.refresh(item, input, Math.max(0, Math.min(30_000, yieldMs))); if (input.length > 0) this.check(context, 'process.pty'); return this.snapshot(item, 0, maxOutputTokens);
  }
  async kill(context: RunContext, id: string): Promise<ProcessSnapshot> {
    const item = this.owned(context, id);
    // The SDK has no per-process hard-kill API: close this run's owned container.
    if (item.status === 'running') await this.close(item.scope);
    return this.snapshot(item);
  }
  list(context: RunContext): ProcessSnapshot[] {
    this.check(context, 'process.execute.restricted');
    return [...this.processes.values()].filter(item => item.owner === this.owner(context)).map(item => { for (const capability of item.requiredCapabilities) this.check(context, capability); return this.snapshot(item); });
  }
  private close(scope: Scope): Promise<void> {
    if (scope.closing !== undefined) return scope.closing;
    if (scope.failedClosing !== undefined) {
      this.cleanup.delete(scope.failedClosing);
      delete scope.failedClosing;
    }
    scope.closed = true;
    scope.removeAbort();
    if (scope.idle !== undefined) clearTimeout(scope.idle);
    const logs: Promise<void>[] = [];
    for (const item of this.processes.values()) {
      if (item.scope !== scope) continue;
      if (item.timer !== undefined) clearTimeout(item.timer);
      if (item.timeout !== undefined) clearTimeout(item.timeout);
      if (item.status === 'running') item.status = 'cancelled';
      logs.push(item.log.close());
    }
    const closing = (async () => {
      let session: DockerSession | undefined;
      try { session = await scope.session; } catch { /* Creation failed before a session existed. */ }
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await session?.close(); break; }
          catch (error) {
            if (attempt === 2) throw error;
            await new Promise<void>(resolve => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
      } finally { await Promise.all(logs); }
      if (this.scopes.get(scope.key) === scope) this.scopes.delete(scope.key);
    })().catch((error: unknown) => {
      // Keep the closed scope visible, but allow a later stop to retry SDK cleanup.
      scope.failedClosing = closing;
      delete scope.closing;
      throw error;
    });
    scope.closing = closing;
    return closing;
  }
  stop(): void {
    this.stopped = true; this.completion = undefined;
    for (const scope of this.scopes.values()) this.track(this.close(scope));
  }
  async drain(): Promise<void> {
    while (this.cleanup.size > 0) await Promise.all([...this.cleanup]);
    await Promise.all([...this.scopes.values()].flatMap(scope => scope.failedClosing === undefined ? [] : [scope.failedClosing]));
    await Promise.all([...this.processes.values()].map(item => item.log.drain()));
  }
  async available(): Promise<boolean> {
    if (this.stopped) return false;
    return new Promise(resolve => { const child = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 5000 }); child.on('error', () => resolve(false)); child.on('exit', code => resolve(code === 0)); });
  }
}
