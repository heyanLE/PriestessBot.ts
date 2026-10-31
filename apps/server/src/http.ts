import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { timingSafeEqual, randomUUID, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ArtifactIdSchema, MessageEventSchema, PrincipalSchema, MemoryRecordSchema, RuntimeConfigSchema, JobSchema, type MessageEvent, type ContentPart } from '../../../packages/contracts/src/index.js';
import { validateConfiguration } from '../../../packages/core/src/flow.js';
import { imageMime } from '../../../packages/adapters/src/media/index.js';
import { OperatorManagement } from './operator.js';
import { WorkspaceFiles } from './workspace-files.js';
import { handleOperatorHttp } from './operator-http.js';
import { handleHistoryHttp } from './history-http.js';
import { handleManagementHttp } from './management-http.js';
import { handleExtensionsHttp } from './extensions-http.js';
import { handleMemoryMaintenanceHttp } from './memory-maintenance-http.js';
import { handleSearchHttp } from './search-http.js';
import { handlePluginsHttp } from './plugins-http.js';
import { RecordNotFound } from './observability.js';
import { handleObservabilityHttp } from './observability-http.js';
import { handleAgentWorkbenchHttp } from './agent-workbench-http.js';
import type { PriestessRuntime } from './runtime.js';

const ArtifactSchema = z.object({ id: ArtifactIdSchema, name: z.string(), mimeType: z.string(), size: z.number(), file: z.string() });
const ImportSchema = z.object({ libraryId: z.string(), name: z.string().min(1), mimeType: z.enum(['text/plain', 'text/markdown', 'application/pdf']), encoding: z.enum(['utf8', 'base64']).default('utf8'), content: z.string().max(28_000_000) });
const MemoryInput = MemoryRecordSchema.omit({ id: true, createdAt: true, updatedAt: true });
interface ServerOptions { readonly token: string; readonly artifacts: string; readonly dashboard?: string; readonly publicBaseUrl?: string; }
export function createRuntimeServer(runtime: PriestessRuntime, options: ServerOptions): Server {
  if (!options.token.trim()) throw new Error('Management authentication token must not be empty');
  const operator = new OperatorManagement(runtime.store);
  const files = new WorkspaceFiles(() => runtime.config());
  runtime.setArtifactDirectory(options.artifacts);
  const signature = (id: string, expires: number): string => createHmac('sha256', options.token).update(`artifact:${id}:${expires}`).digest('hex');
  runtime.setMediaResolvers({
    resolveMedia: async (part, signal) => { signal.throwIfAborted(); if (!part.url.startsWith('artifact:')) throw new Error('Artifact reference required'); const artifact = runtime.store.get('artifacts', part.url.slice(9), ArtifactSchema); if (!artifact) throw new Error('Artifact not found'); return { bytes: await readFile(artifact.file), mimeType: artifact.mimeType, name: artifact.name }; },
    resolvePublicMediaUrl: (part, signal) => { signal.throwIfAborted(); if (!options.publicBaseUrl) throw new Error('PRIESTESS_PUBLIC_BASE_URL is required for remote platform file delivery'); if (!part.url.startsWith('artifact:')) throw new Error('Artifact reference required'); const id = part.url.slice(9); if (!runtime.store.get('artifacts', id, ArtifactSchema)) throw new Error('Artifact not found'); const expires = Date.now() + 60_000; const url = new URL(`/media/${encodeURIComponent(id)}`, options.publicBaseUrl); url.searchParams.set('expires', String(expires)); url.searchParams.set('signature', signature(id, expires)); return Promise.resolve(url.toString()); }
  });
  const json = (response: ServerResponse, status: number, value: unknown): void => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };

  const body = async (request: IncomingMessage): Promise<unknown> => { const chunks: Buffer[] = []; let bytes = 0; for await (const raw of request) { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(z.string().parse(raw)); bytes += chunk.length; if (bytes > 30_000_000) throw new Error('Request exceeds size limit'); chunks.push(chunk); } const text = Buffer.concat(chunks).toString('utf8'); const parsed: unknown = JSON.parse(text || '{}'); return parsed; };
  const prepareDashboardMedia = async (message: MessageEvent): Promise<MessageEvent> => {
    const parts: ContentPart[] = [];
    let totalBytes = 0; let totalText = 0;
    for (const part of message.parts) {
      if (part.type !== 'image' && part.type !== 'file') { parts.push(part); continue; }
      if (!part.url.startsWith('artifact:')) throw new Error('Upload media before sending it from the Dashboard');
      const artifact = runtime.store.get('artifacts', part.url.slice('artifact:'.length), ArtifactSchema);
      if (!artifact) throw new Error('Artifact not found');
      const bytes = await readFile(artifact.file);
      totalBytes += bytes.length; if (totalBytes > 20_000_000) throw new Error('Combined media exceeds per-turn size budget');
      if (part.type === 'image') { const mime = imageMime(bytes); if (!mime) throw new Error('Invalid image'); parts.push({ ...part, url: `data:${mime};base64,${bytes.toString('base64')}`, mimeType: mime }); }
      else { const extractedText = await runtime.media.extract(bytes, artifact.mimeType, artifact.name); totalText += extractedText.length; if (totalText > 80_000) throw new Error('Combined attachment text exceeds per-turn budget'); parts.push({ ...part, mimeType: artifact.mimeType, extractedText }); }
    }
    return { ...message, parts };
  };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/health') { json(response, 200, { status: 'ok', runtime: 'priestess-ts', engine: runtime.engine.id, running: runtime.scheduler.running, queued: runtime.scheduler.pending }); return; }
    if (pathname.startsWith('/media/') && request.method === 'GET') {
      const id = pathname.slice('/media/'.length); const expires = Number(url.searchParams.get('expires')); const actual = Buffer.from(url.searchParams.get('signature') ?? ''); const expected = Buffer.from(signature(id, expires));
      if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 60_000 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { json(response, 403, { error: 'Media link expired or invalid' }); return; }
      const artifact = runtime.store.get('artifacts', id, ArtifactSchema); if (!artifact) { json(response, 404, { error: 'Artifact not found' }); return; }
      response.writeHead(200, { 'Content-Type': artifact.mimeType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' }); response.end(await readFile(artifact.file)); return;
    }
    if (!pathname.startsWith('/api/ts/')) {
      if (!options.dashboard || request.method !== 'GET') { json(response, 404, { error: 'Not found' }); return; }
      const root = await realpath(options.dashboard);
      const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
      const candidate = path.resolve(root, relative || 'index.html');
      if (candidate !== root && !candidate.startsWith(root + path.sep)) { json(response, 404, { error: 'Not found' }); return; }
      let file = candidate;
      try { if (!(await stat(file)).isFile()) file = path.join(root, 'index.html'); } catch { file = path.join(root, 'index.html'); }
      const real = await realpath(file); if (!real.startsWith(root + path.sep)) throw new Error('Static path denied');
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': types[path.extname(real)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); response.end(await readFile(real)); return;
    }
    const bearer = operator.bearer(request, options.token);
    const session = operator.session(request);
    const sameOrigin = operator.sameOrigin(request);
    if (pathname === '/api/ts/auth/session' && request.method === 'GET') { json(response, 200, session); return; }
    if (pathname === '/api/ts/auth/login' && request.method === 'POST') {
      if (!bearer || !sameOrigin) { json(response, 401, { error: 'Invalid management credentials' }); return; }
      json(response, 200, operator.issue(request, response)); return;
    }
    if (!bearer && !session.authenticated) { json(response, 401, { error: 'Unauthorized' }); return; }
    if (!sameOrigin) { json(response, 403, { error: 'Cross-origin management request denied' }); return; }
    if (pathname === '/api/ts/auth/logout' && request.method === 'POST') { operator.logout(request, response); json(response, 200, { ok: true }); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) response.once('finish', () => { if (!pathname.includes('/secrets')) operator.audit(`api.${request.method ?? 'POST'}`, pathname, response.statusCode < 400 ? 'success' : 'failure'); });
    if (await handleOperatorHttp({ operator, files, config: () => runtime.config(), onSecretsChange: () => runtime.restartPlatforms(), request, response, url, body, json })) return;
    if (await handleHistoryHttp({ runtime, request, response, url, body, json })) return;
    if (await handleManagementHttp({ runtime, request, response, url, body, json })) return;
    if (await handleAgentWorkbenchHttp({ runtime, request, response, url, body, json })) return;
    if(await handleSearchHttp({service:runtime.search,management:runtime.management,config:()=>runtime.config(),request,response,url,body,json}))return;
    if(await handlePluginsHttp({runtime,request,response,url,body,json}))return;
    if (await handleExtensionsHttp(runtime.extensions, request, response, url, body, json)) return;
    if (await handleMemoryMaintenanceHttp(runtime.memoryMaintenance, request, response, url, body, json)) return;
    const route = pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
    const [resource, id, action] = route;
    const method = request.method;
    if (handleObservabilityHttp(runtime, request, response, url, json)) return;
    if (resource === 'jobs' && method === 'GET') { const jobs = runtime.store.list('jobs', JobSchema); for (const document of runtime.knowledge.documents()) jobs.push({ id: `knowledge:${document.id}`, kind: 'knowledge_import', status: document.status === 'ready' ? 'completed' : document.status === 'pending' ? 'queued' : document.status === 'indexing' ? 'running' : 'failed', createdAt: document.createdAt, updatedAt: document.updatedAt, summary: `${document.name}: ${document.chunkCount} chunks${document.error ? '; indexing failed' : ''}` }); json(response, 200, { jobs: jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200) }); return; }
    if (resource === 'config') {
      if (!id && method === 'GET') { const config = runtime.config(); json(response, 200, { revision: config.revision, config }); return; }
      if (id === 'validate' && method === 'POST') { const data = z.object({ config: z.unknown() }).parse(await body(request)); json(response, 200, validateConfiguration(data.config)); return; }
      if (!id && method === 'PUT') { const data = z.object({ expectedRevision: z.number().int(), config: RuntimeConfigSchema }).strict().parse(await body(request)); const config = await runtime.publish(data.config, data.expectedRevision); json(response, 200, { revision: config.revision, config }); return; }
      if (id === 'rollback' && method === 'POST') { const data = z.object({ revision: z.number().int(), expectedRevision: z.number().int() }).parse(await body(request)); const previous = runtime.store.getConfig(data.revision); if (!previous) throw new Error('Configuration revision not found'); const config = await runtime.publish(previous, data.expectedRevision); json(response, 200, { revision: config.revision, config }); return; }
      if (id === 'draft' && method === 'PUT') { const data = RuntimeConfigSchema.parse(await body(request)); runtime.flow.saveDraft(data); json(response, 200, { ok: true }); return; }
    }
    if (resource === 'flow' && id === 'simulate' && method === 'POST') { const data = z.object({ config: RuntimeConfigSchema, message: MessageEventSchema }).parse(await body(request)); json(response, 200, runtime.flow.simulate(data.config, data.message)); return; }
    if (resource === 'chat' && method === 'POST') {
      const data = z.object({ message: MessageEventSchema, conversationId: z.string().optional() }).strict().parse(await body(request));
      let message = data.message; let agentId: string | undefined;
      if (data.conversationId) {
        const conversation = runtime.management.detail(data.conversationId).conversation;
        if (conversation.platform !== 'dashboard' || conversation.archived) throw new Error('Only active Dashboard conversations can be continued here');
        message = { ...message, platform: conversation.platform, platformType: conversation.platformType, sessionId: conversation.sessionId, sessionType: conversation.sessionType, senderId: conversation.ownerId, senderName: '控制台', botId: 'dashboard' };
        agentId = conversation.agentId;
      }
      const prepared = await prepareDashboardMedia(message);
      const run = agentId ? runtime.submitDashboard(prepared, agentId) : runtime.submit(prepared);
      json(response, 202, runtime.detail(run.id)); return;
    }
    if (resource === 'runs') {
      if (id && action === 'record-link' && method === 'GET') { try { json(response, 200, runtime.observability.recordLink(id)); } catch (error) { if (!(error instanceof RecordNotFound)) throw error; json(response, 404, { error: '关联处理记录不存在。' }); } return; }
      if (!id && method === 'GET') { json(response, 200, { runs: runtime.store.runs().sort((a, b) => b.createdAt - a.createdAt).slice(0, 200) }); return; }
      if (id && action === 'cancel' && method === 'POST') { runtime.cancel(id); json(response, 200, { ok: true }); return; }
      if (id && action === 'artifacts' && method === 'GET') { runtime.detail(id); const records = runtime.store.list('artifacts', ArtifactSchema.extend({ runId: z.string().optional() })); json(response, 200, { artifacts: records.filter(item => item.runId === id).map(item => ({ id: item.id, url: `artifact:${item.id}`, name: item.name, mimeType: item.mimeType, size: item.size })) }); return; }
      if (id && action === 'approval' && method === 'POST') { const data = z.object({ approvalId: z.string(), approved: z.boolean() }).parse(await body(request)); runtime.approve(id, data.approvalId, data.approved); json(response, 202, runtime.detail(id)); return; }
      if (id && action === 'events' && method === 'GET') {
        const detail = runtime.detail(id);
        const after = z.coerce.number().int().catch(-1).parse(url.searchParams.get('after') ?? request.headers['last-event-id'] ?? -1);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        for (const event of detail.events.filter(event => event.sequence > after)) response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
        if (!['running', 'queued', 'paused'].includes(detail.run.status)) { response.end(); return; }
        const dispose = runtime.subscribe(id, event => { response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`); });
        const heartbeat = setInterval(() => { response.write(': heartbeat\n\n'); const state = runtime.detail(id).run.status; if (!['running', 'queued', 'paused'].includes(state)) response.end(); }, 1000);
        response.on('close', () => { clearInterval(heartbeat); dispose(); }); return;
      }
      if (id && method === 'GET') { json(response, 200, runtime.detail(id)); return; }
    }
    if (resource === 'platforms') {
      if (!id && method === 'GET') { json(response, 200, { platforms: runtime.platformStatus() }); return; }
      if (id && action === 'qr') { json(response, 200, method === 'POST' ? await runtime.beginQr(id) : await runtime.pollQr(id)); return; }
    }
    if (resource === 'memory') {
      if (!id && method === 'GET') { const libraryId = url.searchParams.get('libraryId'); json(response, 200, { memories: runtime.memory.list().filter(record => !libraryId || record.libraryId === libraryId) }); return; }
      if (!id && method === 'POST') {
        const data = MemoryInput.parse(await body(request));
        const config = runtime.config();
        if (!config.memoryLibraries.some(item => item.id === data.libraryId) || !config.agents.some(item => item.id === data.agentId)) throw new Error('Agent or memory library not found');
        const record = MemoryRecordSchema.parse({ ...data, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now() }); runtime.store.put('memories', record.id, record); json(response, 201, record); return;
      }
      if (id && method === 'DELETE') { runtime.store.delete('memories', id); json(response, 200, { ok: true }); return; }
      if (id && method === 'PUT') { const record = runtime.store.get('memories', id, MemoryRecordSchema); if (!record) throw new Error('Memory not found'); const data = z.object({ text: z.string().min(1).max(20_000) }).parse(await body(request)); const updated = { ...record, text: data.text, updatedAt: Date.now() }; runtime.store.put('memories', id, updated); json(response, 200, updated); return; }
      if (id === 'consolidate' && method === 'POST') {
        const data = z.object({ agentId: z.string(), principal: PrincipalSchema, libraryId: z.string() }).parse(await body(request));
        const records = runtime.memory.list().filter(item => item.agentId === data.agentId && item.libraryId === data.libraryId && item.principal.platform === data.principal.platform && item.principal.senderId === data.principal.senderId && item.principal.sessionId === data.principal.sessionId && (item.principal.sessionType ?? 'private') === (data.principal.sessionType ?? 'private'));
        const seen = new Map<string, z.infer<typeof MemoryRecordSchema>>(); let removed = 0;
        for (const record of records.slice(0, 500)) { const key = `${record.scope}:${record.text.trim()}`; const previous = seen.get(key); if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) { runtime.store.delete('memories', record.id); removed++; } else if (previous) { const merged = { ...previous, source: [...new Set([previous.source, record.source])].join('\n'), confidence: Math.max(previous.confidence, record.confidence), updatedAt: Date.now() }; runtime.store.put('memories', previous.id, merged); seen.set(key, merged); runtime.store.delete('memories', record.id); removed++; } else seen.set(key, record); }
        json(response, 200, { removed }); return;
      }
    }
    if (resource === 'environments' && method === 'GET') { json(response, 200, { environments: await runtime.environmentsStatus() }); return; }
    if (resource === 'processes') {
      if (!id && method === 'GET') { const runId = z.string().min(1).parse(url.searchParams.get('runId')); json(response, 200, { processes: runtime.processes(runId) }); return; }
      if (id && action === 'kill' && method === 'POST') { const data = z.object({ runId: z.string() }).parse(await body(request)); json(response, 200, await runtime.killProcess(data.runId, id)); return; }
    }
    if (resource === 'knowledge') {
      const config = runtime.config(); const libraries = config.knowledgeLibraries.map(item => item.id);
      const { service, context, agent } = runtime.managementKnowledge(libraries);
      if (!id && method === 'GET') { const libraryId = url.searchParams.get('libraryId'); json(response, 200, { documents: service.documents().filter(document => !libraryId || document.libraryId === libraryId) }); return; }
      if (id === 'search' && method === 'GET') {
        const requested = url.searchParams.get('libraryId');
        const selected = requested ? runtime.managementKnowledge(libraries.filter(item => item === requested)) : { service, context, agent };
        json(response, 200, { hits: await selected.service.search(selected.context, selected.agent, url.searchParams.get('query') ?? '') }); return;
      }
      if (!id && method === 'POST') {
        const data = ImportSchema.parse(await body(request));
        if (!libraries.includes(data.libraryId)) throw new Error('Knowledge library not found');
        const bytes = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8');
        const text = await runtime.media.extract(bytes, data.mimeType, data.name);
        const pages = data.mimeType === 'application/pdf' ? text.split(/\[Page (\d+)\]\n/).flatMap((part, index, all) => index % 2 === 1 ? [{ page: Number(part), text: all[index + 1] ?? '' }] : []) : [{ text }];
        json(response, 201, await service.importDocument(context, agent, { libraryId: data.libraryId, name: data.name, mimeType: data.mimeType, pages })); return;
      }
      if (id && action === 'reindex' && method === 'POST') { json(response, 200, await service.rebuild(context, agent, id)); return; }
      if (id && method === 'DELETE') { service.delete(context, agent, id); json(response, 200, { ok: true }); return; }
    }
    if (resource === 'artifacts') {
      if (!id && method === 'POST') {
        const data = z.object({ name: z.string().min(1).max(255), mimeType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i), encoding: z.literal('base64'), content: z.string().max(28_000_000) }).parse(await body(request));
        const bytes = Buffer.from(data.content, 'base64'); if (bytes.length > 20_000_000) throw new Error('Artifact exceeds size limit');
        if (data.mimeType.startsWith('image/')) { if (!imageMime(bytes)) throw new Error('Invalid image'); } else await runtime.media.extract(bytes, data.mimeType, data.name);
        const artifactId = ArtifactIdSchema.parse(randomUUID()); await mkdir(options.artifacts, { recursive: true, mode: 0o700 }); const file = path.join(options.artifacts, artifactId); await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
        runtime.store.put('artifacts', artifactId, { id: artifactId, name: path.basename(data.name), mimeType: data.mimeType, size: bytes.length, file });
        json(response, 201, { id: artifactId, url: `artifact:${artifactId}`, name: path.basename(data.name), mimeType: data.mimeType, size: bytes.length }); return;
      }
      if (id && method === 'GET') { const record = runtime.store.get('artifacts', id, ArtifactSchema); if (!record) throw new Error('Artifact not found'); response.writeHead(200, { 'Content-Type': record.mimeType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`, 'X-Content-Type-Options': 'nosniff' }); response.end(await readFile(record.file)); return; }
      if (id && method === 'DELETE') { const record = runtime.store.get('artifacts', id, ArtifactSchema); if (!record) throw new Error('Artifact not found'); const root = await realpath(options.artifacts); const file = await realpath(record.file); if (!file.startsWith(root + path.sep)) throw new Error('Artifact path denied'); await unlink(file); runtime.store.delete('artifacts', id); json(response, 200, { ok: true }); return; }
    }
    json(response, 404, { error: 'Not found' });
  };
  return createServer((request, response) => { void handle(request, response).catch(error => { if (response.headersSent) { response.end(); return; } const message = error instanceof Error ? error.message : 'Request failed'; const status = /revision conflict/i.test(message) ? 409 : /not found/i.test(message) ? 404 : 400; json(response, status, { error: error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : message.slice(0, 600) }); }); });
}
