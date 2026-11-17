import { readZip, zipText, ZipError } from './zip.js';

/**
 * Text extraction for Office Open XML documents.
 *
 * These formats are ZIP containers of XML. Extraction keeps the reading order
 * a person sees: paragraphs, slide text, sheet rows. Formatting, images and
 * layout are dropped, so a caller must not treat the result as a rendering.
 */

export class OfficeError extends Error {
  override readonly name = 'OfficeError';
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replaceAll(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec: string | undefined, hex: string | undefined, name: string | undefined): string => {
    if (dec !== undefined) { const code = Number.parseInt(dec, 10); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match; }
    if (hex !== undefined) { const code = Number.parseInt(hex, 16); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match; }
    return name === undefined ? match : NAMED[name.toLowerCase()] ?? match;
  });
}

/** Concatenate the text inside one element name, preserving inner text order. */
function elementText(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gu');
  let out = '';
  for (const match of xml.matchAll(pattern)) out += decodeEntities(match[1] ?? '');
  return out;
}

/** Trim per paragraph and drop blank ones, so a document does not become one wall of text. */
function paragraphs(xml: string, closing: string, tag: string): string[] {
  return xml.split(closing).map(part => elementText(part, tag).replaceAll(/\s+/gu, ' ').trim()).filter(line => line.length > 0);
}

function docx(entries: ReadonlyMap<string, Uint8Array>): string {
  const body = zipText(entries, 'word/document.xml');
  if (body === undefined) throw new OfficeError('DOCX 缺少正文部分');
  return paragraphs(body, '</w:p>', 'w:t').join('\n');
}

function pptx(entries: ReadonlyMap<string, Uint8Array>): string {
  const numberOf = (name: string): number => Number(/slide(\d+)\.xml$/u.exec(name)?.[1] ?? 0);
  const slides = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((left, right) => numberOf(left) - numberOf(right));
  if (!slides.length) throw new OfficeError('PPTX 缺少幻灯片');
  const lines: string[] = [];
  for (const [index, name] of slides.entries()) {
    const xml = zipText(entries, name) ?? '';
    const text = paragraphs(xml, '</a:p>', 'a:t').join('\n');
    if (text) lines.push(`第 ${index + 1} 页\n${text}`);
  }
  return lines.join('\n\n');
}

function xlsx(entries: ReadonlyMap<string, Uint8Array>): string {
  const shared = zipText(entries, 'xl/sharedStrings.xml');
  const strings: string[] = [];
  if (shared !== undefined) for (const item of shared.split('</si>')) strings.push(elementText(item, 't'));
  const sheets = [...entries.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name)).sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
  if (!sheets.length) throw new OfficeError('XLSX 缺少工作表');
  const out: string[] = [];
  for (const [index, name] of sheets.entries()) {
    const xml = zipText(entries, name) ?? '';
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gu)) {
      const cells: string[] = [];
      for (const cell of (row[1] ?? '').matchAll(/<c(?:\s[^>]*)?>([\s\S]*?)<\/c>/gu)) {
        const raw = cell[0];
        const type = /\st="([^"]+)"/u.exec(raw)?.[1];
        const value = /<v>([\s\S]*?)<\/v>/u.exec(cell[1] ?? '')?.[1];
        if (type === 's' && value !== undefined) cells.push(strings[Number(value)] ?? '');
        else if (type === 'inlineStr') cells.push(elementText(cell[1] ?? '', 't'));
        else if (value !== undefined) cells.push(decodeEntities(value));
      }
      if (cells.some(value => value.trim().length > 0)) rows.push(cells.join('\t'));
    }
    if (rows.length) out.push(`工作表 ${index + 1}\n${rows.join('\n')}`);
  }
  return out.join('\n\n');
}

export type OfficeKind = 'docx' | 'pptx' | 'xlsx';

/** Pick the extractor from the file extension; unknown extensions are rejected. */
export function officeKind(name: string): OfficeKind | undefined {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return extension === 'docx' || extension === 'pptx' || extension === 'xlsx' ? extension : undefined;
}

/** Extract readable text, bounded by `maxChars` so one file cannot flood the prompt. */
export function officeText(kind: OfficeKind, bytes: Uint8Array, maxChars: number): string {
  let entries: Map<string, Uint8Array>;
  try { entries = readZip(bytes); }
  catch (error) { throw error instanceof ZipError ? new OfficeError(`无法读取 ${kind.toUpperCase()} 压缩结构：${error.message}`) : error; }
  const text = kind === 'docx' ? docx(entries) : kind === 'pptx' ? pptx(entries) : xlsx(entries);
  if (text.length > maxChars) throw new OfficeError(`解析结果超过文本上限（${maxChars} 字）`);
  if (!text.trim()) throw new OfficeError(`${kind.toUpperCase()} 中没有可提取的文字`);
  return text;
}
