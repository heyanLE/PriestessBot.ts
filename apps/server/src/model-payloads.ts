import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RuntimeStore } from '../../../packages/core/src/storage.js';
import { ModelPayloadDocumentSchema, type ModelPayloadDocument } from '../../../packages/contracts/src/model-records.js';
import type { RawModelCaptureSink, RawModelCaptureWriter } from '../../../packages/adapters/src/agents/raw-model-capture.js';

const NAMESPACE = 'model-payload-documents';
const ValueSchema = z.object({ value: z.string() });
export class ModelPayloadNotFound extends Error {}

/** Private payload files are separate from public artifacts and bounded event previews. */
export class ModelPayloadStore {
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly store: RuntimeStore, private readonly root: () => string) {
    for (const row of this.store.db.prepare("SELECT value FROM documents WHERE namespace=? AND json_extract(value,'$.status')='writing'").all(NAMESPACE)) {
      const decoded: unknown = JSON.parse(ValueSchema.parse(row).value); const item = ModelPayloadDocumentSchema.parse(decoded);
      this.store.put(NAMESPACE, item.id, { ...item, status: 'failed', updatedAt: Date.now(), error: '服务重启前未完成此记录。已写入的正文保留。' });
    }
  }
  private async directory(): Promise<string> {
    const configured = path.resolve(this.root());
    await mkdir(path.dirname(configured), { recursive: true, mode: 0o700 });
    const root = path.join(await realpath(path.dirname(configured)), path.basename(configured));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Model payload directory is not private to the service account');
    return root;
  }
  sink(runId: string): RawModelCaptureSink {
    return { open: async meta => {
      const now = Date.now();
      let item = ModelPayloadDocumentSchema.parse({ ...meta, id: randomUUID(), runId, status: 'writing', bytes: 0, createdAt: now, updatedAt: now });
      this.store.put(NAMESPACE, item.id, item);
      let file: FileHandle;
      try { file = await open(path.join(await this.directory(), `${item.id}.body`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
      catch { this.store.put(NAMESPACE, item.id, { ...item, status: 'failed', updatedAt: Date.now(), error: '无法保存模型正文。请检查数据目录和剩余磁盘空间。' }); throw new Error('Model payload storage is unavailable'); }
      let state: ModelPayloadDocument['status'] = 'writing'; let bytes = 0; let lastUpdate = now;
      let queue = Promise.resolve(); let done: () => void = () => {};
      const pending = new Promise<void>(resolve => { done = resolve; }); this.pending.add(pending);
      const save = (status: ModelPayloadDocument['status'], error?: string): void => {
        item = ModelPayloadDocumentSchema.parse({ ...item, bytes, status, updatedAt: Date.now(), ...(error === undefined ? {} : { error }) });
        this.store.put(NAMESPACE, item.id, item); lastUpdate = item.updatedAt;
      };
      const finish = async (status: 'complete' | 'failed', error?: string): Promise<void> => {
        if (state !== 'writing') return;
        state = status;
        try { await file.sync(); save(status, error); }
        catch { save('failed', '模型正文保存未完成。已写入的部分保留。'); }
        finally { try { await file.close(); } finally { this.pending.delete(pending); done(); } }
      };
      const serial = (operation: () => Promise<void>): Promise<void> => {
        const next = queue.then(operation); queue = next.catch(() => undefined); return next;
      };
      const writer: RawModelCaptureWriter = {
        write: chunk => serial(async () => {
          if (state !== 'writing') throw new Error('Model payload writer is closed');
          const buffer = Buffer.from(chunk, 'utf8'); let offset = 0;
          try {
            while (offset < buffer.length) { const result = await file.write(buffer, offset, buffer.length - offset); if (!result.bytesWritten) throw new Error('Empty payload write'); offset += result.bytesWritten; bytes += result.bytesWritten; }
            if (Date.now() - lastUpdate >= 1000) save('writing');
          } catch { await finish('failed', '模型正文写入失败。请检查剩余磁盘空间。已写入的部分保留。'); throw new Error('Model payload write failed'); }
        }),
        close: () => serial(() => finish('complete')),
        fail: message => serial(() => finish('failed', message)),
      };
      return writer;
    } };
  }
  list(runId: string, callId: string): ModelPayloadDocument[] {
    return this.store.db.prepare("SELECT value FROM documents WHERE namespace=? AND json_extract(value,'$.runId')=? AND json_extract(value,'$.callId')=? ORDER BY json_extract(value,'$.createdAt'),id").all(NAMESPACE, runId, callId).map(row => {
      const decoded: unknown = JSON.parse(ValueSchema.parse(row).value); return ModelPayloadDocumentSchema.parse(decoded);
    });
  }
  async read(runId: string, callId: string, documentId: string): Promise<{ document: ModelPayloadDocument; file: FileHandle }> {
    const parsed = z.string().uuid().safeParse(documentId); if (!parsed.success) throw new ModelPayloadNotFound();
    const document = this.store.get(NAMESPACE, parsed.data, ModelPayloadDocumentSchema);
    if (!document || document.runId !== runId || document.callId !== callId) throw new ModelPayloadNotFound();
    let file: FileHandle;
    try { file = await open(path.join(await this.directory(), `${document.id}.body`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch { throw new ModelPayloadNotFound(); }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0) throw new ModelPayloadNotFound();
      return { document, file };
    } catch (error) { await file.close(); throw error; }
  }
  async drain(): Promise<void> { await Promise.all(this.pending); }
}
