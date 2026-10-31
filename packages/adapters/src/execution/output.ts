import { open, mkdir, type FileHandle } from 'node:fs/promises';
import { closeSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
export const OUTPUT_LOG_BYTES = 16 * 1024 * 1024;
export const TRUNCATION_MARKER = '[... omitted middle of output ...]';
export function outputTokenLimit(value = DEFAULT_MAX_OUTPUT_TOKENS): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(256, Math.min(40_000, Math.floor(value)));
}
export function cleanTerminalOutput(text: string): string {
  const controls = new Set([0, 7, 8, 11, 12, 14, 15]);
  return stripVTControlCharacters(text).replace(/[\s\S]/gu, character => controls.has(character.charCodeAt(0)) ? '' : character).replace(/\r\n?/gu, '\n');
}
export function truncateOutput(text: string, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS): { output: string; truncated: boolean; headChars: number } {
  const budget = outputTokenLimit(maxTokens) * 4;
  if (text.length <= budget) return { output: text, truncated: false, headChars: text.length };
  const keep = Math.floor((budget - TRUNCATION_MARKER.length - 2) / 2);
  const insidePair=(index:number):boolean=>{const before=text.charCodeAt(index-1),after=text.charCodeAt(index);return before>=0xd800&&before<=0xdbff&&after>=0xdc00&&after<=0xdfff;};
  const head=insidePair(keep)?keep-1:keep;const candidate=text.length-keep;const tail=insidePair(candidate)?candidate+1:candidate;
  return { output: `${text.slice(0, head)}\n${TRUNCATION_MARKER}\n${text.slice(tail)}`, truncated: true, headChars: head };
}
interface PendingChunk { start: number; text: string; }
export interface OutputSlice { text: string; from: number; through: number; total: number; retainedThrough: number; fullOutputAvailable: boolean; droppedChars: number; }

/** Private, bounded UTF-16 log: offsets address JS characters, independent of UTF-8 byte width. */
export class ProcessOutputLog {
  private readonly pending: PendingChunk[] = [];
  private writes: Promise<void> = Promise.resolve();
  private persisted = 0;
  private retained = 0;
  private total = 0;
  private tail = '';
  private failed = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  private constructor(private readonly file: FileHandle, private readonly filename: string, private readonly maxChars: number) {}
  static async create(directory: string, id: string, maxBytes = OUTPUT_LOG_BYTES): Promise<ProcessOutputLog> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, `${id}.log`);
    const file = await open(filename, 'wx+', 0o600);
    return new ProcessOutputLog(file, filename, Math.max(1, Math.floor(maxBytes / 2)));
  }
  append(text: string): void {
    if (this.closed) return;
    this.total += text.length;
    this.tail = (this.tail + text).slice(-128_000);
    const kept = text.slice(0, Math.max(0, this.maxChars - this.retained));
    if (!kept || this.failed) return;
    const chunk = { start: this.retained, text: kept };
    this.retained += kept.length;
    this.pending.push(chunk);
    this.writes = this.writes.then(async () => {
      if (this.failed) return;
      const buffer = Buffer.from(kept, 'utf16le');
      let written = 0;
      while (written < buffer.length) {
        const result = await this.file.write(buffer, written, buffer.length - written, chunk.start * 2 + written);
        if (result.bytesWritten === 0) throw new Error('Process output log write made no progress');
        written += result.bytesWritten;
      }
      this.persisted += kept.length;
      this.pending.shift();
    }).catch(() => { this.failed = true; this.pending.length = 0; this.retained = this.persisted; });
  }
  read(offset = 0, limit = Number.MAX_SAFE_INTEGER): OutputSlice {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid process output range');
    const tailStart = this.total - this.tail.length;
    const from = Math.min(this.total, offset < this.retained ? offset : Math.max(offset, tailStart));
    const retainedThrough = this.retained;
    const end = Math.min(this.total, from + limit, from < this.retained && tailStart > this.retained ? this.retained : this.total);
    let text = '';
    const diskEnd = Math.min(end, this.persisted);
    if (from < diskEnd) {
      const buffer = Buffer.alloc((diskEnd - from) * 2);
      let bytes = 0;
      const descriptor = openSync(this.filename, 'r');
      try { while (bytes < buffer.length) { const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, from * 2 + bytes); if (count === 0) break; bytes += count; } }
      finally { closeSync(descriptor); }
      text = buffer.subarray(0, bytes).toString('utf16le');
    }
    for (const chunk of this.pending) {
      const start = Math.max(from, chunk.start); const through = Math.min(end, chunk.start + chunk.text.length);
      if (through > start) text += chunk.text.slice(start - chunk.start, through - chunk.start);
    }
    const lastStart = Math.max(from, this.retained, tailStart);
    if (end > lastStart) text += this.tail.slice(lastStart - tailStart, end - tailStart);
    return { text, from, through: from + text.length, total: this.total, retainedThrough, fullOutputAvailable: !this.failed && tailStart <= this.retained, droppedChars: Math.max(0, tailStart - this.retained) };
  }
  async drain(): Promise<void> { await this.writes; }
  close(): Promise<void> { this.closed = true; this.closing ??= this.writes.then(() => this.file.close()); return this.closing; }
}
