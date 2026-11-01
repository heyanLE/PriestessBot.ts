import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { PriestessRuntime } from './runtime.js';
import { ModelPayloadNotFound } from './model-payloads.js';

/** Mounted only after the management token/session and same-origin guards. */
export async function handleModelPayloadHttp(runtime: PriestessRuntime, request: IncomingMessage, response: ServerResponse, url: URL, json: (response: ServerResponse, status: number, value: unknown) => void): Promise<boolean> {
  const parts = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent);
  const [resource, runId, action, callId, documentId, extra] = parts;
  if (resource !== 'agent-records' || action !== 'model-calls') return false;
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') { json(response, 405, { error: '模型正文接口只支持读取。' }); return true; }
  if (!runId || !callId || extra !== undefined) { json(response, 404, { error: '模型调用不存在。' }); return true; }
  if (documentId === undefined) {
    const documents = runtime.modelPayloads.list(runId, callId);
    const found = documents.length > 0 || runtime.store.events(runId).some(event => event.type === 'model_call' && event.callId === callId);
    if (!found) { json(response, 404, { error: '模型调用不存在。' }); return true; }
    json(response, 200, { documents, legacy: documents.length === 0 }); return true;
  }
  try {
    const { document, file } = await runtime.modelPayloads.read(runId, callId, documentId);
    try {
    response.statusCode = 200;
    // Always serve inert text. A recorded upstream HTML/error body must not execute in Dashboard origin.
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (url.searchParams.get('download') === '1') response.setHeader('Content-Disposition', `attachment; filename="model-${document.id}.${document.contentType.includes('json') ? 'json' : 'txt'}"`);
    const size = (await file.stat()).size;
    // Snapshot the current bytes so a live write cannot grow this particular download indefinitely.
    response.setHeader('Content-Length', size);
    if (!size) { await file.close(); response.end(); return true; }
    try { await pipeline(file.createReadStream({ start: 0, end: size - 1, autoClose: true }), response); }
    catch { if (!response.destroyed) response.destroy(); }
    } finally { await file.close(); }
  } catch (error) {
    if (response.headersSent) { if (!response.destroyed) response.destroy(); }
    else json(response, error instanceof ModelPayloadNotFound ? 404 : 500, { error: error instanceof ModelPayloadNotFound ? '模型正文不存在或尚未保存。请刷新记录。' : '无法读取模型正文。请检查数据目录。' });
  }
  return true;
}
