import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { MemoryPolicyInputSchema, MemoryScopeSchema } from '../../../packages/contracts/src/memory-maintenance.js';
import type { MemoryMaintenance } from '../../../packages/adapters/src/resources/memory-maintenance.js';
export async function handleMemoryMaintenanceHttp(service: MemoryMaintenance, request: IncomingMessage, response: ServerResponse, url: URL, body: (request: IncomingMessage) => Promise<unknown>, json: (response: ServerResponse, status: number, value: unknown) => void): Promise<boolean> {
  const [resource, action, id] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent); if (resource !== 'memory-maintenance') return false;
  if (!action && request.method === 'GET') json(response, 200, service.snapshot());
  else if (action === 'preview' && request.method === 'POST') json(response, 200, await service.preview(MemoryScopeSchema.parse(await body(request))));
  else if (action === 'apply' && id && request.method === 'POST') json(response, 200, service.apply(id));
  else if (action === 'cancel' && id && request.method === 'POST') { service.cancel(id); json(response, 200, { ok: true }); }
  else if (action === 'policy' && request.method === 'PUT') { const input = z.object({ policy: MemoryPolicyInputSchema, expectedRevision: z.number().int() }).strict().parse(await body(request)); json(response, 200, service.setPolicy(input.policy, input.expectedRevision)); }
  else json(response, 405, { error: 'Unsupported maintenance operation' }); return true;
}
