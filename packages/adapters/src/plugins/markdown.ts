/** Clean TS implementation referencing xkeyC/astrbot_plugin_markdown_killer (MIT). */
import { randomUUID } from 'node:crypto';
import { Marked, Renderer } from 'marked';
import katex from 'katex';
import { chromium } from 'playwright';
import { MarkdownSettingsSchema, type MarkdownSettings, type MarkdownDecorationPart } from '../../../contracts/src/plugins/markdown.js';

export type { MarkdownDecorationPart } from '../../../contracts/src/plugins/markdown.js';
export interface MarkdownDecoration {
  /** Legacy text-only representation. Do not use its image markers to compose messages. */
  text: string;
  images: Uint8Array[];
  parts: MarkdownDecorationPart[];
  warnings: string[];
}
export type MarkdownRenderTemplate = 'classic' | 'minimal' | 'cinematic_poster';
export type MarkdownRenderer = (text: string, signal: AbortSignal, settings: MarkdownSettings, template?: MarkdownRenderTemplate) => Promise<Uint8Array>;
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
/** Keep fenced and inline code byte-for-byte while transforming prose. */
function outsideCode(text: string, transform: (value: string) => string): string {
  let offset = 0; let result = ''; const code = /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?:\n|$))|(`+)([^\n]*?)\3/gm;
  for (const match of text.matchAll(code)) { result += transform(text.slice(offset, match.index)) + match[0]; offset = match.index + match[0].length; }
  return result + transform(text.slice(offset));
}
const formulaPattern = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([^\n]*?)\\\)|(?<![\\$])\$([^$\n]+?)\$(?!\$)/g;
function formulas(text: string, render: (raw: string, latex: string, display: boolean) => string): string {
  return outsideCode(text, value => value.replace(formulaPattern, (raw: string, dollarBlock: string | undefined, bracketBlock: string | undefined, inline: string | undefined, dollarInline: string | undefined) => {
    const latex = dollarBlock ?? bracketBlock ?? inline ?? dollarInline ?? '';
    // Currency expressions are common in prose and are not LaTeX.
    if (dollarInline !== undefined && /^\d+(?:\.\d+)?(?:\s|$)/.test(dollarInline)) return raw;
    return render(raw, latex, dollarBlock !== undefined || bracketBlock !== undefined);
  }));
}
export function containsFormula(text: string): boolean { let found = false; formulas(text, raw => { found = true; return raw; }); return found; }
function inlineCleaner(): Marked {
  const renderer = new Renderer();
  renderer.strong = function({ tokens }) { return this.parser.parseInline(tokens); };
  renderer.em = function({ tokens }) { return this.parser.parseInline(tokens); };
  renderer.del = function({ tokens }) { return this.parser.parseInline(tokens); };
  renderer.codespan = ({ raw }) => raw;
  renderer.link = function({ tokens, href }) { const text = this.parser.parseInline(tokens); return text === href ? href : `${text} (${href})`; };
  renderer.image = ({ text, href }) => `${text || '图片'} (${href})`;
  renderer.br = () => '\n'; renderer.html = ({ text }) => text;
  renderer.text = function(token) { return 'tokens' in token && token.tokens ? this.parser.parseInline(token.tokens) : token.text; };
  return new Marked({ renderer, async: false });
}
export function cleanMarkdown(text: string, newlineMode: MarkdownSettings['newlineMode'] = 'preserve'): string {
  const cleaner = inlineCleaner();
  return outsideCode(text, value => {
    const cleaned = value.split('\n').map(line => {
      const withoutHeading = line.replace(/^ {0,3}#{1,6}\s+/, '').replace(/^ {0,3}>\s?/, '');
      return cleaner.parseInline(withoutHeading, { async: false });
    }).join('\n');
    if (newlineMode === 'global') return cleaned.replace(/\n{3,}/g, '\n\n');
    if (newlineMode === 'segment_boundary') {
      // Never join lists or their indented continuations.
      return cleaned.split('\n').reduce((result, line, index, lines) => { const previous = lines[index - 1] ?? ''; const protectedLine = /^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line) || /^\s*(?:[-*+]\s|\d+[.)]\s)/.test(previous) || /^\s+\S/.test(line); const separator = index === 0 ? '' : !protectedLine && /[。！？!?；;]$/.test(previous) && line.trim() ? ' ' : '\n'; return result + separator + line; }, '');
    }
    return cleaned;
  });
}
export function markdownHtml(text: string, template: MarkdownRenderTemplate = 'classic'): string {
  const themes: Readonly<Record<MarkdownRenderTemplate, string>> = {
    classic: '',
    minimal: 'body{width:664px;padding:32px 36px;font-size:18px;color:#202a25;background:#fff}h1,h2,h3{color:#202a25;font-weight:600;letter-spacing:-.02em}h1{font-size:30px;border-bottom:1px solid #d9e2dc;padding-bottom:20px}th{background:#f7f9f7}th,td{border-width:0 0 1px;padding:12px 8px}pre{background:#f7f9f7;border-radius:0}',
    cinematic_poster: 'html{background:#10251d}body{width:744px;padding:48px 50px;color:#e9eee8;background:linear-gradient(145deg,#10251d,#263c34);font-size:21px;border-top:8px solid #baab76}h1{text-align:center;font-size:44px;line-height:1.3;margin:8px 0 36px;color:#eddfad;letter-spacing:.08em}h2,h3{color:#eddfad}p{margin:22px 0}th{background:#334d40;color:#eddfad}th,td{border-color:#526354;padding:16px}pre{background:#0d2018;border:1px solid #526354}blockquote{border-color:#baab76;color:#eddfad;padding:12px 20px}math{color:#eddfad}',
  };

  const fragments = new Map<string, string>(); const prefix = `MATH${randomUUID().replaceAll('-', '')}`;
  const prepared = formulas(text, (_raw, latex, display) => {
    const marker = `${prefix}X${fragments.size}X`;
    fragments.set(marker, katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: false, trust: false, strict: 'error', maxExpand: 100, maxSize: 20 })); return marker;
  });
  const renderer = new Renderer(); renderer.html = ({ text: html }) => escapeHtml(html); renderer.image = ({ text: alt }) => `<span>${escapeHtml(alt)}</span>`;
  renderer.link = function({ tokens }) { return `<span>${this.parser.parseInline(tokens)}</span>`; };
  let body = new Marked({ renderer, async: false }).parse(prepared, { async: false });
  for (const [marker, mathml] of fragments) body = body.replaceAll(marker, mathml);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'"><style>html{background:#fff}body{margin:0;padding:28px;width:844px;color:#223c30;font:20px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c8d9cf;padding:10px 14px;text-align:left}th{background:#e7f1eb}pre{white-space:pre-wrap;background:#eff5f1;padding:16px;border-radius:8px}code{font-size:.88em}math{font-size:1.15em}h1,h2,h3{color:#245b40}blockquote{border-left:4px solid #84ae98;margin:0;padding-left:16px}${themes[template]}</style></head><body>${body}</body></html>`;
}
export async function renderMarkdownPng(text: string, signal: AbortSignal, settings: MarkdownSettings, template: MarkdownRenderTemplate = 'classic'): Promise<Uint8Array> {
  signal.throwIfAborted(); if (text.length > settings.maxRenderChars) throw new Error('Markdown exceeds render limit');
  const controller = AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]);
  const browser = await chromium.launch({ headless: true, timeout: settings.timeoutMs });
  const abort = (): void => { void browser.close().catch(() => undefined); }; controller.addEventListener('abort', abort, { once: true });
  try {
    controller.throwIfAborted(); const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', offline: true, viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => route.abort()); const page = await context.newPage(); await page.setContent(markdownHtml(text, template), { waitUntil: 'domcontentloaded', timeout: settings.timeoutMs }); controller.throwIfAborted();
    const bounds = await page.locator('body').boundingBox(); if (!bounds || bounds.height > 12000) throw new Error('Rendered output exceeds image height limit');
    const bytes = await page.locator('body').screenshot({ type: 'png', timeout: settings.timeoutMs }); controller.throwIfAborted(); return bytes;
  } finally { controller.removeEventListener('abort', abort); await browser.close(); }
}
export class MarkdownPlugin {
  private availabilityCache: { checkedAt: number; value: { available: boolean; reason?: string } } | undefined;
  constructor(private readonly settings: () => MarkdownSettings, private readonly renderer: MarkdownRenderer = renderMarkdownPng) {}
  async availability(): Promise<{ available: boolean; reason?: string }> {
    if (this.renderer !== renderMarkdownPng) return { available: true };
    if (this.availabilityCache && Date.now() - this.availabilityCache.checkedAt < 60000) return this.availabilityCache.value;
    let value: { available: boolean; reason?: string };
    try { const browser = await chromium.launch({ headless: true, timeout: 10000 }); await browser.close(); value = { available: true }; }
    catch { value = { available: false, reason: 'Chromium headless shell or its system dependencies are unavailable' }; }
    this.availabilityCache = { checkedAt: Date.now(), value }; return value;
  }
  async render(text: string, signal: AbortSignal, template: MarkdownRenderTemplate = 'classic'): Promise<Uint8Array> { return this.renderer(text, signal, MarkdownSettingsSchema.parse(this.settings()), template); }
  async decorate(text: string, signal: AbortSignal): Promise<MarkdownDecoration> {
    const settings = MarkdownSettingsSchema.parse(this.settings()); signal.throwIfAborted();
    if (!settings.enabled) return { text, images: [], parts: text ? [{ type: 'text', text }] : [], warnings: [] };
    const images: Uint8Array[] = []; const parts: MarkdownDecorationPart[] = []; const warnings: string[] = []; let output = '';
    const appendText = (value: string): void => {
      output += value; if (!value) return;
      const previous = parts.at(-1);
      if (previous?.type === 'text') previous.text += value;
      else parts.push({ type: 'text', text: value });
    };
    const tokens = new Marked().lexer(text);
    for (const token of tokens) {
      signal.throwIfAborted(); const raw = token.raw; const table = token.type === 'table'; const formula = token.type !== 'code' && containsFormula(raw);
      const shouldRender = (table && settings.tableRender) || (formula && settings.formulaRender);
      if (!shouldRender) { appendText(token.type === 'code' || table ? raw : settings.globalCleanup ? cleanMarkdown(raw, settings.newlineMode) : raw); continue; }
      try {
        if (images.length >= settings.maxImages) throw new Error('Image limit reached');
        const image = await this.renderer(raw, signal, settings); signal.throwIfAborted(); if (!this.settings().enabled) throw new Error('Markdown plugin disabled during rendering');
        parts.push({ type: 'image', imageIndex: images.length }); images.push(image); output += `\n[图 ${images.length}]\n`;
      } catch {
        signal.throwIfAborted(); const fallback = table ? settings.tableFallback : settings.formulaFallback; warnings.push(`${table ? 'table' : 'formula'} rendering failed; fallback=${fallback}`);
        if (fallback === 'raw') appendText(raw);
        if (fallback === 'text') appendText(table ? raw.split('\n').filter(line => !/^\s*\|?\s*:?-{3,}/.test(line)).map(line => line.replace(/^\s*\||\|\s*$/g, '').split('|').map(cell => cleanMarkdown(cell.trim())).join(' · ')).join('\n') : formulas(raw, (_source, latex) => latex));
      }
    }
    const first = parts[0]; if (first?.type === 'text') first.text = first.text.trimStart();
    const last = parts.at(-1); if (last?.type === 'text') last.text = last.text.trimEnd();
    return { text: output.trim(), images, parts: parts.filter(part => part.type !== 'text' || part.text.length > 0), warnings };
  }
}
