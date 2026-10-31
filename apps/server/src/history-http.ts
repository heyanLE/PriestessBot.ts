import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ContinueConversationSchema } from '../../../packages/contracts/src/management.js';
import { ManagementError } from '../../../packages/core/src/management.js';
import type { HistoryContinuationService } from '../../../packages/core/src/history-continuation.js';
interface HistoryHttpContext { readonly runtime: { readonly historyContinuation: HistoryContinuationService }; readonly request: IncomingMessage; readonly response: ServerResponse; readonly url: URL; readonly body: (request: IncomingMessage) => Promise<unknown>; readonly json: (response: ServerResponse, status: number, value: unknown) => void; }
/** Invoked only behind the management authentication middleware. */
export async function handleHistoryHttp({ runtime, request, response, url, body, json }: HistoryHttpContext): Promise<boolean> {
  const [resource, id, action, extra] = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  if (resource !== 'conversations' || !id || action !== 'continue' || extra !== undefined || request.method !== 'POST') return false;
  try { json(response, 201, runtime.historyContinuation.create(id, ContinueConversationSchema.parse(await body(request)))); }
  catch (error) { if (error instanceof ManagementError) json(response, error.status, { error: error.message }); else if (error instanceof z.ZodError) json(response, 400, { error: error.message }); else throw error; }
  return true;
}
