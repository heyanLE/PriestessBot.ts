import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AsrConfigurationSchema } from '../../../packages/contracts/src/asr.js';
import { AsrError, type AsrSettingsService } from './asr.js';

interface Context {
  service: AsrSettingsService;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  body: (request: IncomingMessage) => Promise<unknown>;
  json: (response: ServerResponse, status: number, value: unknown) => void;
}

/** Must run behind the shared management authentication guard. */
export async function handleAsrHttp(context: Context): Promise<boolean> {
  const { service, request, response, url, body, json } = context;
  const [resource, id] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  if (resource !== 'asr') return false;
  try {
    if (!id && request.method === 'GET') { json(response, 200, service.status()); return true; }
    if (!id && request.method === 'PUT') {
      const data = AsrConfigurationSchema.extend({ expectedRevision: z.number().int().nonnegative() }).parse(await body(request));
      const { expectedRevision, ...settings } = data;
      service.update(settings, expectedRevision);
      json(response, 200, service.status());
      return true;
    }
    json(response, 405, { error: 'Unsupported ASR operation' });
  } catch (error) {
    if (error instanceof AsrError) { json(response, error.status, { error: error.message }); return true; }
    if (error instanceof z.ZodError) { json(response, 400, { error: 'Invalid ASR settings' }); return true; }
    throw error;
  }
  return true;
}
