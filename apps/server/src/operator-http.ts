import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import type { OperatorManagement } from './operator.js';
import type { WorkspaceFiles } from './workspace-files.js';
import { SecretNameSchema } from '../../../packages/contracts/src/operator.js';
import type { RuntimeConfig } from '../../../packages/contracts/src/index.js';
interface Dependencies { operator: OperatorManagement; files: WorkspaceFiles; config: () => RuntimeConfig; onSecretsChange: () => Promise<void>; request: IncomingMessage; response: ServerResponse; url: URL; body: (request: IncomingMessage) => Promise<unknown>; json: (response: ServerResponse, status: number, value: unknown) => void; }
const FilePathSchema = z.string().max(4096);
export async function handleOperatorHttp({ operator, files, config, onSecretsChange, request, response, url, body, json }: Dependencies): Promise<boolean> {
  const parts = url.pathname.slice('/api/ts/'.length).split('/').map(decodeURIComponent); const [resource, action, name] = parts; const method = request.method;
  if (resource === 'management') {
    if (action === 'audit' && method === 'GET') { json(response, 200, { records: operator.logs() }); return true; }
    if (action === 'export' && method === 'GET') { json(response, 200, { config: config(), exportedAt: Date.now() }); operator.audit('config.export', 'active'); return true; }
    if (action === 'secrets') {
      if (!name && method === 'GET') { json(response, 200, { secrets: operator.secrets() }); return true; }
      if (name && method === 'PUT') { const input = z.object({ value: z.string().min(1).max(65_536) }).strict().parse(await body(request)); operator.setSecret(SecretNameSchema.parse(name), input.value); await onSecretsChange(); json(response, 200, { ok: true }); return true; }
      if (name && method === 'DELETE') { operator.deleteSecret(name); await onSecretsChange(); json(response, 200, { ok: true }); return true; }
    }
    return false;
  }
  if (resource !== 'files') return false;
  if (action === 'environments' && method === 'GET') { json(response, 200, { environments: files.environments() }); return true; }
  const environmentId = z.string().min(1).parse(url.searchParams.get('environmentId'));
  const relative = FilePathSchema.parse(url.searchParams.get('path') ?? '');
  if (method === 'GET' && !action) { json(response, 200, await files.list(environmentId, relative)); return true; }
  if (method === 'GET' && action === 'read') { const bytes = await files.read(environmentId, relative, 1_000_000); let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error('Binary'); } catch { throw new Error('Only UTF-8 text files can be previewed'); } json(response, 200, { path: relative, text, size: bytes.length }); return true; }
  if (method === 'GET' && action === 'download') { const bytes = await files.read(environmentId, relative); response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(relative))}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); response.end(bytes); operator.audit('file.download', `${environmentId}:${relative}`); return true; }
  if (method === 'POST' && action === 'upload') { const input = z.object({ content: z.string().max(14_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict().parse(await body(request)); await files.upload(environmentId, relative, Buffer.from(input.content, 'base64')); operator.audit('file.upload', `${environmentId}:${relative}`); json(response, 201, { ok: true }); return true; }
  if (method === 'POST' && action === 'mkdir') { await files.mkdir(environmentId, relative); operator.audit('folder.create', `${environmentId}:${relative}`); json(response, 201, { ok: true }); return true; }
  if (method === 'POST' && action === 'move') { const input = z.object({ to: FilePathSchema }).strict().parse(await body(request)); await files.move(environmentId, relative, input.to); operator.audit('file.move', `${environmentId}:${relative} -> ${input.to}`); json(response, 200, { ok: true }); return true; }
  if (method === 'DELETE' && !action) { await files.delete(environmentId, relative); operator.audit('file.delete', `${environmentId}:${relative}`); json(response, 200, { ok: true }); return true; }
  return false;
}
