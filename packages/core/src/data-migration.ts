import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { KnowledgeDocumentSchema, MemoryRecordSchema, RuntimeConfigSchema, type RuntimeConfig } from '../../contracts/src/index.js';
import type { MigrationDiagnostic } from './migration.js';
import type { RuntimeStore } from './storage.js';

const LegacyMemory = z.object({ id: z.string(), library_id: z.string().default('default'), scope: z.string(), platform_id: z.string().nullable(), session_id: z.string().nullable(), user_id: z.string().nullable(), agent_name: z.string().nullable(), content: z.string(), confidence: z.number(), created_at: z.number(), updated_at: z.number(), expires_at: z.number().nullable(), deleted_at: z.number().nullable() });
const LegacyPersona = z.object({ id: z.string(), name: z.string(), description: z.string(), tone: z.string(), boundaries: z.string(), system_prompt_template: z.string(), example_dialogs: z.string().default('[]'), enabled: z.union([z.number(), z.boolean()]), agent_names: z.string(), error_messages: z.string().default('{}'), deleted_at: z.number().nullable() });
const LegacyKnowledge = z.object({ id: z.string(), name: z.string(), description: z.string(), created_at: z.number(), updated_at: z.number() });
const LegacyChunk = z.object({ id: z.string(), knowledge_base_id: z.string(), document_name: z.string(), content: z.string(), created_at: z.number() });
const LegacyConversation = z.object({ id: z.string(), platform: z.string(), session_id: z.string(), agent_id: z.string().default(''), created_at: z.number(), updated_at: z.number() });
const LegacyMessage = z.object({ id: z.string(), conversation_id: z.string(), role: z.string(), content: z.string().nullable(), tool_calls: z.string().nullable(), tool_call_id: z.string().nullable(), created_at: z.number() });
const NamedTable = z.object({ name: z.string() });
function parseLegacyJson(value: string): unknown { try { const parsed: unknown = JSON.parse(value); return parsed; } catch { return undefined; } }
export interface DataMigrationResult { readonly config: RuntimeConfig; readonly diagnostics: MigrationDiagnostic[]; readonly counts: Readonly<Record<'memories' | 'archivedMemories' | 'personas' | 'documents' | 'conversations' | 'messages', number>>; readonly backupPath?: string; }
export interface DataMigrationOptions { readonly apply?: boolean; readonly backupDirectory: string; readonly rowLimit?: number; readonly personaBindings?: Readonly<Record<string, string>>; readonly memorySessionTypes?: Readonly<Record<string, 'private' | 'group'>>; }

/** Read-only legacy source. Ambiguous ACL/history is archived instead of entering model-visible state. */
export async function importLegacyDatabase(sourcePath: string, store: RuntimeStore, config: RuntimeConfig, options: DataMigrationOptions): Promise<DataMigrationResult> {
  const source = resolve(sourcePath); const backupDirectory = resolve(options.backupDirectory);
  if (backupDirectory === dirname(source)) throw new Error('Database migration backup requires a separate directory');
  const database = new DatabaseSync(source, { readOnly: true });
  const diagnostics: MigrationDiagnostic[] = [];
  const counts = { memories: 0, archivedMemories: 0, personas: 0, documents: 0, conversations: 0, messages: 0 };
  let nextConfig = RuntimeConfigSchema.parse(config);
  const sourceKey = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const maxRows = Math.max(1, Math.min(100_000, options.rowLimit ?? 50_000));
  let backupPath: string | undefined;
  const note = (entity: string, message: string, severity: MigrationDiagnostic['severity'] = 'warning'): void => { diagnostics.push({ entity, message, severity }); };
  const put = (namespace: string, id: string, data: unknown): void => {
    if (!options.apply) return;
    // Repeated import never overwrites records edited after initial migration.
    if (store.get(namespace, id, z.unknown()) === undefined) store.put(namespace, id, data);
  };
  try {
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => NamedTable.parse(row).name));
    const rows = <T>(table: 'memory_records' | 'personas' | 'knowledge_bases' | 'knowledge_chunks' | 'conversations' | 'messages', schema: z.ZodType<T>): T[] => {
      if (!tables.has(table)) return [];
      const raw = database.prepare(`SELECT * FROM ${table} LIMIT ?`).all(maxRows + 1);
      if (raw.length > maxRows) throw new Error(`Legacy table ${table} exceeds ${maxRows} row budget; split the export before importing`);
      return raw.flatMap((row, index) => { const parsed = schema.safeParse(row); if (parsed.success) return [parsed.data]; note(`${table}/${index}`, `Row schema incompatible: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`, 'error'); return []; });
    };
    if (options.apply) {
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      backupPath = resolve(backupDirectory, `legacy-${sourceKey}-${Date.now()}.sqlite`);
      await backup(database, backupPath);
    }
    const memories = rows('memory_records', LegacyMemory);
    const personas = rows('personas', LegacyPersona);
    const libraries = rows('knowledge_bases', LegacyKnowledge);
    const chunks = rows('knowledge_chunks', LegacyChunk);
    const conversations = rows('conversations', LegacyConversation);
    const messages = rows('messages', LegacyMessage);
    if (options.apply) store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of memories) {
        const id = `legacy:${sourceKey}:${row.id}`;
        const candidates = nextConfig.agents.filter(agent => row.agent_name ? agent.id === row.agent_name : agent.resources.memoryLibraries.includes(row.library_id));
        const agent = candidates.length === 1 ? candidates[0] : undefined;
        const scope = row.scope === 'USER' ? 'sender' : row.scope === 'SESSION' ? 'session' : row.scope === 'AGENT' ? 'agent' : undefined;
        const sessionType = options.memorySessionTypes?.[row.id];
        if (agent === undefined || scope === undefined || sessionType === undefined || !row.platform_id || (scope !== 'agent' && !row.session_id) || (scope === 'sender' && !row.user_id) || row.deleted_at !== null || (row.expires_at !== null && row.expires_at <= Date.now())) {
          put('legacy-memory-archive', id, row); counts.archivedMemories += 1;
          note(`memory/${row.id}`, 'Memory archived: ambiguous identity/scope/session type, unavailable Agent, deleted or expired. Supply an explicit memorySessionTypes mapping for known records; archived data is excluded from live recall.'); continue;
        }
        const memory = MemoryRecordSchema.safeParse({ id, libraryId: row.library_id, agentId: agent.id, principal: { platform: row.platform_id, sessionId: row.session_id ?? 'legacy-agent-scope', senderId: row.user_id ?? 'legacy-shared', sessionType }, scope, text: row.content, source: `legacy-sqlite:${sourceKey}/memory/${row.id}`, confidence: row.confidence, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }) });
        if (!memory.success) { put('legacy-memory-archive', id, row); counts.archivedMemories += 1; note(`memory/${row.id}`, 'Memory validation failed; raw record archived.', 'error'); continue; }
        put('memories', id, memory.data); counts.memories += 1;
      }
      for (const row of personas) {
        put('legacy-personas', `legacy:${sourceKey}:${row.id}`, row); counts.personas += 1;
        if (!row.enabled || row.deleted_at !== null) continue;
        const names = z.array(z.string()).safeParse(parseLegacyJson(row.agent_names));
        if (!names.success) { note(`persona/${row.id}`, 'Persona Agent bindings are malformed; persona remains archived.'); continue; }
        const errors = z.record(z.string(), z.string()).safeParse(parseLegacyJson(row.error_messages));
        nextConfig = { ...nextConfig, agents: nextConfig.agents.map(agent => {
          const explicit = options.personaBindings?.[agent.id];
          if (explicit !== row.id && (explicit !== undefined || !names.data.includes(agent.id))) return agent;
          const text = [row.description, row.tone, row.boundaries, row.system_prompt_template].filter(Boolean).join('\n\n');
          return { ...agent, persona: text, permissionDenied: errors.success ? errors.data.permissionDenied ?? errors.data.PERMISSION_DENIED ?? agent.permissionDenied : agent.permissionDenied };
        }) };
      }
      for (const library of libraries) if (!nextConfig.knowledgeLibraries.some(item => item.id === library.id)) nextConfig = { ...nextConfig, knowledgeLibraries: [...nextConfig.knowledgeLibraries, { id: library.id, displayName: library.name }] };
      const documents = new Map<string, z.infer<typeof LegacyChunk>[]>();
      for (const chunk of chunks) { const key = JSON.stringify([chunk.knowledge_base_id, chunk.document_name]); const group = documents.get(key) ?? []; group.push(chunk); documents.set(key, group); }
      for (const [key, documentChunks] of documents) {
        const first = documentChunks[0]; if (first === undefined) continue;
        const id = `legacy:${sourceKey}:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
        const document = KnowledgeDocumentSchema.parse({ id, libraryId: first.knowledge_base_id, name: first.document_name, mimeType: 'text/plain', version: 0, status: 'pending', chunkCount: documentChunks.length, createdAt: first.created_at, updatedAt: first.created_at });
        put('knowledge-documents', id, document); put('knowledge-source', id, documentChunks.map(chunk => ({ text: chunk.content }))); counts.documents += 1;
      }
      for (const conversation of conversations) { put('legacy-conversations', `legacy:${sourceKey}:${conversation.id}`, conversation); counts.conversations += 1; }
      for (const message of messages) { put('legacy-messages', `legacy:${sourceKey}:${message.id}`, message); counts.messages += 1; }
      if (conversations.length > 0) note('conversations', 'Application history retained in management-only archive. Legacy messages have no trusted sender authorization domain; they are not replayed into SDK sessions.');
      if (documents.size > 0) note('knowledge', 'Document text preserved as pending import. Assign authorized library bindings and rebuild embeddings before retrieval.');
      if (tables.has('reminder_records')) note('reminders', 'Legacy scheduled reminders are preserved in the database backup and not replayed; delivery certainty must be reviewed.');
      if (options.apply) store.db.exec('COMMIT');
    } catch (error) { if (options.apply) store.db.exec('ROLLBACK'); throw error; }
    return { config: RuntimeConfigSchema.parse(nextConfig), diagnostics, counts, ...(backupPath === undefined ? {} : { backupPath }) };
  } finally { database.close(); }
}
