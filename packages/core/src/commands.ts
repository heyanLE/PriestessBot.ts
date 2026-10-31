import { z } from 'zod';
import { RuntimeStateSchema, runtimeStateLabels, type AgentDefinition, type Capability, type ReplyPlan, type RunContext, type RuntimeState } from '../../contracts/src/index.js';
import type { AuthorizationService} from './authorization.js';
import { conversationKey, principalKey, stateRanks } from './authorization.js';
import type { ConversationScheduler } from './scheduler.js';
import type { RuntimeStore } from './storage.js';

export interface CommandDefinition<Args, Result> {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly argsSchema: z.ZodType<Args>;
  readonly parse: (tokens: readonly string[]) => unknown;
  readonly minimumState: RuntimeState;
  readonly requiredCapabilities: readonly Capability[];
  readonly execute: (context: RunContext, args: Args) => Promise<Result>;
  readonly reply: (result: Result, context: RunContext) => ReplyPlan;
}
export type CommandOutcome = { readonly status: 'unhandled' } | { readonly status: 'handled' | 'rejected' | 'failed'; readonly reply: ReplyPlan };
interface RegisteredCommand { readonly name: string; readonly usage: string; readonly invoke: (tokens: readonly string[], context: RunContext, agent: AgentDefinition) => Promise<CommandOutcome>; }
export function textReply(text: string): ReplyPlan { return { parts: [{ type: 'text', text }] }; }
export function tokenizeCommand(input: string): string[] {
  const result: string[] = []; let buffer = ''; let quoted: '"' | "'" | undefined; let escape = false; let started = false;
  for (const character of input) {
    if (escape) { buffer += character; escape = false; started = true; continue; }
    if (character === '\\') { escape = true; started = true; continue; }
    if (quoted !== undefined) { if (character === quoted) quoted = undefined; else buffer += character; started = true; continue; }
    if (character === '"' || character === "'") { quoted = character; started = true; continue; }
    if (/\s/.test(character)) { if (started) { result.push(buffer); buffer = ''; started = false; } } else { buffer += character; started = true; }
  }
  if (escape || quoted !== undefined) throw new Error('Unterminated quote or escape');
  if (started) result.push(buffer);
  return result;
}
export class CommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>();
  constructor(private readonly authorization: AuthorizationService) {}
  register<Args, Result>(definition: CommandDefinition<Args, Result>): void {
    const names = [definition.name, ...(definition.aliases ?? [])].map(name => name.toLowerCase());
    if (new Set(names).size !== names.length || names.some(name => !/^[a-z][a-z0-9_-]*$/.test(name))) throw new Error('Invalid or duplicate command alias');
    for (const name of names) if (this.commands.has(name)) throw new Error(`Command alias conflict: ${name}`);
    const registered: RegisteredCommand = { name: definition.name, usage: definition.usage, invoke: async (tokens, context, agent) => {
      const parsed = definition.argsSchema.safeParse(definition.parse(tokens));
      if (!parsed.success) return { status: 'rejected', reply: textReply(`用法：${definition.usage}\n${parsed.error.issues.map(issue => issue.message).join('; ')}`) };
      try {
        // Every role has chat. This also checks cancellation, generation and live grant version
        // for commands whose additional capability list is empty.
        this.authorization.assert(context, 'chat', agent);
        if (stateRanks[context.runtimeState] < stateRanks[definition.minimumState]) return { status: 'rejected', reply: textReply(agent.permissionDenied) };
        for (const capability of definition.requiredCapabilities) this.authorization.assert(context, capability, agent);
      } catch { return { status: 'rejected', reply: textReply(agent.permissionDenied) }; }
      try { const result = await definition.execute(context, parsed.data); return { status: 'handled', reply: definition.reply(result, context) }; }
      catch (error) { return { status: 'failed', reply: textReply(error instanceof Error ? error.message : '指令执行失败') }; }
    } };
    for (const name of names) this.commands.set(name, registered);
  }
  help(): string { return [...new Set(this.commands.values())].map(command => command.usage).join('\n'); }
  isControl(text: string, prefix = '/'): boolean { const name = text.startsWith(prefix) ? text.slice(prefix.length).trim().split(/\s/, 1)[0]?.toLowerCase() : undefined; return name === 'stop' || name === 'new' || name === 'reset'; }
  async dispatch(text: string, context: RunContext, agent: AgentDefinition, prefix = '/'): Promise<CommandOutcome> {
    if (!text.startsWith(prefix)) return { status: 'unhandled' };
    const input = text.slice(prefix.length).trim();
    const name = input.split(/\s/, 1)[0]?.toLowerCase();
    const command = name === undefined ? undefined : this.commands.get(name);
    if (command === undefined) return { status: 'unhandled' };
    let tokens: string[];
    try { tokens = tokenizeCommand(input).slice(1); } catch (error) { return { status: 'rejected', reply: textReply(`${error instanceof Error ? error.message : 'Invalid arguments'}\n用法：${command.usage}`) }; }
    return command.invoke(tokens, context, agent);
  }
}
export function cancelPausedRuns(store: RuntimeStore, sessionKey: string, senderId?: string, reason = 'Stopped by user'): number {
  const paused = store.runs().filter(run => run.sessionKey === sessionKey && run.status === 'paused' && (senderId === undefined || run.senderId === senderId));
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const run of paused) {
      const prefix = 'Approval required: ';
      if (run.summary.startsWith(prefix)) store.delete('sdk-pauses', run.summary.slice(prefix.length));
      store.delete('paused-inputs', run.id);
      store.saveRun({ ...run, status: 'cancelled', updatedAt: Date.now(), summary: reason });
    }
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return paused.length;
}
export function createBuiltinCommands(auth: AuthorizationService, store: RuntimeStore, scheduler: ConversationScheduler): CommandRegistry {
  const registry = new CommandRegistry(auth);
  const empty = z.array(z.string()).length(0);
  registry.register({ name: 'help', usage: '/help', argsSchema: empty, parse: tokens => tokens, minimumState: 'operator', requiredCapabilities: [], execute: () => Promise.resolve(registry.help()), reply: textReply });
  registry.register({ name: 'state', usage: '/state（查看当前运行态）', argsSchema: z.tuple([RuntimeStateSchema.optional()]), parse: tokens => tokens.length <= 1 ? [tokens[0]] : tokens, minimumState: 'operator', requiredCapabilities: [], execute: (context, [state]) => Promise.resolve(state === undefined ? auth.state(context.principal) : auth.requestState(context.principal, state)), reply: state => textReply(runtimeStateLabels[state]) });
  registry.register({ name: 'stop', usage: '/stop', argsSchema: empty, parse: tokens => tokens, minimumState: 'operator', requiredCapabilities: ['conversation.stop'], execute: context => { const key = conversationKey(context.principal, context.agentId); scheduler.cancel(key, 'Stopped by user', principalKey(context.principal)); cancelPausedRuns(store, key, context.principal.senderId); return Promise.resolve('已停止你在当前会话中的任务。'); }, reply: textReply });
  registry.register({ name: 'new', aliases: ['reset'], usage: '/new（或 /reset）', argsSchema: empty, parse: tokens => tokens, minimumState: 'senior_operator', requiredCapabilities: ['conversation.reset'], execute: context => { const key = conversationKey(context.principal, context.agentId); scheduler.cancel(key, 'Conversation reset'); cancelPausedRuns(store, key, undefined, 'Conversation reset'); const generation = store.reset(key); return Promise.resolve(`已开始新会话（${generation}）。`); }, reply: textReply });
  return registry;
}
