import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { RunContext } from '@openai/agents';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, PlatformConfigSchema, RunIdSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { QQ_TOOLS, QqFileSettingsSchema, QqFileArgs } from '../packages/contracts/src/plugins/qq-file.js';
import { AuthorizationService } from '../packages/core/src/authorization.js';
import { QqFileService, matchesFilePattern } from '../packages/adapters/src/plugins/qq-file.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore } from '../packages/adapters/src/platforms/transport.js';
import type { NapCatAction, NapCatActionResult } from '../packages/adapters/src/platforms/napcat-actions.js';

function fixture(reply: (action: NapCatAction) => Promise<NapCatActionResult>, senior = false) {
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', capabilities: ['chat', 'files.read', 'external.write'], resources: { tools: [...QQ_TOOLS] }, approvalTools: ['qq_delete_folder'] });
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: '123', sessionType: 'group', senderId: 'alice', messageId: 'msg', botId: 'bot', timestamp: 1, parts: [{ type: 'text', text: 'list files' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
  const auth = new AuthorizationService(senior ? [GrantSchema.parse({ ...principal, maximumState: 'senior_operator', defaultState: 'senior_operator', capabilities: agent.capabilities, resources: agent.resources })] : []);
  const controller = new AbortController(); const context = { runId: RunIdSchema.parse('qq-run'), turnId: 't', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: controller.signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 's' } };
  let settings = QqFileSettingsSchema.parse({ enabled: true }); const calls: NapCatAction[] = []; const uploads: string[] = [];
  const service = new QqFileService({ settings: () => settings, auth, adapter: () => ({ executeKnownAction: async (action, signal, guard) => { signal.throwIfAborted(); guard(); calls.push(action); const result = await reply(action); guard(); return result; } }), resolveUpload: (_input, source) => { uploads.push(source.artifactId ?? source.path ?? ''); return Promise.resolve('https://public.example/signed'); } });
  return { service, input, controller, auth, calls, uploads, setSettings: (value: unknown) => { settings = QqFileSettingsSchema.parse(value); } };
}
const listArgs = QqFileArgs.parse({ group_id: null, source: 'group_file', folder_id: null, album_id: null, cursor: null, limit: 1 });
void test('QQ root folder/file pages scope cursors and reject other groups before transport', async () => {
  const f = fixture(() => Promise.resolve({ kind: 'files', data: { files: [{ file_id: 'a', file_name: 'a.txt', file_size: 1 }], folders: [{ folder_id: 'folder', folder_name: 'Folder' }] } }));
  const page = z.object({ next_cursor: z.string(), items: z.array(z.object({ type: z.string() })) }).parse(await f.service.list(f.input, listArgs)); assert.equal(page.items[0]?.type, 'folder');
  const next = z.object({ next_cursor: z.null(), items: z.array(z.object({ file_id: z.string() })) }).parse(await f.service.list(f.input, { ...listArgs, cursor: page.next_cursor })); assert.equal(next.items[0]?.file_id, 'a');
  await assert.rejects(f.service.list(f.input, { ...listArgs, group_id: '999' }), /capability/); assert.equal(f.calls.length, 2);
  await assert.rejects(f.service.list(f.input, { ...listArgs, folder_id: 'different', cursor: page.next_cursor }), /another group/);
});
void test('QQ album cursor retains within-page overflow and advances protocol continuation', async () => {
  const f = fixture(action => Promise.resolve({ kind: 'albums', data: { album_list: [{ album_id: action.action === 'get_qun_album_list' && action.params.attach_info ? 'c' : 'a' }, { album_id: 'b' }], attach_info: 'next', has_more: true } }));
  const args = { ...listArgs, source: 'group_album' as const }; const schema = z.object({ next_cursor: z.string(), items: z.array(z.object({ album_id: z.string() })) });
  const one = schema.parse(await f.service.list(f.input, args)); const two = schema.parse(await f.service.list(f.input, { ...args, cursor: one.next_cursor })); const three = schema.parse(await f.service.list(f.input, { ...args, cursor: two.next_cursor }));
  assert.equal(one.items[0]?.album_id, 'a'); assert.equal(two.items[0]?.album_id, 'b'); assert.equal(three.items[0]?.album_id, 'c');
});
void test('QQ role/member pages, search traversal bounds and config revoke are enforced', async () => {
  const f = fixture(action => Promise.resolve(action.action === 'get_group_member_list' ? { kind: 'members', data: [{ user_id: '1', nickname: 'A', card: '', role: 'owner' }, { user_id: '2', nickname: 'B', card: 'Alpha', role: 'admin' }] } : { kind: 'files', data: { files: [{ file_id: 'file', file_name: 'A.TXT', file_size: 1 }], folders: [{ folder_id: 'loop', folder_name: 'loop' }] } }));
  const members = z.object({ total: z.number(), members: z.array(z.object({ user_id: z.string() })) }).parse(await f.service.members(f.input, { group_id: null, page: 1, page_size: 1, keyword: 'alpha', role: 'admin', no_cache: true })); assert.equal(members.total, 1); assert.equal(members.members[0]?.user_id, '2');
  f.setSettings({ enabled: true, max_search_folders: 1 }); const search = z.object({ scanned_folders: z.number(), truncated: z.boolean() }).parse(await f.service.search(f.input, { group_id: null, keyword: '.txt', folder_id: null, recursive: true, limit: 5 })); assert.equal(search.scanned_folders, 1); assert.equal(search.truncated, true);
  f.setSettings({ enabled: false }); await assert.rejects(f.service.list(f.input, listArgs), /unavailable/); f.setSettings({ enabled: true }); f.auth.replaceGrants([]); await assert.rejects(f.service.list(f.input, listArgs), /Authorization changed/);
});
void test('QQ upload matching keeps message identity and intersects Skills, and tool permissions/approval are explicit', () => {
  const f = fixture(() => Promise.resolve({ kind: 'mutation', data: { success: true } }));
  f.setSettings({ enabled: true, upload_auto_process: true, uploadTemplates: [{ id: 'first', filePatterns: ['*.PDF'], prompt: 'Summarize', skillLibraries: ['forbidden'] }, { id: 'second', filePatterns: ['*'], prompt: 'Other' }] });
  const message = { ...f.input.message, parts: [{ type: 'file' as const, name: 'report.pdf', url: 'napcat-group-file:ref', mimeType: 'application/pdf' }] };
  const match = f.service.beforeIngress(message); assert.ok(match); assert.equal(match.message, message); assert.equal(match.matchedTemplateId, 'first'); assert.deepEqual(f.service.authorizedUploadSkills(f.input, match), []); assert.equal(matchesFilePattern('hello.txt', '*.pdf'), false);
  assert.equal(f.service.buildTools(f.input).some(tool => tool.name === 'qq_delete_files'), false);
});
void test('QQ upload uses scoped resolver and cancellation stops a mutation batch after committed first item', async () => {
  const f = fixture(action => { if (action.action === 'delete_group_file') f.controller.abort(); return Promise.resolve({ kind: 'mutation', data: { success: true } }); }, true);
  const tools = f.service.buildTools(f.input); const upload = tools.find(tool => tool.name === 'qq_request_file_upload'); assert.ok(upload?.type === 'function'); const local = new RunContext({ runId: f.input.context.runId });
  await upload.invoke(local, JSON.stringify({ group_id: null, artifact_id: 'owned', workspace_path: null, filename: 'test.txt', folder_id: null })); assert.deepEqual(f.uploads, ['owned']); assert.equal(f.calls[0]?.action, 'upload_group_file');
  const deleteTool = tools.find(tool => tool.name === 'qq_delete_files'); assert.ok(deleteTool?.type === 'function'); await deleteTool.invoke(local, JSON.stringify({ group_id: null, file_ids: ['one', 'two'] })); assert.equal(f.calls.filter(action => action.action === 'delete_group_file').length, 1);
  const folder = tools.find(tool => tool.name === 'qq_delete_folder'); assert.ok(folder?.type === 'function'); assert.equal(typeof folder.needsApproval, 'function');
});
void test('NapCat typed WebSocket API validates payloads and cancels outstanding plugin actions', { timeout: 10000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening'); const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  let reached: (() => void) | undefined; const pending = new Promise<void>(resolve => { reached = resolve; });
  server.on('connection', socket => socket.on('message', raw => { const payload = z.object({ action: z.string(), echo: z.string() }).parse(JSON.parse((Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)).toString('utf8'))); if (payload.action === 'get_group_member_list') { reached?.(); return; } socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: payload.echo, data: payload.action === 'get_login_info' ? { user_id: 'bot' } : { files: [{ wrong: 'shape' }] } })); }));
  const config = PlatformConfigSchema.parse({ id: 'qq', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}` }); assert.equal(config.type, 'napcat'); if (config.type !== 'napcat') throw new Error('Bad config');
  let ready: (() => void) | undefined; const connected = new Promise<void>(resolve => { ready = resolve; }); const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, status) => { if (status.status === 'connected') ready?.(); } });
  try { await adapter.start(() => Promise.resolve()); await connected; const controller = new AbortController(); await assert.rejects(adapter.executeKnownAction({ action: 'get_group_root_files', params: { group_id: '123' } }, controller.signal, () => undefined), /invalid response/); const request = adapter.executeKnownAction({ action: 'get_group_member_list', params: { group_id: '123' } }, controller.signal, () => undefined); await pending; controller.abort(); await assert.rejects(request, /cancelled/); }
  finally { await adapter.stop(); for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
