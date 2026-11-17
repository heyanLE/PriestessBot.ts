import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader for Office documents.
 *
 * Only what a document needs: the central directory, stored entries and raw
 * deflate entries. No encryption, no ZIP64, no compression beyond deflate.
 * Keeping it in-process avoids adding a dependency to the release bundle.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 65_535;
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class ZipError extends Error {
  override readonly name = 'ZipError';
}

function u16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - MAX_COMMENT - 22);
  for (let offset = buffer.length - 22; offset >= floor; offset--) {
    if (u32(buffer, offset) === EOCD) return offset;
  }
  throw new ZipError('文件不是有效的 ZIP 容器');
}

/** Read every file entry into memory. Directories are skipped. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 22) throw new ZipError('文件不是有效的 ZIP 容器');
  const eocd = findEndOfCentralDirectory(buffer);
  const total = u16(buffer, eocd + 10);
  if (total > MAX_ENTRIES) throw new ZipError('压缩包条目数量超出限制');
  const directory = u32(buffer, eocd + 16);
  const entries = new Map<string, Uint8Array>();
  let offset = directory;
  for (let index = 0; index < total; index++) {
    if (offset + 46 > buffer.length || u32(buffer, offset) !== CENTRAL) throw new ZipError('压缩包目录已损坏');
    const method = u16(buffer, offset + 10);
    const compressedSize = u32(buffer, offset + 20);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const localOffset = u32(buffer, offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || name === '') continue;
    if (compressedSize > MAX_ENTRY_BYTES) throw new ZipError(`条目过大：${name}`);
    if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== LOCAL) throw new ZipError('压缩包条目头已损坏');
    const dataStart = localOffset + 30 + u16(buffer, localOffset + 26) + u16(buffer, localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new ZipError('压缩包条目被截断');
    const raw = buffer.subarray(dataStart, dataEnd);
    if (method === 0) entries.set(name, new Uint8Array(raw));
    else if (method === 8) entries.set(name, new Uint8Array(inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })));
    else throw new ZipError(`不支持的压缩方式：${method}`);
  }
  return entries;
}

/** Decode one entry as UTF-8 XML, or undefined when the entry is absent. */
export function zipText(entries: ReadonlyMap<string, Uint8Array>, name: string): string | undefined {
  const data = entries.get(name);
  return data === undefined ? undefined : Buffer.from(data).toString('utf8');
}
