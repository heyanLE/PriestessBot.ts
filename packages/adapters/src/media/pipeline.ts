import { createHash } from 'node:crypto';
import type { ContentPart, MediaAttachment, MessageEvent } from '../../../contracts/src/index.js';
import { PlatformError } from '../platforms/transport.js';
import type { PlatformAdapter } from '../platforms/types.js';
export interface MediaPolicy { readonly maxBytes: number; readonly maxTextChars: number; readonly maxPdfPages: number; readonly maxAttachments?: number; }
const defaultPolicy: MediaPolicy = { maxBytes: 20_000_000, maxTextChars: 80_000, maxPdfPages: 100 };
export function imageMime(bytes: Uint8Array): string | undefined {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF89a' || buffer.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}
class MediaBudgetError extends PlatformError { constructor(message: string) { super('rejected', message); } }
/** Materialize authenticated protocol media before invoking a model; URLs never become paths. */
export class MediaPipeline {
  constructor(private readonly policy: MediaPolicy = defaultPolicy) {}
  async prepare(event: MessageEvent, adapter: PlatformAdapter, signal: AbortSignal): Promise<MessageEvent> {
    const parts: ContentPart[] = [];
    let totalBytes = 0;
    let totalTextChars = 0;
    const count = event.parts.reduce((sum, part) => sum + (part.type === 'image' || part.type === 'file' ? 1 : part.type === 'quote' ? part.attachments?.length ?? 0 : 0), 0);
    if (count > (this.policy.maxAttachments ?? 20)) throw new MediaBudgetError('Combined media exceeds attachment count limit');
    const materialize = async (part: MediaAttachment): Promise<MediaAttachment> => {
      signal.throwIfAborted();
      const downloaded = await adapter.downloadMedia(part, signal);
      signal.throwIfAborted();
      totalBytes += downloaded.bytes.length;
      if (totalBytes > this.policy.maxBytes) throw new MediaBudgetError('Combined media exceeds size limit');
      const digest = createHash('sha256').update(downloaded.bytes).digest('hex');
      if (part.type === 'image') {
        const mimeType = imageMime(downloaded.bytes);
        if (!mimeType) throw new PlatformError('invalid_payload', 'Image content does not match a supported image format');
        return { ...part, mimeType, url: `data:${mimeType};base64,${Buffer.from(downloaded.bytes).toString('base64')}` };
      }
      const text = await this.extract(downloaded.bytes, downloaded.mimeType, downloaded.name);
      signal.throwIfAborted();
      totalTextChars += text.length;
      if (totalTextChars > this.policy.maxTextChars) throw new MediaBudgetError('Combined extracted attachments exceed text limit');
      return { ...part, url: `attachment:sha256:${digest}`, mimeType: downloaded.mimeType, size: downloaded.bytes.length, extractedText: text };
    };
    for (const part of event.parts) {
      signal.throwIfAborted();
      if (part.type === 'image' || part.type === 'file') { parts.push(await materialize(part)); continue; }
      if (part.type !== 'quote') { parts.push(part); continue; }
      totalTextChars += part.text?.length ?? 0;
      if (totalTextChars > this.policy.maxTextChars) throw new MediaBudgetError('Combined extracted attachments exceed text limit');
      const attachments: MediaAttachment[] = []; let failed = false;
      const forwardedSources: NonNullable<typeof part.forwardedSources> = [];
      for (const [oldIndex, attachment] of (part.attachments ?? []).entries()) {
        try {
          const ready = await materialize(attachment); const source = part.forwardedSources?.find(item => item.attachmentIndex === oldIndex);
          if (source) forwardedSources.push({ ...source, attachmentIndex: attachments.length });
          attachments.push(ready);
        }
        catch (error) { signal.throwIfAborted(); if (error instanceof MediaBudgetError) throw error; failed = true; }
      }
      parts.push({ ...part, ...(part.attachments === undefined ? {} : { attachments }), ...(part.forwardedSources === undefined ? {} : { forwardedSources }), ...(failed ? { availability: 'partial', unavailableReason: 'media_unavailable' } : {}) });
    }
    return { ...event, parts };
  }
  async extract(bytes: Uint8Array, mimeType: string, name: string): Promise<string> {
    if (bytes.length > this.policy.maxBytes) throw new PlatformError('rejected', 'Media exceeds size limit');
    const header = Buffer.from(bytes.subarray(0, 5)).toString('ascii');
    if (header === '%PDF-') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
      try {
        const document = await task.promise;
        if (document.numPages > this.policy.maxPdfPages) throw new PlatformError('rejected', 'PDF exceeds page limit');
        const pages: string[] = []; let chars = 0;
        for (let index = 1; index <= document.numPages; index++) {
          const page = await document.getPage(index); const content = await page.getTextContent();
          const text = `[Page ${index}]\n${content.items.map(item => 'str' in item ? item.str : '').join(' ')}`;
          chars += text.length; if (chars > this.policy.maxTextChars) throw new PlatformError('rejected', 'Extracted PDF exceeds text limit');
          pages.push(text); page.cleanup();
        }
        return pages.join('\n\n');
      } finally { await task.destroy(); }
    }
    if (!mimeType.startsWith('text/') && !/\.(?:txt|md|markdown|csv|tsv|json|ya?ml|log)$/i.test(name) && mimeType !== 'application/json') throw new PlatformError('rejected', 'This file format is not supported; send text, Markdown or PDF');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new PlatformError('invalid_payload', 'Text attachment is not valid UTF-8'); }
    if (text.includes('\0')) throw new PlatformError('invalid_payload', 'Binary data is not a text attachment');
    if (text.length > this.policy.maxTextChars) throw new PlatformError('rejected', 'Attachment exceeds text limit');
    return text;
  }
}
