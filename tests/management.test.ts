import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDefinitionSchema, MessageEventSchema } from '../packages/contracts/src/index.js';
import { ConversationExportSchema, FolderSchema } from '../packages/contracts/src/management.js';
import { ManagementService, ManagementError } from '../packages/core/src/management.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { conversationKey } from '../packages/core/src/authorization.js';
const message = MessageEventSchema.parse({ platform: 'tg', platformType: 'telegram', sessionId: '42', sessionType: 'group', senderId: 'alice', senderName: 'Alice', messageId: 'm1', botId: 'bot', timestamp: 100, parts: [{ type: 'text', text: 'Remember the green room' }, { type: 'quote', messageId: 'q1', text: 'quoted' }] });
function setup(): { store: RuntimeStore; service: ManagementService } { const store = new RuntimeStore(':memory:'); return { store, service: new ManagementService(store) }; }
void test('personas and folders enforce revision, folder kind, cycles and bound deletion', () => {
  const { store, service } = setup();
  try { const root = service.saveFolder({ name: 'Characters', kind: 'persona' }); const child = service.saveFolder({ name: 'Friends', kind: 'persona', parentId: root.id }); const sessions = FolderSchema.parse({ id: 'old-chat-folder', name: 'Chats', kind: 'conversation', revision: 1, createdAt: 1, updatedAt: 1 }); store.put('management-folders', sessions.id, sessions);
    assert.throws(() => service.saveFolder({ name: 'Chats', kind: 'conversation' }), /不再使用分组/); assert.deepEqual(service.folders('conversation'), []);
    assert.throws(() => service.saveFolder({ name: 'Cycle', kind: 'persona', parentId: child.id }, root.id, root.revision), /cycle/);
    assert.throws(() => service.saveFolder({ name: 'wrong kind', kind: 'persona', parentId: sessions.id }), /different kind/);
    assert.throws(() => service.deleteFolder(root.id, root.revision), /contents/);
    const persona = service.savePersona({ name: 'Gardener', instructions: 'Respond with calm precision', folderId: child.id });
    assert.throws(() => service.savePersona({ name: 'bad', instructions: '', folderId: sessions.id }), /different kind/);
    assert.throws(() => service.savePersona({ name: 'stale', instructions: '' }, persona.id, 0), /changed/);
    const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', instructions: 'Base rules', persona: 'Inline' }); const binding = service.bindPersona(agent.id, persona.id, 0);
    assert.equal(service.resolveAgent(agent).persona, persona.instructions); assert.equal(service.resolveAgent(agent).instructions, 'Base rules');
    assert.throws(() => service.deletePersona(persona.id, persona.revision), /Unbind/);
    assert.throws(() => service.bindPersona(agent.id, null, 0), /changed/);
    service.bindPersona(agent.id, null, binding.revision); service.deletePersona(persona.id, persona.revision); assert.equal(service.resolveAgent(agent).persona, 'Inline'); service.deleteFolder(child.id, child.revision); service.deleteFolder(root.id, root.revision);
  } finally { store.close(); }
});
void test('conversation identities retain platform/chat/Agent/generation, sender provenance and idempotent transcript', () => {
  const { store, service } = setup(); const key = conversationKey(message, 'agent');
  try { const first = service.captureInbound(message, 'agent', 0, 'r1', key); assert.ok(first); service.captureInbound(message, 'agent', 0, 'r1', key); service.captureInbound({ ...message, senderId: 'bob', messageId: 'm2', timestamp: 200 }, 'agent', 0, 'r2', key); service.captureReply('r2', [{ type: 'text', text: 'Understood' }]);
    const detail = service.detail(first.id); assert.equal(detail.entries.length, 3); assert.equal(detail.conversation.ownerId, 'alice'); assert.deepEqual(detail.entries.filter(e => e.role === 'user').map(e => e.senderId), ['alice', 'bob']);
    const privateMessage = { ...message, sessionType: 'private' as const }; const privateConversation = service.captureInbound(privateMessage, 'agent', 0, 'private', conversationKey(privateMessage, 'agent')); const nextGeneration = service.captureInbound(message, 'agent', 1, 'next', key); const otherAgent = service.captureInbound(message, 'other', 0, 'other', conversationKey(message, 'other')); assert.ok(privateConversation); assert.ok(nextGeneration); assert.ok(otherAgent); assert.equal(new Set([first.id, privateConversation.id, nextGeneration.id, otherAgent.id]).size, 4);
    assert.equal(service.conversations({ search: 'understood' }).length, 1);
    const changed = service.patchConversation(first.id, { title: 'Room discussion', folderId: 'retired-folder', archived: true, expectedRevision: first.revision }); assert.equal(changed.folderId, null); assert.equal(service.conversations({ archived: 'true', folderId: 'unrelated-old-filter' })[0]?.title, 'Room discussion'); assert.throws(() => service.patchConversation(first.id, { title: 'stale', archived: false, expectedRevision: first.revision }), /changed/);
    const exportData = ConversationExportSchema.parse({ ...service.detail(changed.id), format: 'priestess-conversation-v1', exportedAt: Date.now() }); assert.equal(exportData.entries[0]?.parts[1]?.type, 'quote');
  } finally { store.close(); }
});

void test('NapCat group and private conversations are identifiable, searchable and unaffected by legacy folder filters', () => {
  const { store, service } = setup();
  try {
    const group = MessageEventSchema.parse({ ...message, platform: 'qq-bot', platformType: 'napcat', sessionName: '研发群', parts: [{ type: 'text', text: 'A long first request should not become the group title' }] });
    const conversation = service.captureInbound(group, 'agent', 0, 'qq-group', conversationKey(group, 'agent')); assert.ok(conversation);
    store.put('management-conversations', conversation.id, { ...conversation, folderId: 'legacy-group', title: 'Old first request' });
    const listed = service.conversations({ folderId: '', search: '研发群' }); assert.equal(listed.length, 1); assert.equal(listed[0]?.folderId, null); assert.equal(listed[0]?.title, 'QQ · 群聊 · 研发群 (42)');
    const direct = MessageEventSchema.parse({ ...group, sessionType: 'private', sessionName: undefined, senderName: 'Alice' });
    const privateConversation = service.captureInbound(direct, 'agent', 0, 'qq-private', conversationKey(direct, 'agent')); assert.ok(privateConversation); assert.equal(privateConversation.title, 'QQ · 私聊 · Alice (42)');
    const archived = service.patchConversation(conversation.id, { title: '自定义名称', archived: true, expectedRevision: conversation.revision });
    const active = service.captureInbound({ ...group, messageId: 'fresh' }, 'agent', 0, 'qq-next', conversation.sessionKey); assert.ok(active); assert.equal(active.archived, false); assert.equal(active.title, '自定义名称'); assert.equal(active.revision, archived.revision + 1); assert.ok(service.conversations().some(item => item.id === active.id));
  } finally { store.close(); }
});

void test('recovery ignores untriggered traffic, rejected and duplicate requests, mismatched Agents and delegated runs', () => {
  const { store, service } = setup();
  try {
    const key = conversationKey(message, 'agent');
    const make = (id: string, agentId: string, sessionKey = key): void => store.saveRun({ id, agentId, sessionKey, senderId: 'alice', generation: 0, status: 'completed', createdAt: 1, updatedAt: 2, summary: '' });
    make('chatter', '', conversationKey(message, 'none')); make('mismatch', 'other');
    make('rejected', 'agent'); store.put('flow-traces', 'rejected', { outcome: 'rejected' });
    make('duplicate', 'agent'); store.put('flow-traces', 'duplicate', { outcome: 'ignored' });
    make('command', 'agent'); store.put('flow-traces', 'command', { outcome: 'command' });
    make('accepted', 'agent'); store.put('flow-traces', 'accepted', { outcome: 'agent' });
    store.saveRun({ id: 'child', parentRunId: 'accepted', agentId: 'agent', sessionKey: key, senderId: 'alice', generation: 0, status: 'completed', createdAt: 1, updatedAt: 2, summary: '' });
    service.recoverRuns(); const conversations = service.conversations(); assert.equal(conversations.length, 1); const conversation = conversations[0]; assert.ok(conversation); assert.deepEqual(service.detail(conversation.id).runIds.toSorted(), ['accepted', 'command']);
  } finally { store.close(); }
});
void test('deletion tombstones late writes, cancels only live runs and permits a fresh generation', () => {
  const { store, service } = setup(); const key = conversationKey(message, 'agent');
  try { const conversation = service.captureInbound(message, 'agent', 0, 'live', key); assert.ok(conversation); service.captureInbound({ ...message, messageId: 'm2' }, 'agent', 0, 'done', key);
    for (const [id, status] of [['live', 'running'], ['done', 'completed']] as const) store.saveRun({ id, status, sessionKey: key, agentId: 'agent', senderId: 'alice', generation: 0, createdAt: 100, updatedAt: 100, summary: '' });
    const cancelled: string[] = []; service.deleteConversation(conversation.id, conversation.revision, id => cancelled.push(id)); assert.deepEqual(cancelled, ['live']); assert.equal(store.generation(key), 1); service.captureReply('live', [{ type: 'text', text: 'late result' }]); assert.equal(service.captureInbound(message, 'agent', 0, 'late', key), undefined); assert.equal(service.conversations({ archived: 'all' }).length, 0); assert.throws(() => service.detail(conversation.id), ManagementError);
    const fresh = service.captureInbound({ ...message, messageId: 'new' }, 'agent', store.generation(key), 'newrun', key); assert.ok(fresh); assert.notEqual(fresh.id, conversation.id); service.recoverRuns(); assert.equal(service.conversations().length, 1);
  } finally { store.close(); }
});
void test('durable chat survives restart and legacy recovery does not invent messages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-management-')); const database = join(directory, 'runtime.sqlite');
  try { const first = new RuntimeStore(database); const service = new ManagementService(first); const conversation = service.createWebConversation('agent', 'Saved chat'); assert.ok(conversation.lastMessage); service.captureInbound({ ...conversation.lastMessage, parts: [{ type: 'text', text: 'Saved request' }] }, 'agent', 0, 'web-run', conversation.sessionKey); service.captureReply('web-run', [{ type: 'text', text: 'Saved answer' }]); first.saveRun({ id: 'legacy', sessionKey: conversationKey(message, 'agent'), agentId: 'agent', senderId: 'alice', generation: 0, status: 'completed', createdAt: 10, updatedAt: 20, summary: 'Old execution summary' }); first.close();
    const reopened = new RuntimeStore(database); try { const restored = new ManagementService(reopened); restored.recoverRuns(); assert.equal(restored.detail(conversation.id).entries.length, 2); const legacy = restored.conversations().find(c => c.recovered); assert.ok(legacy); assert.equal(restored.detail(legacy.id).entries.length, 0); assert.deepEqual(restored.detail(legacy.id).runIds, ['legacy']); assert.equal(restored.detail(conversation.id).conversation.lastMessage?.senderId, 'dashboard-user'); } finally { reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

void test('transcript archives artifact references without duplicating model data URLs or extracted document text', () => {
  const { store, service } = setup(); try { const media = MessageEventSchema.parse({ ...message, parts: [{ type: 'image', url: 'data:image/png;base64,AAAA', artifactId: 'image-1', mimeType: 'image/png' }, { type: 'file', url: 'artifact:doc-1', artifactId: 'doc-1', name: 'doc.txt', mimeType: 'text/plain', extractedText: 'private huge extraction' }] }); const conversation = service.captureInbound(media, 'agent', 0, 'media', conversationKey(media, 'agent')); assert.ok(conversation); const archived = JSON.stringify(service.detail(conversation.id)); assert.ok(archived.includes('artifact:image-1')); assert.ok(!archived.includes('base64')); assert.ok(!archived.includes('private huge extraction')); assert.ok(JSON.stringify(media).includes('base64'), 'Model input remains unchanged'); } finally { store.close(); }
});

void test('persona examples validate ordered pairs and persona selections can only narrow Agent tools and skills', () => {
  const { store, service } = setup();
  try {
    const persona = service.savePersona({ name: 'Example persona', instructions: 'Persona rules', exampleDialogs: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }], tools: ['memory_recall', 'forbidden_tool'], skills: ['allowed', 'other'], customErrorMessage: 'Please try later.', voicePrompt: 'Retained voice metadata' });
    const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', capabilities: ['chat'], resources: { tools: ['memory_recall', 'knowledge_search'], skills: ['library'] }, skillAllowlist: ['allowed'] });
    service.bindPersona(agent.id, persona.id, 0);
    const resolved = service.resolveAgent(agent);
    assert.deepEqual(resolved.resources.tools, ['memory_recall']); assert.deepEqual(resolved.resources.skills, ['library']); assert.deepEqual(resolved.skillAllowlist, ['allowed']);
    assert.deepEqual(resolved.capabilities, ['chat']); assert.deepEqual(resolved.exampleDialogs, persona.exampleDialogs); assert.equal(resolved.customErrorMessage, 'Please try later.'); assert.equal(resolved.voicePrompt, 'Retained voice metadata');
    const disabled = service.savePersona({ name: 'Disabled', instructions: '', tools: [], skills: [] }, persona.id, persona.revision);
    assert.deepEqual(service.resolveAgent(agent).resources.tools, []); assert.deepEqual(service.resolveAgent(agent).resources.skills, []);
    service.savePersona({ name: 'Inherited', instructions: '', tools: null, skills: null }, persona.id, disabled.revision);
    assert.deepEqual(service.resolveAgent(agent).resources, agent.resources); assert.deepEqual(service.resolveAgent(agent).skillAllowlist, agent.skillAllowlist);
    assert.throws(() => service.savePersona({ name: 'Odd', instructions: '', exampleDialogs: [{ role: 'user', content: 'unpaired' }] }), /alternate/);
    assert.throws(() => service.savePersona({ name: 'Wrong order', instructions: '', exampleDialogs: [{ role: 'assistant', content: 'first' }, { role: 'user', content: 'last' }] }), /alternate/);
    assert.throws(() => service.savePersona({ name: 'Empty', instructions: '', exampleDialogs: [{ role: 'user', content: ' ' }, { role: 'assistant', content: 'last' }] }));
  } finally { store.close(); }
});

void test('archiving quoted media strips embedded bytes and extracted content while preserving source labels', () => {
  const store = new RuntimeStore(':memory:'); const service = new ManagementService(store);
  try {
    const message = MessageEventSchema.parse({platform:'qq',platformType:'napcat',sessionType:'group',sessionId:'g',senderId:'alice',messageId:'m',timestamp:Date.now(),botId:'bot',parts:[{type:'quote',messageId:'old',senderId:'bob',attachments:[{type:'image',url:'data:image/png;base64,AAAA',mimeType:'image/png'},{type:'file',url:'https://example.org/notes.txt',name:'notes.txt',mimeType:'text/plain',extractedText:'EXTRACTED_PRIVATE_TEST'}],forwardedSources:[{attachmentIndex:1,senderId:'carol'}]}]});
    const conversation=service.captureInbound(message,'a',0,'run','scope');assert.ok(conversation);const entries=service.detail(conversation.id).entries;
    assert.doesNotMatch(JSON.stringify(entries),/base64|EXTRACTED_PRIVATE_TEST/);const quote=entries[0]?.parts[0];assert.ok(quote?.type==='quote');assert.equal(quote.senderId,'bob');assert.equal(quote.forwardedSources?.[0]?.attachmentIndex,0);assert.equal(quote.forwardedSources?.[0]?.senderId,'carol');assert.match(quote.text??'',/未存档/);
  } finally { store.close(); }
});
