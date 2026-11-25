import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { RuntimeConfig } from '../../../contracts/src/index.js';
import { ModelFileReferenceSchema, type ModelFileReference } from '../../../contracts/src/model-files.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import type { DownloadedMedia } from '../platforms/types.js';
import { readBoundedResponse } from './download.js';

type Connection = RuntimeConfig['connections'][number];
const CachedFile = ModelFileReferenceSchema.extend({ binding: z.string() });
const UploadedFile = z.object({ id: ModelFileReferenceSchema.shape.fileId, expires_at: z.number().int().positive() });
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** Format allowlist before upload; the provider validates the actual document contents. */
export function deepseekFilePurpose(name: string, mimeType: string, purpose: 'text_recognition' | 'rich_layout_recognition'): 'user_data' | typeof purpose {
  if (/\.(?:pdf|docx?|pptx?|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)) return purpose;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || /\.(?:txt|md|markdown|csv|tsv|json|ya?ml|log|xlsx?|epub|mobi|py|js|ts|java|kt|rs|go|c|cpp|h|html|css|xml)$/i.test(name)) return 'user_data';
  throw new Error('此文件格式不支持文档问答；请发送 PDF、Office 文档、图片、电子书或文本文件。');
}

export class DeepSeekFiles {
  constructor(private readonly store: RuntimeStore, private readonly secret: (name: string) => string | undefined, private readonly transport: typeof fetch = fetch) {}
  private binding(connection: Connection, scope: string): string {
    const key = this.secret(connection.apiKeyEnv)?.trim();
    if (!key) throw new Error('文档上传的模型凭据未配置。');
    return hash(JSON.stringify([connection.id, connection.baseUrl, hash(key), scope]));
  }
  async upload(connection: Connection, scope: string, media: DownloadedMedia, signal: AbortSignal, guard: () => void): Promise<ModelFileReference> {
    guard(); signal.throwIfAborted();
    if (!connection.fileUpload || connection.protocol !== 'responses') throw new Error('当前模型连接未启用 DeepSeek 文件上传。');
    if (media.bytes.length > 20_000_000) throw new Error('文件超过项目的 20 MB 限制。');
    const purpose = deepseekFilePurpose(media.name, media.mimeType, connection.fileUpload.purpose);
    const binding = this.binding(connection, scope);
    const cacheKey = hash(JSON.stringify([binding, hash(media.bytes), purpose, connection.fileUpload.expiresAfterSeconds]));
    const cached = this.store.get('model-file-cache', cacheKey, CachedFile);
    if (cached && cached.expiresAt > Date.now() + 60_000) return { provider: cached.provider, connectionId: cached.connectionId, fileId: cached.fileId, expiresAt: cached.expiresAt };
    const base = (connection.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    const endpoint = new URL(`${base.replace(/\/v1$/, '')}/files`);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('无效的文档上传服务地址。');
    const form = new FormData();
    // DeepSeek requires purpose before the document file field.
    form.append('purpose', purpose);
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', String(connection.fileUpload.expiresAfterSeconds));
    form.append('file', new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), path.basename(media.name));
    const response = await this.transport(endpoint, { method: 'POST', body: form, headers: { Authorization: `Bearer ${this.secret(connection.apiKeyEnv)?.trim() ?? ''}` }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(250_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`DeepSeek 文件上传失败（HTTP ${response.status}）。`); }
    const bytes = await readBoundedResponse(response, 64_000);
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('DeepSeek 文件上传返回了无效响应。'); }
    const parsed = UploadedFile.safeParse(decoded);
    if (!parsed.success) throw new Error('DeepSeek 未成功完成文件解析，未取得有效文件引用。');
    const reference: ModelFileReference = { provider: 'deepseek', connectionId: connection.id, fileId: parsed.data.id, expiresAt: parsed.data.expires_at * 1000 };
    if (reference.expiresAt <= Date.now()) throw new Error('DeepSeek 返回的文件引用已过期。');
    // Keep a scoped receipt even if cancellation happens after the provider stored the file.
    this.store.put('model-file-cache', cacheKey, { ...reference, binding });
    this.store.put('model-file-references', hash(`${binding}:${reference.fileId}`), { ...reference, binding });
    guard(); signal.throwIfAborted();
    return reference;
  }
  assertReferences(connection: Connection | undefined, scope: string, input: unknown): void {
    const ids: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (typeof value !== 'object' || value === null) return;
      if ('type' in value && value.type === 'input_file') {
        const item = z.object({ file: z.object({ id: z.string() }) }).safeParse(value);
        if (item.success) ids.push(item.data.file.id);
      }
      Object.values(value).forEach(visit);
    };
    visit(input);
    if (!ids.length) return;
    if (!connection?.fileUpload) throw new Error('当前模型连接已关闭文件上传；请开始新会话或重新启用文件处理。');
    if (ids.length > 20) throw new Error('当前上下文最多包含 20 个文档引用，请开始新会话。');
    const binding = this.binding(connection, scope);
    for (const id of ids) {
      const reference = this.store.get('model-file-references', hash(`${binding}:${id}`), CachedFile);
      if (!reference || reference.expiresAt <= Date.now()) throw new Error('文档引用已过期或不属于当前会话和模型连接，请重新发送文件。');
    }
  }
}
