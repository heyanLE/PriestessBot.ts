import { createHash } from 'node:crypto';
import { join, relative, resolve, sep, basename } from 'node:path';
import { chmodSync, copyFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CapabilitySchema, ContentPartSchema, RuntimeConfigSchema, type ContentPart, type RuntimeConfig } from '../../contracts/src/index.js';
import { ConversationSchema, FolderSchema, PersonaBindingSchema, PersonaSchema, TranscriptEntrySchema } from '../../contracts/src/management.js';
import type { RuntimeStore } from './storage.js';

const Provider = z.object({ id: z.string(), base_url: z.string().url(), api_key: z.string().default(''), wire_api: z.string().default('responses') });
const SourcePlatform = z.object({ id: z.string(), type: z.string(), enable: z.boolean().default(false), ws_reverse_token: z.string().default('') });
const SourceConfig = z.object({
  agent_runner: z.object({ config: z.object({ model: z.string(), model_provider: z.string(), model_providers: z.array(Provider), developer_instructions: z.string().default(''), base_instructions: z.string().default(''), memory_enabled: z.boolean().default(false), memory_auto_consolidate: z.boolean().default(false), turn_timeout: z.number().positive().default(600), max_queued_turns: z.number().int().nonnegative().default(5), thread_config: z.object({ model_auto_compact_token_limit: z.number().int().positive().default(32768) }).default({ model_auto_compact_token_limit: 32768 }) }) }),
  platform: z.array(SourcePlatform), admins_id: z.array(z.string()).default([]),
  platform_settings: z.object({ enable_id_white_list: z.boolean().default(false), id_whitelist: z.array(z.string()).default([]), wl_ignore_admin_on_group: z.boolean().default(false), wl_ignore_admin_on_friend: z.boolean().default(false), rate_limit: z.object({ time: z.number().default(60), count: z.number().default(0) }).default({ time: 60, count: 0 }) }),
  provider_settings: z.object({ enable: z.boolean().default(true), streaming_response: z.boolean().default(false), computer_use_require_admin: z.boolean().default(true) }).default({ enable: true, streaming_response: false, computer_use_require_admin: true }),
  permission_rules: z.array(z.object({ enabled: z.boolean().default(true), match: z.array(z.string()), persona_id: z.string().optional() })).default([]),
});
const SourceSkills = z.object({ skills: z.record(z.string(), z.object({ active: z.boolean() })) });
export interface AstrBotXMappingOptions { readonly target: string; readonly napcatWebsocketUrl: string; readonly napcatHttpUrl?: string; readonly napcatToken?: string; }
export interface AstrBotXMapping { readonly config: RuntimeConfig; readonly secrets: ReadonlyMap<string, string>; readonly warnings: string[]; readonly personaId: string | undefined; readonly activeSkills: string[]; }
export function parseAstrBotXJson(text: string): unknown { const value: unknown = JSON.parse(text.replace(/^\uFEFF/, '')); return value; }
function key(id: string): string { return createHash('sha256').update(id).digest('hex').slice(0, 20).toUpperCase(); }
export function mapAstrBotXConfiguration(raw: unknown, skillsRaw: unknown, options: AstrBotXMappingOptions): AstrBotXMapping {
  const source = SourceConfig.parse(raw); const runner = source.agent_runner.config;
  const skills = SourceSkills.parse(skillsRaw); const activeSkills = Object.entries(skills.skills).filter(([, item]) => item.active).map(([name]) => name);
  if (activeSkills.some(name => !/^[a-zA-Z0-9_.-]+$/.test(name) || name === '..')) throw new Error('Unsafe source skill directory name');
  const secrets = new Map<string, string>();
  const connections = runner.model_providers.map(provider => { const apiKeyEnv = `ASTRBOTX_MODEL_${key(provider.id)}`; if (provider.api_key) secrets.set(apiKeyEnv, provider.api_key); return { id: provider.id, baseUrl: provider.base_url, apiKeyEnv, protocol: provider.base_url.includes('api.deepseek.com') || provider.wire_api === 'chat' || provider.wire_api === 'chat_completions' ? 'chat_completions' : 'responses' }; });
  if (!connections.some(connection => connection.id === runner.model_provider)) throw new Error('AstrBotX selected model provider was not found');
  const warnings = [
    'Codex-specific thread state, code-mode settings and authorization are preserved in the source archive; new Agents SDK sessions start without replaying them.',
    'Python plugin files/configuration are archived. They are not executable TypeScript extensions.',
    'Dashboard password hashes/API keys/trusted devices are archived; the new Dashboard uses a separately generated management token.',
    'Model provider wire_api=responses is corrected to chat_completions for api.deepseek.com.',
    'Source timestamps without offsets are interpreted as UTC, matching AstrBotX database storage.',
  ];
  const enabled = source.platform.filter(platform => platform.enable);
  const unsupported = enabled.filter(platform => platform.type !== 'aiocqhttp');
  if (unsupported.length) throw new Error(`Unsupported enabled source platforms: ${unsupported.map(platform => platform.type).join(', ')}`);
  const platforms = source.platform.filter(platform => platform.type === 'aiocqhttp').map(platform => {
    const accessTokenEnv = `ASTRBOTX_NAPCAT_${key(platform.id)}`; const token = options.napcatToken ?? platform.ws_reverse_token; if (token) secrets.set(accessTokenEnv, token);
    return { id: platform.id, displayName: platform.id, type: 'napcat', enabled: platform.enable, websocketUrl: options.napcatWebsocketUrl, ...(options.napcatHttpUrl ? { apiBase: options.napcatHttpUrl } : {}), accessTokenEnv };
  });
  const entries: { platform: string; sessionType: 'group' | 'private'; sessionId: string }[] = [];
  for (const entry of source.platform_settings.id_whitelist) {
    const match = /^([^:]+):(FriendMessage|GroupMessage):(.+)$/.exec(entry);
    if (match?.[1] && match[2] && match[3]) entries.push({ platform: match[1], sessionType: match[2] === 'FriendMessage' ? 'private' : 'group', sessionId: match[3] });
    else if (/^\d+$/.test(entry)) for (const platform of platforms) entries.push({ platform: platform.id, sessionType: 'group', sessionId: entry });
    else throw new Error('Cannot migrate ambiguous whitelist entry; refusing a potentially broader access policy');
  }
  const workspace = join(options.target, 'workspace');
  const tools = ['read_skill', 'list_skills', 'write_skill', 'delete_skill_file', 'read_file', 'list_files', 'write_file', 'patch_file', 'exec_command', 'write_stdin', 'process_poll', 'process_kill', 'attach_file', 'read_tool_result', 'search_tool_result', 'process_read_output'];
  if (runner.memory_enabled) tools.push('memory_recall', 'memory_save', 'memory_delete');
  const resources = { skills: activeSkills.length ? ['astrbotx-skills'] : [], memoryLibraries: runner.memory_enabled ? ['astrbotx-memory'] : [], tools, directories: [workspace], executionEnvironment: 'astrbotx-local' };
  const capabilities = CapabilitySchema.options.filter(capability => !['agent.delegate', 'knowledge.read'].includes(capability));
  const administrators = platforms.flatMap(platform => source.admins_id.map(senderId => ({ platform: platform.id, senderId })));
  const personaRule = source.permission_rules.find(rule => rule.enabled && rule.match.includes('*') && rule.persona_id);
  if (source.permission_rules.some(rule => rule.enabled && !rule.match.includes('*'))) warnings.push('Non-default persona permission rules are preserved but need explicit Agent route mappings.');
  if (runner.memory_auto_consolidate && !runner.memory_enabled) warnings.push('Source memory was disabled; consolidation preference is archived and remains inactive.');
  warnings.push('Terminal/file mutation is restricted to migrated administrators in elite state; ordinary senders retain the project ordinary-operator permission model.');
  const compactAtTokens = runner.thread_config.model_auto_compact_token_limit;
  const config = RuntimeConfigSchema.parse({
    runtime: 'priestess-ts', schemaVersion: 1, agents: [{ id: 'assistant', displayName: '普瑞赛斯', enabled: source.provider_settings.enable, engine: 'agents_sdk', model: runner.model, connectionId: runner.model_provider, instructions: [runner.base_instructions, runner.developer_instructions].filter(Boolean).join('\n\n'), capabilities, resources, budget: { timeoutMs: runner.turn_timeout * 1000, maxTokens: 100_000, maxTurns: 40 }, contextPolicy: { compactAtTokens, targetTokens: Math.floor(compactAtTokens / 2), contextWindowTokens: Math.max(128000, compactAtTokens + 1) }, memoryExtraction: { enabled: runner.memory_enabled, ...(runner.memory_enabled ? { libraryId: 'astrbotx-memory' } : {}) } }],
    connections, platforms, grants: administrators.map(admin => ({ ...admin, maximumState: 'elite_operator', defaultState: 'elite_operator', capabilities, resources })),
    memoryLibraries: runner.memory_enabled ? [{ id: 'astrbotx-memory', displayName: 'PriestessBot 记忆' }] : [],
    skillLibraries: activeSkills.length ? [{ id: 'astrbotx-skills', directory: join(options.target, 'imported', 'active-skills') }] : [],
    executionEnvironments: [{ id: 'astrbotx-local', type: 'local', root: workspace, networkEnabled: true }],
    flow: { routing: { defaultAgentId: 'assistant', rules: [] }, acceptance: { rateLimitCount: source.platform_settings.rate_limit.count, rateLimitWindowMs: source.platform_settings.rate_limit.time * 1000, allowlist: { enabled: source.platform_settings.enable_id_white_list && entries.length > 0, entries, administrators, bypassAdministratorsInPrivate: source.platform_settings.wl_ignore_admin_on_friend, bypassAdministratorsInGroups: source.platform_settings.wl_ignore_admin_on_group } }, execution: { timeoutMs: runner.turn_timeout * 1000, maxTurns: 40, perSessionQueueLimit: runner.max_queued_turns }, delivery: { stream: source.provider_settings.streaming_response } },
  });
  return { config, secrets, warnings, personaId: personaRule?.persona_id, activeSkills };
}

const DateValue = z.union([z.string(), z.number()]);
const Dates = { created_at: DateValue, updated_at: DateValue };
const OldPersona = z.object({ ...Dates, persona_id: z.string(), system_prompt: z.string(), begin_dialogs: z.string().nullable(), folder_id: z.string().nullable(), custom_error_message: z.string().nullable().optional(), voice_prompt: z.string().nullable().optional(), tools: z.string().nullable().optional(), skills: z.string().nullable().optional() });
const OldFolder = z.object({ ...Dates, folder_id: z.string(), name: z.string(), parent_id: z.string().nullable() });
const OldConversation = z.object({ ...Dates, conversation_id: z.string(), platform_id: z.string(), user_id: z.string(), content: z.string().nullable(), title: z.string().nullable() });
const OldSession = z.object({ ...Dates, session_id: z.string(), platform_id: z.string(), creator: z.string(), display_name: z.string().nullable(), is_group: z.number() });
const OldHistory = z.object({ ...Dates, id: z.number(), platform_id: z.string(), user_id: z.string(), sender_id: z.string().nullable(), sender_name: z.string().nullable(), content: z.string() });
const TextMessage = z.object({ role: z.string(), content: z.unknown().optional() });
const PlatformMessage = z.object({ type: z.string(), message: z.unknown() });
const OldAttachment = z.object({ attachment_id: z.string(), path: z.string(), type: z.string(), mime_type: z.string() });
interface ImportedAttachment { readonly id: string; readonly name: string; readonly mimeType: string; readonly size: number; }
const Component = z.object({ attachment_id: z.string().optional(), filename: z.string().optional(), type: z.string(), text: z.string().optional(), user_id: z.union([z.string(), z.number()]).optional(), name: z.string().optional(), url: z.string().optional(), file: z.string().optional(), path: z.string().optional(), message_id: z.union([z.string(), z.number()]).optional() });
function timestamp(value: string | number): number { const parsed = typeof value === 'number' ? value : Date.parse(value.includes('T') || /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`); if (!Number.isFinite(parsed)) throw new Error('Invalid source database timestamp'); return parsed; }
function parts(value: unknown, attachments: ReadonlyMap<string, ImportedAttachment> = new Map()): ContentPart[] {
  if (typeof value === 'string') { const result: ContentPart[] = []; for (let i = 0; i < value.length; i += 200_000) result.push({ type: 'text', text: value.slice(i, i + 200_000) }); return result; }
  if (!Array.isArray(value)) return [{ type: 'text', text: '[原始结构化消息见迁移存档]' }];
  return value.flatMap((raw: unknown): ContentPart[] => {
    const parsed = Component.safeParse(raw); if (!parsed.success) return [{ type: 'text', text: '[未识别消息组件，见原始存档]' }]; const item = parsed.data;
    if (item.type === 'plain' || item.type === 'text' || item.type === 'input_text' || item.type === 'output_text') return parts(item.text ?? '', attachments);
    if (item.type === 'at') return [{ type: 'mention', userId: String(item.user_id ?? ''), ...(item.name === undefined ? {} : { name: item.name }) }];
    if (item.type === 'reply') return [{ type: 'quote', messageId: String(item.message_id ?? 'unknown'), ...(item.text === undefined ? {} : { text: item.text }) }];
    const attachment = item.attachment_id ? attachments.get(item.attachment_id) : undefined;
    if (attachment) return [ContentPartSchema.parse(item.type === 'image' ? { type: 'image', artifactId: attachment.id, url: `artifact:${attachment.id}`, mimeType: attachment.mimeType } : { type: 'file', artifactId: attachment.id, url: `artifact:${attachment.id}`, name: item.filename ?? attachment.name, mimeType: attachment.mimeType, size: attachment.size })];
    const url = item.url ?? item.file ?? item.path;
    if (item.type === 'image' && url && /^https?:\/\//.test(url)) return [ContentPartSchema.parse({ type: 'image', url })];
    if (item.type === 'file' && url && /^https?:\/\//.test(url)) return [ContentPartSchema.parse({ type: 'file', url, name: item.name ?? '附件', mimeType: 'application/octet-stream' })];
    return [{ type: 'text', text: `[原始 ${item.type} 附件/组件保存在 AstrBotX 存档中]` }];
  });
}
interface Identity { readonly platform: string; readonly sessionId: string; readonly sessionType: 'private' | 'group'; readonly ownerId: string; }
function identity(platform: string, value: string, sessions: readonly z.infer<typeof OldSession>[]): Identity {
  const match = /^([^:]+):(FriendMessage|GroupMessage):(.+)$/.exec(value); const sessionId = match?.[3] ?? value;
  if (platform === 'webchat') { const pieces = sessionId.split('!'); const id = pieces.length >= 3 ? pieces.slice(2).join('!') : sessionId; const session = sessions.find(item => item.platform_id === platform && item.session_id === id); return { platform: 'astrbotx:webchat', sessionId: id, sessionType: session?.is_group ? 'group' : 'private', ownerId: session?.creator ?? pieces[1] ?? 'unknown-source-sender' }; }
  return { platform, sessionId, sessionType: match?.[2] === 'GroupMessage' ? 'group' : 'private', ownerId: match?.[2] === 'GroupMessage' ? 'unknown-source-sender' : sessionId };
}
export interface AstrBotXImportCounts { personas: number; personaFolders: number; conversations: number; transcriptEntries: number; platformConversations: number; platformMessages: number; archivedRows: number; attachments: number; missingAttachments: number; }
/** Source is read-only. Management history never populates authorization-bound SDK sessions. */
export function importAstrBotXDatabase(sourcePath: string, store: RuntimeStore, selectedPersonaId?: string, files?: { readonly sourceRoot: string; readonly originalSourceRoot: string; readonly targetRoot: string }): AstrBotXImportCounts {
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  const counts: AstrBotXImportCounts = { personas: 0, personaFolders: 0, conversations: 0, transcriptEntries: 0, platformConversations: 0, platformMessages: 0, archivedRows: 0, attachments: 0, missingAttachments: 0 };
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => z.object({ name: z.string() }).parse(row).name));
  const rows = <T>(table: string, schema: z.ZodType<T>): T[] => { if (!tables.has(table)) return []; if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid source table'); return db.prepare(`SELECT * FROM ${table}`).all().map(row => schema.parse(row)); };
  const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) { if (!/^[a-z_]+$/.test(table) || table === 'sqlite_sequence') continue; const records = rows(table, rowSchema); for (const [index, record] of records.entries()) store.put(`astrbotx-archive-${table}`, String(index), record); counts.archivedRows += records.length; }
    const attachments = new Map<string, ImportedAttachment>();
    for (const attachment of rows('attachments', OldAttachment)) {
      if (!files) { counts.missingAttachments++; continue; }
      try {
        const originalRoot = resolve(files.originalSourceRoot); const oldFile = resolve(originalRoot, attachment.path);
        if (!oldFile.startsWith(originalRoot + sep)) throw new Error('Attachment is outside source data');
        const archiveRoot = realpathSync(files.sourceRoot); const sourceFile = realpathSync(resolve(archiveRoot, relative(originalRoot, oldFile)));
        if (!sourceFile.startsWith(archiveRoot + sep)) throw new Error('Attachment symlink leaves archive');
        const info = statSync(sourceFile); if (!info.isFile()) throw new Error('Attachment is not a file');
        const id = `astrbotx:${key(attachment.attachment_id)}`; const directory = join(files.targetRoot, 'artifacts'); mkdirSync(directory, { recursive: true, mode: 0o700 });
        const file = join(directory, key(attachment.attachment_id)); copyFileSync(sourceFile, file); chmodSync(file, 0o600);
        const record = { id, name: basename(sourceFile), mimeType: attachment.mime_type, size: info.size };
        store.put('artifacts', id, { ...record, file }); attachments.set(attachment.attachment_id, record); counts.attachments++;
      } catch { counts.missingAttachments++; }
    }
    const now = Date.now();
    for (const kind of ['persona', 'conversation'] as const) { const id = `astrbotx-import-${kind}`; store.put('management-folders', id, FolderSchema.parse({ id, name: 'PriestessBot 历史导入', kind, revision: 1, createdAt: now, updatedAt: now })); }
    for (const folder of rows('persona_folders', OldFolder)) { const id = `astrbotx:${folder.folder_id}`; store.put('management-folders', id, FolderSchema.parse({ id, name: folder.name.slice(0, 120), kind: 'persona', parentId: folder.parent_id ? `astrbotx:${folder.parent_id}` : 'astrbotx-import-persona', revision: 1, createdAt: timestamp(folder.created_at), updatedAt: timestamp(folder.updated_at) })); counts.personaFolders++; }
    for (const persona of rows('personas', OldPersona)) {
      const id = `astrbotx:${persona.persona_id}`;
      const dialogs = persona.begin_dialogs ? z.array(z.string()).safeParse(parseAstrBotXJson(persona.begin_dialogs)) : undefined;
      const exampleDialogs = dialogs?.success ? dialogs.data.map((content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content })) : [];
      const personaTools = persona.tools ? z.array(z.string()).parse(parseAstrBotXJson(persona.tools)) : null;
      const personaSkills = persona.skills ? z.array(z.string()).parse(parseAstrBotXJson(persona.skills)) : null;
      store.put('management-personas', id, PersonaSchema.parse({ id, name: persona.persona_id.slice(0, 120), instructions: persona.system_prompt, exampleDialogs, tools: personaTools, skills: personaSkills, customErrorMessage: persona.custom_error_message ?? null, voicePrompt: persona.voice_prompt ?? null, folderId: persona.folder_id ? `astrbotx:${persona.folder_id}` : 'astrbotx-import-persona', revision: 1, createdAt: timestamp(persona.created_at), updatedAt: timestamp(persona.updated_at) })); counts.personas++;
      if (persona.persona_id === selectedPersonaId) store.put('management-persona-bindings', 'assistant', PersonaBindingSchema.parse({ agentId: 'assistant', personaId: id, revision: 1 }));
    }
    if (selectedPersonaId && !store.get('management-personas', `astrbotx:${selectedPersonaId}`, PersonaSchema)) throw new Error('Selected source persona was not found in database');
    const sessions = rows('platform_sessions', OldSession);
    const create = (id: string, ident: Identity, title: string, created: number, updated: number): void => { store.put('management-conversations', id, ConversationSchema.parse({ id, identity: JSON.stringify(['astrbotx-import', id]), sessionKey: JSON.stringify(['astrbotx-import', id]), platform: ident.platform, platformType: ident.platform === 'astrbotx:webchat' ? 'telegram' : 'napcat', sessionId: ident.sessionId, sessionType: ident.sessionType, ownerId: ident.ownerId, agentId: 'assistant', generation: 0, title: title.slice(0, 200) || 'PriestessBot 历史', folderId: 'astrbotx-import-conversation', archived: true, recovered: true, revision: 1, createdAt: created, updatedAt: updated })); };
    for (const conversation of rows('conversations', OldConversation)) {
      const id = `astrbotx:conversation:${conversation.conversation_id}`; const ident = identity(conversation.platform_id, conversation.user_id, sessions); const created = timestamp(conversation.created_at);
      create(id, ident, conversation.title ?? `${ident.sessionId} · Agent 历史`, created, timestamp(conversation.updated_at)); counts.conversations++;
      if (!conversation.content) continue;
      const messages = z.array(TextMessage).parse(parseAstrBotXJson(conversation.content));
      for (const [index, message] of messages.entries()) { if (message.role !== 'user' && message.role !== 'assistant') continue; const entryId = `${id}:${index}`; store.put('management-transcript', entryId, TranscriptEntrySchema.parse({ schemaVersion: 1, id: entryId, conversationId: id, runId: `astrbotx:archive:${id}`, role: message.role, senderId: message.role === 'assistant' ? 'assistant' : ident.ownerId, senderName: message.role === 'assistant' ? 'AstrBotX' : ident.ownerId, messageId: entryId, timestamp: created + index, parts: parts(message.content, attachments) })); counts.transcriptEntries++; }
    }
    const history = rows('platform_message_history', OldHistory);
    const grouped = new Map<string, z.infer<typeof OldHistory>[]>();
    for (const entry of history) { const group = JSON.stringify([entry.platform_id, entry.user_id]); const items = grouped.get(group) ?? []; items.push(entry); grouped.set(group, items); }
    for (const [group, items] of grouped) {
      const first = items[0]; if (!first) continue; const id = `astrbotx:platform:${key(group)}`; const ident = identity(first.platform_id, first.user_id, sessions);
      create(id, ident, `${ident.sessionId} · 平台原始记录`, Math.min(...items.map(item => timestamp(item.created_at))), Math.max(...items.map(item => timestamp(item.updated_at)))); counts.platformConversations++;
      for (const item of items) { const parsed = PlatformMessage.safeParse(parseAstrBotXJson(item.content)); if (!parsed.success || !['user', 'bot', 'assistant'].includes(parsed.data.type)) continue; const role = parsed.data.type === 'bot' || parsed.data.type === 'assistant' ? 'assistant' : 'user'; const entryId = `astrbotx:platform-message:${item.id}`; store.put('management-transcript', entryId, TranscriptEntrySchema.parse({ schemaVersion: 1, id: entryId, conversationId: id, runId: `astrbotx:archive:${id}`, role, senderId: item.sender_id ?? 'unknown-source-sender', senderName: item.sender_name ?? item.sender_id ?? '未知原始发送者', messageId: String(item.id), timestamp: timestamp(item.created_at), parts: parts(parsed.data.message, attachments) })); counts.platformMessages++; }
    }
    store.db.exec('COMMIT'); return counts;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}
