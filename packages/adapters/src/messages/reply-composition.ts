import type { ContentPart } from '../../../contracts/src/index.js';
type ImagePart = Extract<ContentPart, { type: 'image' }>;
export interface ImageReferenceParts { readonly parts: ContentPart[]; readonly usedArtifactIds: ReadonlySet<string>; }

/** Only images already attached by this run can be positioned. This never resolves a URL. */
export function splitReplyImageReferences(text: string, attachments: readonly ContentPart[]): ImageReferenceParts {
  const images = new Map<string, ImagePart>();
  for (const part of attachments) if (part.type === 'image' && part.url.startsWith('artifact:')) images.set(part.artifactId ?? part.url.slice(9), part);
  const parts: ContentPart[] = []; const used = new Set<string>(); let cursor = 0; let copied = 0;
  const append = (value: string): void => { if (!value) return; const previous = parts.at(-1); if (previous?.type === 'text') previous.text += value; else parts.push({ type: 'text', text: value }); };
  const lineEnd = (at: number): number => { const next = text.indexOf('\n', at); return next < 0 ? text.length : next + 1; };
  while (cursor < text.length) {
    if (cursor === 0 || text[cursor - 1] === '\n') {
      const end = lineEnd(cursor); const line = text.slice(cursor, end); const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (fence) {
        let next = end;
        while (next < text.length) { const finish = lineEnd(next); const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/u.exec(text.slice(next, finish))?.[1]; if (closing && closing[0] === fence[0] && closing.length >= fence.length) { next = finish; break; } next = finish; }
        cursor = next; continue;
      }
      if (/^(?: {4}|\t)/u.test(line)) { cursor = end; continue; }
    }
    if (text[cursor] === '\\') { cursor += 2; continue; }
    if (text[cursor] === '`') {
      let count = 1; while (text[cursor + count] === '`') count++;
      const delimiter = '`'.repeat(count); let closing = text.indexOf(delimiter, cursor + count);
      while (closing >= 0 && (text[closing - 1] === '`' || text[closing + count] === '`')) closing = text.indexOf(delimiter, closing + 1);
      cursor = closing < 0 ? cursor + count : closing + count; continue;
    }
    if (text.startsWith('![', cursor)) {
      const match = /^!\[(?:\\.|[^\]\\\r\n])*\]\(artifact:([A-Za-z0-9-]+)\)/u.exec(text.slice(cursor));
      const id = match?.[1]; const image = id ? images.get(id) : undefined;
      if (match && id && image) {
        append(text.slice(copied, cursor));
        if (used.has(id)) append('[图片已在上文显示]'); else { parts.push(image); used.add(id); }
        cursor += match[0].length; copied = cursor; continue;
      }
    }
    cursor++;
  }
  append(text.slice(copied)); return { parts, usedArtifactIds: used };
}
