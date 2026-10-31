import { spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, stat, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import processRuntime from 'node:process';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { Capability, RunContext } from '../../../contracts/src/index.js';
import { CommandPolicyError, compileCommandPolicy } from '../../../core/src/command-policy.js';
import { restrictedRunnerLaunch } from './restricted-runner.js';
import { assertWorkspaceWrite, ISOLATED_WORKSPACE, SHARED_WORKSPACE, workspaceDirectory, workspaceEntry, workspaceFailure, WorkspacePathError, workspacePath } from './workspace-zones.js';
import { cleanTerminalOutput, DEFAULT_MAX_OUTPUT_TOKENS, ProcessOutputLog, truncateOutput } from './output.js';

export type Authorize = (context: RunContext, capability: Capability) => void;
export interface ExecutionConfig { readonly root: string; readonly backend: 'local' | 'docker' | 'sdk_docker'; readonly id?: string; readonly dockerImage?: string; readonly maxProcesses?: number; readonly networkEnabled?: boolean; }
export interface ProcessSnapshot { id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; output: string; offset: number; truncated: boolean; exitCode?: number; originalChars?: number; originalEstimatedTokens?: number; returnedFrom?: number; nextOffset?: number; fullOutputAvailable?: boolean; droppedChars?: number; retainedThrough?: number; }
/** Runtime tools await either backend without changing the synchronous legacy API. */
export interface ExecutionBackend {
  readonly config: ExecutionConfig;
  onCompletion(callback: (context: RunContext, result: ProcessSnapshot) => Promise<void>): void;
  read(context: RunContext, name: string): Promise<string>;
  readBytes(context: RunContext, name: string): Promise<Uint8Array>;
  listFiles(context: RunContext, name?: string): Promise<string[]>;
  write(context: RunContext, name: string, content: string): Promise<void>;
  patch(context: RunContext, name: string, oldText: string, newText: string): Promise<void>;
  removeFile?(context: RunContext, name: string): Promise<void>;
  execute(context: RunContext, command: string, yieldMs?: number, maxOutputTokens?: number): Promise<ProcessSnapshot>;
  poll(context: RunContext, id: string, offset?: number, maxOutputTokens?: number, yieldMs?: number): ProcessSnapshot | Promise<ProcessSnapshot>;
  readOutput(context: RunContext, id: string, offset?: number, limit?: number, maxOutputTokens?: number): ProcessSnapshot | Promise<ProcessSnapshot>;
  writeStdin(context: RunContext, id: string, input: string, maxOutputTokens?: number, yieldMs?: number): ProcessSnapshot | Promise<ProcessSnapshot>;
  kill(context: RunContext, id: string): ProcessSnapshot | Promise<ProcessSnapshot>;
  list(context: RunContext): ProcessSnapshot[];
  stop(): void;
  drain(): Promise<void>;
  available(): Promise<boolean>;
}
interface ManagedProcess { id: string; owner: string; context: RunContext; requiredCapabilities: readonly Capability[]; process: IPty; log: ProcessOutputLog; exited: Promise<void>; status: ProcessSnapshot['status']; exitCode?: number; containerName?: string; removeAbort: () => void; }

/** A local backend is explicitly trusted-host execution; Docker is the isolation boundary. */
export class ExecutionService implements ExecutionBackend {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly cleanup = new Set<Promise<void>>();
  private completion: ((context: RunContext, result: ProcessSnapshot) => Promise<void>) | undefined;
  constructor(readonly config: ExecutionConfig, private readonly authorize: Authorize) {
    if (config.backend === 'sdk_docker') throw new Error('SDK Docker requires SdkDockerExecutionService');
  }
  onCompletion(callback: (context: RunContext, result: ProcessSnapshot) => Promise<void>): void { this.completion = callback; }
  private owner(context: RunContext): string { return JSON.stringify([context.principal.platform, context.principal.sessionType ?? 'private', context.principal.sessionId, context.principal.senderId, context.agentId, context.generation]); }
  private processOwner(context: RunContext): string { return JSON.stringify([this.owner(context), context.runtimeState, context.grantVersion]); }
  private async workspace(context: RunContext, zone: 'isolated' | 'shared' = 'isolated'): Promise<string> {
    if (context.resources.executionEnvironment !== (this.config.id ?? this.config.backend)) throw new Error('Execution environment is not assigned');
    return workspaceDirectory(this.config.root, context, zone);
  }
  private async resolve(context: RunContext, name: string, writing = false): Promise<string> {
    const selected = workspacePath(name);
    if (context.resources.executionEnvironment !== (this.config.id ?? this.config.backend)) throw new Error('Execution environment is not assigned');
    if (writing) {
      assertWorkspaceWrite(context, selected);
      if (selected.zone === 'shared') this.authorize(context, 'resources.manage');
    }
    return workspaceEntry(this.config.root, context, selected);
  }
  async read(context: RunContext, name: string): Promise<string> {
    this.authorize(context, 'files.read');
    const file = await this.resolve(context, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new WorkspacePathError('invalid_path', 'Path is not a regular file. Use list_files for a directory.');
      if (info.size > 1_000_000) throw new WorkspacePathError('size_limit', 'File exceeds the 1000000 byte text read limit.');
      const content = await readFile(file, 'utf8'); this.authorize(context, 'files.read'); await this.resolve(context, name); return content;
    } catch (error) { throw workspaceFailure(error); }
  }
  async readBytes(context: RunContext, name: string): Promise<Uint8Array> {
    this.authorize(context, 'files.read'); const file = await this.resolve(context, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new WorkspacePathError('invalid_path', 'Path is not a regular file. List its parent directory.');
      if (info.size > 20_000_000) throw new WorkspacePathError('size_limit', 'Artifact exceeds the 20000000 byte read limit.');
      const bytes = await readFile(file); this.authorize(context, 'files.read'); await this.resolve(context, name); return bytes;
    } catch (error) { throw workspaceFailure(error); }
  }
  async listFiles(context: RunContext, name = '.'): Promise<string[]> {
    this.authorize(context, 'files.read');
    const directory = await this.resolve(context, name);
    try { const names = (await readdir(directory)).slice(0, 500); this.authorize(context, 'files.read'); await this.resolve(context, name); return names; } catch (error) { throw workspaceFailure(error); }
  }
  async write(context: RunContext, name: string, content: string): Promise<void> {
    this.authorize(context, 'files.write');
    if (Buffer.byteLength(content) > 1_000_000) throw new WorkspacePathError('size_limit', 'File exceeds the 1000000 byte write limit.');
    const file = await this.resolve(context, name, true);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    this.authorize(context, 'files.write');
    await this.resolve(context, name, true);
    this.authorize(context, 'files.write');
    if (workspacePath(name).zone === 'shared') this.authorize(context, 'resources.manage');
    await rename(temporary, file);
  }
  async patch(context: RunContext, name: string, oldText: string, newText: string): Promise<void> {
    const content = await this.read(context, name);
    if (!oldText || content.split(oldText).length !== 2) throw new WorkspacePathError('patch_mismatch', 'Patch must match exactly one location. Read the file and use a unique non-empty oldText value.');
    await this.write(context, name, content.replace(oldText, newText));
  }
  async removeFile(context: RunContext, name: string): Promise<void> {
    this.authorize(context, 'files.write');
    const selected = workspacePath(name); assertWorkspaceWrite(context, selected);
    if (!selected.relative) throw new WorkspacePathError('invalid_path', 'Workspace roots cannot be removed. Specify a regular file.');
    const file = await this.resolve(context, name, true);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new WorkspacePathError('invalid_path', 'Only a regular file can be removed. Directories, symlinks and hard links are unavailable.');
      this.authorize(context, 'files.write'); await this.resolve(context, name, true);
      this.authorize(context, 'files.write');
      if (selected.zone === 'shared') this.authorize(context, 'resources.manage');
      await unlink(file);
    } catch (error) { throw workspaceFailure(error); }
  }
  async execute(context: RunContext, command: string, yieldMs = 1000, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): Promise<ProcessSnapshot> {
    this.authorize(context, 'process.execute.restricted');
    const plan = compileCommandPolicy(command, context.runtimeState);
    if (plan.mode === 'restricted' && this.config.backend === 'local') throw new CommandPolicyError('普通与资深干员的命令必须在 Docker 执行环境运行。本机执行仅供高级资深干员使用。');
    for (const capability of plan.requiredCapabilities) this.authorize(context, capability);
    if (plan.mode === 'full_shell') this.authorize(context, 'process.pty');
    if ([...this.processes.values()].filter(item => item.status === 'running').length >= (this.config.maxProcesses ?? 8)) throw new Error('Process capacity exceeded');
    const cwd = await this.workspace(context);
    const shared = this.config.backend === 'docker' ? await this.workspace(context, 'shared') : undefined;
    const sharedWritable = context.runtimeState === 'elite_operator' && context.effectiveCapabilities.includes('resources.manage');
    if (shared !== undefined && sharedWritable) this.authorize(context, 'resources.manage');
    for (const capability of plan.requiredCapabilities) this.authorize(context, capability);
    if (plan.mode === 'full_shell') this.authorize(context, 'process.pty');
    context.signal.throwIfAborted();
    const id = randomUUID();
    const containerName = `priestess-${id}`;
    const shell = this.config.backend === 'docker' ? 'docker' : '/bin/sh';
    const containerIdentity: string[] = [];
    if (plan.mode === 'restricted') { const uid = processRuntime.getuid?.(); const gid = processRuntime.getgid?.(); if (typeof uid !== 'number' || uid <= 0 || typeof gid !== 'number' || gid < 0) throw new CommandPolicyError('受限 Docker 命令需要非 root 服务账号。请使用普通服务账号运行机器人。'); containerIdentity.push('--user', `${uid}:${gid}`); }
    const restricted = plan.mode === 'restricted' ? restrictedRunnerLaunch(plan.operation, ISOLATED_WORKSPACE, this.config.networkEnabled === true) : undefined;
    const args = this.config.backend === 'docker'
      ? ['run', '--name', containerName, '--rm', ...containerIdentity, '-i', ...(plan.mode === 'full_shell' ? ['-t'] : []), this.config.networkEnabled === true ? '--network=bridge' : '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=512m', '--cpus=1', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--mount', `type=bind,src=${cwd},dst=${ISOLATED_WORKSPACE}`, '--mount', `type=bind,src=${shared ?? ''},dst=${SHARED_WORKSPACE}${sharedWritable ? '' : ',readonly'}`, '-w', ISOLATED_WORKSPACE, ...(restricted ? ['--entrypoint', restricted.executable] : []), this.config.dockerImage ?? (restricted ? 'node:22-bookworm-slim' : 'alpine:3.21'), ...(restricted ? restricted.args : ['/bin/sh', '-c', command])]
      : ['-c', command];
    const log = await ProcessOutputLog.create(path.join(this.config.root, '.process-logs'), id);
    let process: IPty;
    try { for (const capability of plan.requiredCapabilities) this.authorize(context, capability); if (shared !== undefined && sharedWritable) this.authorize(context, 'resources.manage'); context.signal.throwIfAborted(); process = pty.spawn(shell, args, { name: 'xterm-color', cols: 100, rows: 30, cwd, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: cwd, TERM: 'xterm-color', LANG: 'C.UTF-8' } }); } catch (error) { await log.close(); throw error; }
    let resolveExit: () => void = () => {};
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const cancel = (): void => { const current = this.processes.get(id); if (current?.status === 'running') this.terminate(current); };
    const managed: ManagedProcess = { id, owner: this.processOwner(context), context, requiredCapabilities: plan.requiredCapabilities, process, log, exited, status: 'running', ...(this.config.backend === 'docker' ? { containerName } : {}), removeAbort: () => context.signal.removeEventListener('abort', cancel) };
    this.processes.set(id, managed);
    context.signal.addEventListener('abort', cancel, { once: true });
    process.onData(data => { log.append(data); });
    process.onExit(event => {
      managed.exitCode = event.exitCode;
      if (managed.status === 'running') managed.status = event.exitCode === 0 ? 'completed' : 'failed';
      managed.removeAbort();
      resolveExit();
      const closing = log.close(); this.cleanup.add(closing); void closing.finally(() => this.cleanup.delete(closing));
      const callback = this.completion;
      if (callback !== undefined && !context.signal.aborted) void Promise.resolve().then(() => callback(context, this.snapshot(managed, Math.max(0, log.read(0, 0).total - 1200)))).catch(() => { /* Completion status remains queryable. */ });
    });
    if (context.signal.aborted) cancel();
    await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(yieldMs, 10_000))));
    return this.snapshot(managed, 0, maxOutputTokens);
  }
  private snapshot(item: ManagedProcess, offset = 0, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, limit = Number.MAX_SAFE_INTEGER): ProcessSnapshot {
    const range = item.log.read(offset, limit);
    const cleaned = cleanTerminalOutput(range.text);
    const result = truncateOutput(cleaned, maxOutputTokens);
    return { id: item.id, status: item.status, output: result.output, offset: range.total,
      truncated: result.truncated || range.from !== Math.min(offset, range.total) || range.droppedChars > 0,
      originalChars: range.text.length, originalEstimatedTokens: Math.ceil(cleaned.length / 4),
      returnedFrom: range.from, nextOffset: result.truncated ? range.from + result.headChars : range.through,
      fullOutputAvailable: range.fullOutputAvailable, droppedChars: range.droppedChars, retainedThrough: range.retainedThrough,
      ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }) };
  }
  private owned(context: RunContext, id: string): ManagedProcess {
    this.authorize(context, 'process.execute.restricted');
    const item = this.processes.get(id);
    if (item === undefined || item.owner !== this.processOwner(context)) throw new Error('Process not found in this session');
    for (const capability of item.requiredCapabilities) this.authorize(context, capability);
    return item;
  }
  poll(context: RunContext, id: string, offset = 0, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProcessSnapshot { return this.snapshot(this.owned(context, id), offset, maxOutputTokens); }
  readOutput(context: RunContext, id: string, offset = 0, limit = 40_000, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProcessSnapshot { return this.snapshot(this.owned(context, id), offset, maxOutputTokens, limit); }
  writeStdin(context: RunContext, id: string, input: string, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProcessSnapshot {
    if (input.length > 0) { if (context.runtimeState !== 'elite_operator') throw new Error('只有高级资深干员可以向进程输入内容。'); this.authorize(context, 'process.pty'); }
    const item = this.owned(context, id);
    if (input.length > 16_000 || input.length > 0 && item.status !== 'running') throw new Error('Process input unavailable');
    if (input.length > 0) item.process.write(input);
    return this.snapshot(item, 0, maxOutputTokens);
  }
  kill(context: RunContext, id: string): ProcessSnapshot { const item = this.owned(context, id); if (item.status === 'running') this.terminate(item); return this.snapshot(item); }
  list(context: RunContext): ProcessSnapshot[] { this.authorize(context, 'process.execute.restricted'); return [...this.processes.values()].filter(item => item.owner === this.processOwner(context)).map(item => { for (const capability of item.requiredCapabilities) this.authorize(context, capability); return this.snapshot(item); }); }
  private terminate(item: ManagedProcess): void {
    item.status = 'cancelled'; item.process.kill();
    if (item.containerName !== undefined) {
      const name = item.containerName;
      const cleanup = new Promise<void>(resolve => { const child = spawnProcess('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10_000 }); child.on('error', () => resolve()); child.on('exit', () => resolve()); });
      this.cleanup.add(cleanup); void cleanup.finally(() => this.cleanup.delete(cleanup));
    }
  }
  stop(): void { this.completion = undefined; for (const item of this.processes.values()) { item.removeAbort(); if (item.status === 'running') this.terminate(item); const closing = item.exited.then(() => item.log.close()); this.cleanup.add(closing); void closing.finally(() => this.cleanup.delete(closing)); } }
  async drain(): Promise<void> { await Promise.all([...this.cleanup]); await Promise.all([...this.processes.values()].map(async item => { if (item.status !== 'running') await item.exited; await item.log.drain(); })); }
  async available(): Promise<boolean> {
    if (this.config.backend === 'local') return true;
    return new Promise(resolve => { const child = spawnProcess('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 5000 }); child.on('error', () => resolve(false)); child.on('exit', code => resolve(code === 0)); });
  }
}
