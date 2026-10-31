import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MessageEventSchema, type AgentDefinition, type MessageEvent, type ContentPart } from '../../contracts/src/index.js';
import { ConversationSchema, ConversationPatchSchema, FolderInputSchema, FolderSchema, PersonaBindingSchema, PersonaInputSchema, PersonaSchema, TranscriptEntrySchema, type Conversation, type FolderKind, type ManagedFolder, type Persona, type PersonaBinding, type TranscriptEntry } from '../../contracts/src/management.js';
import { conversationKey } from './authorization.js';
import { ConversationHistoryResetSchema, conversationHistoryResetNamespace } from './conversation-history.js';
import type { RuntimeStore } from './storage.js';
const LinkSchema = z.object({ runId: z.string(), conversationId: z.string() });
const TombstoneSchema = z.object({ id: z.string(), deletedAt: z.number() });
export class ManagementError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function conflict(actual: number, expected: number): void { if (actual !== expected) throw new ManagementError(409, 'Resource changed; reload before saving'); }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function conversationTitle(message: MessageEvent): string {
  if (message.platform === 'dashboard') return message.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 120) || '新会话';
  const name = message.sessionName?.trim() || (message.sessionType === 'private' ? message.senderName.trim() : '');
  const platform = message.platformType === 'napcat' ? 'QQ' : message.platformType === 'telegram' ? 'Telegram' : '微信';
  return `${platform} · ${message.sessionType === 'group' ? '群聊' : '私聊'} · ${name ? `${name.slice(0, 100)} (${message.sessionId})` : message.sessionId}`.slice(0, 200);
}
function flatConversation(conversation: Conversation): Conversation {
  return { ...conversation, folderId: null, ...(conversation.platform !== 'dashboard' && conversation.revision === 1 && conversation.lastMessage ? { title: conversationTitle(conversation.lastMessage) } : {}) };
}
function archiveParts(parts: readonly ContentPart[]): ContentPart[] {
  return parts.map((part): ContentPart => {
    if(part.type==='quote'&&part.attachments){
      const attachments:NonNullable<typeof part.attachments>=[];const forwardedSources:NonNullable<typeof part.forwardedSources>=[];const omitted:string[]=[];
      for(const [index,attachment] of part.attachments.entries()){
        const archived=archiveParts([attachment])[0];
        if(archived?.type==='image'||archived?.type==='file'){const source=part.forwardedSources?.find(item=>item.attachmentIndex===index);if(source)forwardedSources.push({...source,attachmentIndex:attachments.length});attachments.push(archived);}
        else if(archived?.type==='text')omitted.push(archived.text);
      }
      return {...part,attachments,...(part.forwardedSources===undefined?{}:{forwardedSources}),...(omitted.length?{text:[part.text??'',...omitted].join('\n'),availability:'partial',unavailableReason:'media_unavailable'}:{})};
    }
    if (part.type !== 'image' && part.type !== 'file') return part;
    const url = part.artifactId ? `artifact:${part.artifactId}` : part.url;
    if (url.startsWith('data:') || url.length > 8192) return { type: 'text', text: part.type === 'image' ? '[图片未存档]' : `[附件未存档：${part.name}]` };
    if (part.type === 'file') { const { extractedText: _extractedText, ...metadata } = part; void _extractedText; return { ...metadata, url }; }
    return { ...part, url };
  });
}
export class ManagementService {
  constructor(readonly store: RuntimeStore) {}
  folders(kind?: FolderKind): ManagedFolder[] { return this.store.list('management-folders', FolderSchema).filter(f => f.kind !== 'conversation' && (!kind || f.kind === kind)); }
  private folder(id: string | null, kind: FolderKind): void { if (id === null) return; const item = this.store.get('management-folders', id, FolderSchema); if (!item || item.kind !== kind) throw new ManagementError(400, 'Folder does not exist or has a different kind'); }
  saveFolder(input: z.input<typeof FolderInputSchema>, id?: string, expectedRevision = 0): ManagedFolder {
    const data = FolderInputSchema.parse(input); if (data.kind === 'conversation') throw new ManagementError(400, '会话不再使用分组。请在会话列表中管理。'); this.folder(data.parentId, data.kind);
    const old = id ? this.store.get('management-folders', id, FolderSchema) : undefined;
    if (id && !old) throw new ManagementError(404, 'Folder not found');
    if (old) { conflict(old.revision, expectedRevision); if (old.kind !== data.kind) throw new ManagementError(400, 'Folder kind cannot change'); }
    let parentId = data.parentId; const seen = new Set<string>();
    while (parentId) { if (parentId === id || seen.has(parentId)) throw new ManagementError(400, 'Folder cycle is not allowed'); seen.add(parentId); parentId = this.store.get('management-folders', parentId, FolderSchema)?.parentId ?? null; }
    const item = FolderSchema.parse({ ...data, id: id ?? randomUUID(), revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() }); this.store.put('management-folders', item.id, item); return item;
  }
  deleteFolder(id: string, expectedRevision: number): void {
    const item = this.store.get('management-folders', id, FolderSchema); if (!item) throw new ManagementError(404, 'Folder not found'); conflict(item.revision, expectedRevision);
    if (this.folders().some(f => f.parentId === id) || this.personas().some(p => p.folderId === id) || this.conversations({ archived: 'all' }).some(c => c.folderId === id)) throw new ManagementError(409, 'Move folder contents before deleting'); this.store.delete('management-folders', id);
  }
  personas(): Persona[] { return this.store.list('management-personas', PersonaSchema); }
  bindings(): PersonaBinding[] { return this.store.list('management-persona-bindings', PersonaBindingSchema); }
  savePersona(input: z.input<typeof PersonaInputSchema>, id?: string, expectedRevision = 0): Persona {
    const data = PersonaInputSchema.parse(input); this.folder(data.folderId, 'persona'); const old = id ? this.store.get('management-personas', id, PersonaSchema) : undefined;
    if (id && !old) throw new ManagementError(404, 'Persona not found'); if (old) conflict(old.revision, expectedRevision);
    const item = PersonaSchema.parse({ ...data, id: id ?? randomUUID(), revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() }); this.store.put('management-personas', item.id, item); return item;
  }
  bindPersona(agentId: string, personaId: string | null, expectedRevision: number): PersonaBinding {
    if (personaId && !this.store.get('management-personas', personaId, PersonaSchema)) throw new ManagementError(404, 'Persona not found'); const old = this.store.get('management-persona-bindings', agentId, PersonaBindingSchema); conflict(old?.revision ?? 0, expectedRevision);
    const binding = PersonaBindingSchema.parse({ agentId, personaId, revision: expectedRevision + 1 }); this.store.put('management-persona-bindings', agentId, binding); return binding;
  }
  deletePersona(id: string, expectedRevision: number): void { const item = this.store.get('management-personas', id, PersonaSchema); if (!item) throw new ManagementError(404, 'Persona not found'); conflict(item.revision, expectedRevision); if (this.bindings().some(b => b.personaId === id)) throw new ManagementError(409, 'Unbind this persona from Agents before deleting'); this.store.delete('management-personas', id); }
  resolveAgent(agent: AgentDefinition, personaOverride?: string | null): AgentDefinition { const binding = this.store.get('management-persona-bindings', agent.id, PersonaBindingSchema); const personaId = personaOverride === undefined ? binding?.personaId : personaOverride; const persona = personaId ? this.store.get('management-personas', personaId, PersonaSchema) : undefined; if (personaOverride && !persona) throw new ManagementError(404, 'Persona not found'); if (!persona) return agent;
    const skillAllowlist = persona.skills === null ? agent.skillAllowlist : agent.skillAllowlist === null ? persona.skills : persona.skills.filter(name => agent.skillAllowlist?.includes(name));
    return { ...agent, persona: persona.instructions, exampleDialogs: persona.exampleDialogs, customErrorMessage: persona.customErrorMessage, voicePrompt: persona.voicePrompt, skillAllowlist, resources: { ...agent.resources, tools: persona.tools === null ? agent.resources.tools : agent.resources.tools.filter(name => persona.tools?.includes(name)), skills: skillAllowlist?.length === 0 ? [] : agent.resources.skills } }; }
  conversations(filter: { search?: string; folderId?: string; archived?: 'all' | 'true' | 'false' } = {}): Conversation[] {
    const term = filter.search?.toLocaleLowerCase(); const entries = term ? this.store.list('management-transcript', TranscriptEntrySchema) : [];
    return this.store.list('management-conversations', ConversationSchema).map(flatConversation).filter(c => (filter.archived === 'all' || c.archived === (filter.archived === 'true')) && (!term || `${c.title} ${c.platform} ${c.sessionId} ${c.ownerId} ${c.lastMessage?.sessionName ?? ''}`.toLocaleLowerCase().includes(term) || entries.some(e => e.conversationId === c.id && e.parts.some(p => p.type === 'text' && p.text.toLocaleLowerCase().includes(term))))).sort((a,b) => b.updatedAt - a.updatedAt);
  }
  detail(id: string): { conversation: Conversation; entries: TranscriptEntry[]; runIds: string[] } { const conversation = this.store.get('management-conversations', id, ConversationSchema); if (!conversation) throw new ManagementError(404, 'Conversation not found'); const runs = new Map(this.store.runs().map(run => [run.id, run.createdAt])); return { conversation: flatConversation(conversation), entries: this.store.list('management-transcript', TranscriptEntrySchema).filter(e => e.conversationId === id).sort((a,b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)), runIds: this.store.list('management-run-links', LinkSchema).filter(l => l.conversationId === id).map(l => l.runId).sort((a,b) => (runs.get(a) ?? 0) - (runs.get(b) ?? 0)) }; }
  createWebConversation(agentId: string, title = '新会话'): Conversation { const message = MessageEventSchema.parse({ platform: 'dashboard', platformType: 'telegram', sessionId: randomUUID(), sessionType: 'private', senderId: 'dashboard-user', senderName: 'Dashboard', messageId: randomUUID(), timestamp: Date.now(), parts: [], botId: 'dashboard' }); const item = this.ensure(message, agentId, 0, conversationKey(message, agentId)); if (!item) throw new ManagementError(409, 'Conversation was deleted'); return this.patchConversation(item.id, { title, folderId: null, archived: false, expectedRevision: item.revision }); }
  private ensure(input: MessageEvent, agentId: string, generation: number, sessionKey: string): Conversation | undefined {
    if (generation < (this.store.get(conversationHistoryResetNamespace, sessionKey, ConversationHistoryResetSchema)?.minimumGeneration ?? 0)) return undefined;
    const message = { ...input, parts: archiveParts(input.parts) };
    const identity = JSON.stringify([message.platform, message.sessionType, message.sessionId, agentId, generation]); const id = digest(identity); if (this.store.get('management-tombstones', id, TombstoneSchema)) return undefined;
    const old = this.store.get('management-conversations', id, ConversationSchema); const now = Date.now();
    const item = ConversationSchema.parse(old ? { ...flatConversation(old), lastMessage: message, title: old.revision === 1 ? conversationTitle(message) : old.title, archived: false, recovered: false, revision: old.revision + (old.archived ? 1 : 0), updatedAt: now } : { id, identity, sessionKey, revision: 1, createdAt: now, updatedAt: now, platform: message.platform, platformType: message.platformType, sessionId: message.sessionId, sessionType: message.sessionType, agentId, generation, ownerId: message.senderId, title: conversationTitle(message), folderId: null, archived: false, lastMessage: message }); this.store.put('management-conversations', id, item); return item;
  }
  captureInbound(message: MessageEvent, agentId: string, generation: number, runId: string, sessionKey: string): Conversation | undefined {
    const conversation = this.ensure(message, agentId, generation, sessionKey); if (!conversation) return undefined;
    this.store.put('management-run-links', runId, { runId, conversationId: conversation.id });
    const id = digest(JSON.stringify([conversation.id, 'user', message.senderId, message.messageId])); const entry = TranscriptEntrySchema.parse({ schemaVersion: 1, id, conversationId: conversation.id, runId, role: 'user', senderId: message.senderId, senderName: message.senderName, messageId: message.messageId, timestamp: message.timestamp, parts: archiveParts(message.parts) }); this.store.put('management-transcript', id, entry); return conversation;
  }
  captureReply(runId: string, parts: readonly ContentPart[]): void { const link = this.store.get('management-run-links', runId, LinkSchema); if (!link || this.store.get('management-tombstones', link.conversationId, TombstoneSchema)) return; const conversation = this.store.get('management-conversations', link.conversationId, ConversationSchema); if (!conversation) return;
    const id = digest(`${runId}:assistant`); const entry = TranscriptEntrySchema.parse({ schemaVersion: 1, id, conversationId: conversation.id, runId, role: 'assistant', senderId: conversation.agentId, senderName: conversation.agentId, messageId: `${runId}:reply`, timestamp: Date.now(), parts: archiveParts(parts) }); this.store.put('management-transcript', id, entry); this.store.put('management-conversations', conversation.id, { ...conversation, updatedAt: Date.now() });
  }
  patchConversation(id: string, input: z.input<typeof ConversationPatchSchema>): Conversation { const data = ConversationPatchSchema.parse(input); const { conversation } = this.detail(id); conflict(conversation.revision, data.expectedRevision); const item = { ...conversation, title: data.title, folderId: null, archived: data.archived, revision: conversation.revision + 1, updatedAt: Date.now() }; this.store.put('management-conversations', id, item); return item; }
  cancelConversation(id: string, cancelRun: (runId: string) => void): void { const { runIds } = this.detail(id); for (const run of this.store.runs()) { if (runIds.includes(run.id) && ['running','queued','paused'].includes(run.status)) cancelRun(run.id); } }
  deleteConversation(id: string, expectedRevision: number, cancelRun: (runId: string) => void): void { const { conversation, entries, runIds } = this.detail(id); conflict(conversation.revision, expectedRevision); this.store.put('management-tombstones', id, { id, deletedAt: Date.now() }); for (const runId of runIds) { const run = this.store.runs().find(r => r.id === runId); if (run && ['running', 'queued', 'paused'].includes(run.status)) cancelRun(runId); } for (const entry of entries) this.store.delete('management-transcript', entry.id); for (const runId of runIds) this.store.delete('management-run-links', runId); this.store.delete('management-conversations', id); if (this.store.generation(conversation.sessionKey) === conversation.generation) this.store.reset(conversation.sessionKey); }
  recoverRuns(): void {
    for (const run of this.store.runs()) { if (run.parentRunId || !run.agentId.trim() || this.store.get('management-run-links', run.id, LinkSchema)) continue;
      if (run.generation < (this.store.get(conversationHistoryResetNamespace, run.sessionKey, ConversationHistoryResetSchema)?.minimumGeneration ?? 0)) continue;
      const trace = this.store.get('flow-traces', run.id, z.object({ outcome: z.enum(['agent', 'command', 'ignored', 'rejected']) }));
      if (trace && trace.outcome !== 'agent' && trace.outcome !== 'command') continue;
      let raw: unknown; try { raw = JSON.parse(run.sessionKey); } catch { continue; } const key = z.tuple([z.string(), z.enum(['private','group']), z.string(), z.string()]).safeParse(raw); if (!key.success || key.data[3] !== run.agentId) continue;
      const [platform, sessionType, sessionId, agentId] = key.data; const identity = JSON.stringify([platform, sessionType, sessionId, agentId, run.generation]); const id = digest(identity); if (this.store.get('management-tombstones', id, TombstoneSchema)) continue;
      if (!this.store.get('management-conversations', id, ConversationSchema)) { const platformConfig = this.store.getConfig()?.platforms.find(p => p.id === platform); const item = ConversationSchema.parse({ id, identity, sessionKey: run.sessionKey, platform, platformType: platformConfig?.type ?? 'telegram', sessionId, sessionType, agentId, generation: run.generation, ownerId: run.senderId, title: `${platform} · ${sessionId}`, revision: 1, createdAt: run.createdAt, updatedAt: run.updatedAt, recovered: true }); this.store.put('management-conversations', id, item); }
      this.store.put('management-run-links', run.id, { runId: run.id, conversationId: id });
    }
  }
}
