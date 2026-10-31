import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { tool, type Tool } from '@openai/agents';
import { ExtensionInstallSchema, ExtensionRecordSchema, ExtensionManifestSchema, type ExtensionRecord, type ExtensionManifest, type ExtensionOperation } from '../../../contracts/src/extensions.js';
import type { AgentDefinition, EngineInput, RunContext } from '../../../contracts/src/index.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import type { AuthorizationService } from '../../../core/src/authorization.js';
import { textReply, type CommandOutcome } from '../../../core/src/commands.js';

export type ExtensionValue = string | number | boolean;
export interface ExtensionContext { readonly signal: AbortSignal; readonly configuration: Readonly<Record<string, ExtensionValue>>; readonly senderId: string; readonly sessionId: string; readonly agentId: string; readonly state: { get(key: string): string | undefined; set(key: string, value: string): void }; }
export interface NativeExtension { readonly manifest: ExtensionManifest; readonly execute: (operation: string, parameters: Readonly<Record<string, ExtensionValue>>, context: ExtensionContext) => Promise<string>; readonly start?: () => Promise<void>; readonly stop?: () => Promise<void>; }
/** Native modules are trusted host code. The narrow context does not sandbox Node.js imports. */
export function defineExtension(extension: NativeExtension): NativeExtension { ExtensionManifestSchema.parse(extension.manifest); return extension; }
const ModuleSchema = z.object({ default: z.custom<NativeExtension>(value => typeof value === 'object' && value !== null && 'manifest' in value && ExtensionManifestSchema.safeParse(value.manifest).success && 'execute' in value && typeof value.execute === 'function' && (!('start' in value) || typeof value.start === 'function') && (!('stop' in value) || typeof value.stop === 'function')) });
const reserved = new Set(['help', 'state', 'stop', 'new', 'reset', 'memory_recall', 'memory_save', 'memory_delete', 'knowledge_search', 'list_files', 'read_file', 'write_file', 'patch_file', 'exec_command', 'write_stdin', 'process_poll', 'process_kill', 'delegate_agent', 'read_skill', 'list_skills', 'write_skill', 'delete_skill_file', 'read_tool_result', 'search_tool_result', 'process_read_output', 'attach_file']);
function parameters(operation: ExtensionOperation): z.ZodObject<Record<string, z.ZodType<ExtensionValue>>> { const shape: Record<string, z.ZodType<ExtensionValue>> = {}; for (const [key, field] of Object.entries(operation.parameters)) shape[key] = (field.type === 'string' ? z.string().max(field.maxLength) : field.type === 'number' ? z.number().finite() : z.boolean()).describe(field.description); return z.object(shape).strict(); }
export class NativeExtensionRegistry {
  private readonly loaded = new Map<string, NativeExtension>();
  private readonly changing = new Set<string>();
  private readonly active = new Map<string, Set<AbortController>>();
  constructor(private readonly store: RuntimeStore, private readonly auth: AuthorizationService) {}
  list(): ExtensionRecord[] { return this.store.list('extensions', ExtensionRecordSchema); }
  private require(id: string): ExtensionRecord { const record = this.store.get('extensions', id, ExtensionRecordSchema); if (!record) throw new Error('Extension not found'); return record; }
  async install(raw: unknown): Promise<ExtensionRecord> {
    const input = ExtensionInstallSchema.parse(raw); if (this.list().some(item => item.manifest.id === input.manifest.id)) throw new Error('Extension already installed');
    if (!path.isAbsolute(input.modulePath) || !['.mjs', '.js'].includes(path.extname(input.modulePath))) throw new Error('An absolute compiled local .mjs or .js module is required');
    const file = await realpath(input.modulePath); if (!(await stat(file)).isFile()) throw new Error('Extension module must be a file');
    if (this.list().some(item => item.manifest.id === input.manifest.id)) throw new Error('Extension already installed');
    const names = new Set(reserved); for (const item of this.list()) for (const operation of [...item.manifest.tools, ...item.manifest.commands]) names.add(operation.name);
    for (const operation of [...input.manifest.tools, ...input.manifest.commands]) { if (names.has(operation.name)) throw new Error(`Extension operation collision: ${operation.name}`); names.add(operation.name); parameters(operation); }
    const record: ExtensionRecord = { manifest: input.manifest, modulePath: file, configuration: parameters({ name: input.manifest.id, description: '', capabilities: ['chat'], parameters: input.manifest.configuration }).parse(input.configuration), enabled: false, status: 'disabled', diagnostic: '', revision: 1, updatedAt: Date.now() }; this.store.put('extensions', record.manifest.id, record); return record;
  }
  async toggle(id: string, enabled: boolean, expectedRevision: number, configuration?: Record<string, ExtensionValue>): Promise<ExtensionRecord> {
    if (this.changing.has(id)) throw new Error('Extension lifecycle change is in progress');
    this.changing.add(id);
    try {
    const previous = this.require(id); if (previous.revision !== expectedRevision) throw new Error('Extension revision conflict');
    const settings = parameters({ name: previous.manifest.id, description: '', capabilities: ['chat'], parameters: previous.manifest.configuration }).parse(configuration ?? previous.configuration); await this.unload(id); const record: ExtensionRecord = { ...previous, configuration: settings, enabled, status: enabled ? 'enabled' : 'disabled', diagnostic: '', revision: previous.revision + 1, updatedAt: Date.now() };
    if (enabled) try { const raw: unknown = await import(pathToFileURL(record.modulePath).href); const module = ModuleSchema.parse(raw).default; if (JSON.stringify(ExtensionManifestSchema.parse(module.manifest)) !== JSON.stringify(record.manifest)) throw new Error('Installed manifest does not match module'); await module.start?.(); this.loaded.set(id, module); } catch { record.status = 'failed'; record.enabled = false; record.diagnostic = 'Module validation or startup failed. Verify the local module and installed manifest.'; }
    this.store.put('extensions', id, record); return record;
    } finally { this.changing.delete(id); }
  }
  async start(): Promise<void> { for (const record of this.list()) if (record.enabled && !this.loaded.has(record.manifest.id)) await this.toggle(record.manifest.id, true, record.revision); }
  async stop(): Promise<void> { for (const id of this.loaded.keys()) await this.unload(id); }
  private async unload(id: string): Promise<void> { const module = this.loaded.get(id); this.loaded.delete(id); for (const controller of this.active.get(id) ?? []) controller.abort(); this.active.delete(id); try { await module?.stop?.(); } catch { /* A broken shutdown must not keep an extension enabled. */ } }
  private check(id: string, operation: ExtensionOperation, context: RunContext, agent: AgentDefinition): void { if (!this.loaded.has(id) || !this.require(id).enabled) throw new Error('Extension disabled'); for (const capability of operation.capabilities) this.auth.assert(context, capability, agent, { kind: 'tools', id: operation.name }); }
  async invoke(id: string, name: string, raw: unknown, context: RunContext, agent: AgentDefinition): Promise<string> {
    const record = this.require(id); const operation = [...record.manifest.tools, ...record.manifest.commands].find(item => item.name === name); const module = this.loaded.get(id); if (!operation || !module) throw new Error('Extension operation unavailable'); this.check(id, operation, context, agent); const args = parameters(operation).parse(raw);
    const controller = new AbortController(); const controllers = this.active.get(id) ?? new Set<AbortController>(); controllers.add(controller); this.active.set(id, controllers); const signal = AbortSignal.any([context.signal, controller.signal]);
    const guard = (): void => { signal.throwIfAborted(); this.check(id, operation, context, agent); };
    const namespace = `extension-state:${JSON.stringify([id, context.agentId, context.principal.platform, context.principal.sessionType ?? 'private', context.principal.sessionId, context.principal.senderId])}`;
    try { const result = await module.execute(name, args, { signal, configuration: record.configuration, senderId: context.principal.senderId, sessionId: context.principal.sessionId, agentId: context.agentId, state: { get: key => { guard(); return this.store.get(namespace, z.string().min(1).max(200).parse(key), z.string()); }, set: (key, value) => { guard(); this.store.put(namespace, z.string().min(1).max(200).parse(key), z.string().max(10000).parse(value)); } } }); guard(); return z.string().max(100000).parse(result); }
    finally { controllers.delete(controller); }
  }
  tools(input: EngineInput): Tool[] { const tools: Tool[] = []; for (const record of this.list()) for (const operation of record.manifest.tools) { try { this.check(record.manifest.id, operation, input.context, input.agent); } catch { continue; } tools.push(tool({ name: operation.name, description: operation.description, parameters: parameters(operation), needsApproval: input.agent.approvalTools.includes(operation.name), execute: args => this.invoke(record.manifest.id, operation.name, args, input.context, input.agent) })); } return tools; }
  async dispatch(text: string, context: RunContext, agent: AgentDefinition): Promise<CommandOutcome> { const match = /^\/([a-z][a-z0-9_]*)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim()); if (!match) return { status: 'unhandled' }; const name = match[1]; for (const record of this.list()) if (record.manifest.commands.some(command => command.name === name)) { try { const raw: unknown = JSON.parse(match[2] || '{}'); return { status: 'handled', reply: textReply(await this.invoke(record.manifest.id, name ?? '', raw, context, agent)) }; } catch { return { status: 'rejected', reply: textReply('扩展指令未执行：请检查启用状态、权限和 JSON 参数。') }; } } return { status: 'unhandled' }; }
}
