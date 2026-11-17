import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { FileParsingConfigurationSchema } from '../../../packages/contracts/src/file-parsing.js';
import { FileParsingError, type FileParsingSettingsService } from './file-parsing.js';

interface Context {
  service: FileParsingSettingsService;
  remoteAvailable: () => boolean;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  body: (request: IncomingMessage) => Promise<unknown>;
  json: (response: ServerResponse, status: number, value: unknown) => void;
}

/** Must run behind the shared management authentication guard. */
export async function handleFileParsingHttp(context: Context): Promise<boolean> {
  const { service, remoteAvailable, request, response, url, body, json } = context;
  const [resource, id] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  if (resource !== 'file-parsing') return false;
  try {
    if (!id && request.method === 'GET') { json(response, 200, service.status(remoteAvailable())); return true; }
    if (!id && request.method === 'PUT') {
      const data = FileParsingConfigurationSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request));
      const { expectedRevision, ...settings } = data;
      service.update(settings, expectedRevision);
      json(response, 200, service.status(remoteAvailable()));
      return true;
    }
    json(response, 405, { error: 'Unsupported file parsing operation' });
  } catch (error) {
    if (error instanceof FileParsingError) { json(response, error.status, { error: error.message }); return true; }
    if (error instanceof z.ZodError) { json(response, 400, { error: 'Invalid file parsing settings' }); return true; }
    throw error;
  }
  return true;
}
