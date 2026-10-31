import type { IncomingMessage, ServerResponse } from 'node:http';
import { ExtensionToggleSchema } from '../../../packages/contracts/src/extensions.js';
import type { NativeExtensionRegistry } from '../../../packages/adapters/src/extensions/index.js';
export async function handleExtensionsHttp(registry: NativeExtensionRegistry, request: IncomingMessage, response: ServerResponse, url: URL, body: (request: IncomingMessage) => Promise<unknown>, json: (response: ServerResponse, status: number, value: unknown) => void): Promise<boolean> {
  const [resource, id] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent); if (resource !== 'extensions') return false;
  if (!id && request.method === 'GET') json(response, 200, { extensions: registry.list() });
  else if (!id && request.method === 'POST') json(response, 201, await registry.install(await body(request)));
  else if (id && request.method === 'PUT') { const input = ExtensionToggleSchema.parse(await body(request)); json(response, 200, await registry.toggle(id, input.enabled, input.expectedRevision, input.configuration)); }
  else json(response, 405, { error: 'Unsupported extension operation' }); return true;
}
