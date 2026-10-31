import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { FolderInputSchema, PersonaInputSchema, ConversationPatchSchema, FolderKindSchema } from '../../../packages/contracts/src/management.js';
import { ManagementError, type ManagementService } from '../../../packages/core/src/management.js';
import type { RuntimeConfig } from '../../../packages/contracts/src/index.js';
interface ManagementRuntime { readonly management: ManagementService; config(): RuntimeConfig; cancel(id: string): void; }
interface ManagementHttpContext { readonly runtime: ManagementRuntime; readonly request: IncomingMessage; readonly response: ServerResponse; readonly url: URL; readonly body: (request: IncomingMessage) => Promise<unknown>; readonly json: (response: ServerResponse, status: number, value: unknown) => void; }
/** Call only after the shared management authorization check. */
export async function handleManagementHttp(context: ManagementHttpContext): Promise<boolean> {
  const { runtime, request, response, url, body, json } = context;
  const [resource, id, action] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  if (!['folders', 'personas', 'persona-bindings', 'conversations'].includes(resource ?? '')) return false;
  const service = runtime.management; const method = request.method;
  const send = (value: unknown, status = 200): true => { json(response, status, value); return true; };
  try {
    if (resource === 'folders') {
      if (!id && method === 'GET') { const kind = url.searchParams.get('kind'); return send({ folders: service.folders(kind === null ? undefined : FolderKindSchema.parse(kind)) }); }
      if (method === 'POST' && !id) return send(service.saveFolder(FolderInputSchema.parse(await body(request))), 201);
      if (id && method === 'PUT') { const data = FolderInputSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); const { expectedRevision, ...input } = data; return send(service.saveFolder(input, id, expectedRevision)); }
      if (id && method === 'DELETE') { const data = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); service.deleteFolder(id, data.expectedRevision); return send({ ok: true }); }
    }
    if (resource === 'personas') {
      if (!id && method === 'GET') return send({ personas: service.personas(), bindings: service.bindings() });
      if (!id && method === 'POST') return send(service.savePersona(PersonaInputSchema.parse(await body(request))), 201);
      if (id && method === 'PUT') { const data = PersonaInputSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); const { expectedRevision, ...input } = data; return send(service.savePersona(input, id, expectedRevision)); }
      if (id && method === 'DELETE') { const data = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); service.deletePersona(id, data.expectedRevision); return send({ ok: true }); }
    }
    if (resource === 'persona-bindings' && id && method === 'PUT') { if (!runtime.config().agents.some(a => a.id === id)) throw new ManagementError(404, 'Agent not found'); const data = z.object({ personaId: z.string().nullable(), expectedRevision: z.number().int().nonnegative() }).strict().parse(await body(request)); return send(service.bindPersona(id, data.personaId, data.expectedRevision)); }
    if (resource === 'conversations') {
      if (!id && method === 'GET') { const search = url.searchParams.get('search'); const archived = z.enum(['true','false','all']).parse(url.searchParams.get('archived') ?? 'all'); return send({ conversations: service.conversations({ ...(search === null ? {} : { search }), archived }) }); }
      if (!id && method === 'POST') { const data = z.object({ agentId: z.string(), title: z.string().trim().min(1).max(200).default('新会话') }).strict().parse(await body(request)); if (!runtime.config().agents.some(a => a.id === data.agentId && a.enabled)) throw new ManagementError(404, 'Enabled Agent not found'); return send(service.createWebConversation(data.agentId, data.title), 201); }
      if (id && action === 'export' && method === 'GET') return send({ ...service.detail(id), format: 'priestess-conversation-v1', exportedAt: Date.now() });
      if (id && action === 'cancel' && method === 'POST') { service.cancelConversation(id, runId => runtime.cancel(runId)); return send({ ok: true }); }
      if (id && !action && method === 'GET') return send(service.detail(id));
      if (id && !action && method === 'PUT') return send(service.patchConversation(id, ConversationPatchSchema.parse(await body(request))));
      if (id && !action && method === 'DELETE') { const data = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request)); service.deleteConversation(id, data.expectedRevision, runId => runtime.cancel(runId)); return send({ ok: true }); }
    }
    return send({ error: 'Management route not found' }, 404);
  } catch (error) { if (error instanceof ManagementError) return send({ error: error.message }, error.status); if (error instanceof z.ZodError) return send({ error: error.message }, 400); throw error; }
}
