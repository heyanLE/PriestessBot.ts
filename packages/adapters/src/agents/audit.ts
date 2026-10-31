import type { AuditPreview } from '../../../contracts/src/audit.js';

export interface AuditPreviewOptions {
  readonly maxChars?: number;
  readonly knownSecrets?: readonly string[];
  /** Root arrays whose newest entries matter most, such as a model's input history. */
  readonly recentArrayKeys?: readonly string[];
}
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface ArrayEntry { readonly index: number; readonly value: JsonValue; }
interface ArraySource { readonly entries: readonly ArrayEntry[]; readonly total: number; readonly recent: boolean; }
const OMITTED = '[已隐藏]';
const INSPECTION_LIMIT = 1_000_000;
const sensitiveName = /(?:authorization|cookie|headers|api[-_]?key|token|password|passwd|secret|private[-_]?key|credential|providerData|encryptedContent|encrypted_content)/iu;
const tokenMetricName = /^(?:(?:input|output|total|cached|max|summaryMax|contextWindow|compactAt|target)[_-]?)?tokens?$|^token_count$/iu;
const privateReasoningName = /^(?:reasoning|reasoning_content|thinking|chain_of_thought)$/iu;
const identityNames = new Set(['type', 'role', 'name', 'callId', 'status']);
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function select<T>(items: readonly T[], count: number, recent: boolean): readonly T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items;
  return recent ? items.slice(-count) : [...items.slice(0, Math.ceil(count / 2)), ...items.slice(items.length - Math.floor(count / 2))];
}
function arrayValues(entries: readonly ArrayEntry[], total: number): JsonValue[] {
  const values: JsonValue[] = []; let next = 0;
  for (const entry of entries) {
    if (entry.index > next) values.push(`[已省略${next === 0 ? '前' : '中间'} ${entry.index - next} 项]`);
    values.push(entry.value); next = entry.index + 1;
  }
  if (next < total) values.push(`[已省略后 ${total - next} 项]`);
  return values;
}
/** Share space fairly; short values release their unused allowance to longer siblings. */
function shareBudget(lengths: readonly number[], budget: number): number[] {
  const grants = lengths.map(() => 0); let remaining = budget; let pending = lengths.map((_length, index) => index);
  while (pending.length) {
    const share = Math.floor(remaining / pending.length);
    const small = pending.filter(index => (lengths[index] ?? 0) <= share);
    if (!small.length) { for (const index of pending) { grants[index] = share + (remaining % pending.length > pending.indexOf(index) ? 1 : 0); } break; }
    for (const index of small) { grants[index] = lengths[index] ?? 0; remaining -= grants[index] ?? 0; }
    const smallSet = new Set(small); pending = pending.filter(index => !smallSet.has(index));
  }
  return grants;
}

/** Excerpts only. originalChars describes the original serialized value, never an estimated token count. */
export function safeAuditPreview(value: unknown, options: AuditPreviewOptions = {}): AuditPreview {
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(0, Math.min(8000, Math.floor(options.maxChars ?? 4000))) : 4000;
  let raw: string;
  try { const encoded = typeof value === 'string' ? value : JSON.stringify(value); if (encoded === undefined) return { text: '[无可序列化正文]'.slice(0, maxChars), originalChars: 0, truncated: false, redacted: true }; raw = encoded; }
  catch { return { text: '[无法序列化的内容已省略]'.slice(0, maxChars), originalChars: 0, truncated: true, redacted: true }; }
  if (raw.length > INSPECTION_LIMIT) return { text: '[内容超过审计检查上限，正文已省略]'.slice(0, maxChars), originalChars: raw.length, truncated: true, redacted: true };
  const secrets = [...new Set((options.knownSecrets ?? []).filter(secret => secret.length > 0))].sort((a, b) => b.length - a.length);
  const recentArrayKeys = new Set(options.recentArrayKeys ?? []);
  let redacted = false; let truncated = false;
  function mask(text: string): string {
    let safe = text;
    for (const secret of secrets) {
      safe = safe.split(secret).join(OMITTED);
      const encoded = JSON.stringify(secret).slice(1, -1);
      if (encoded !== secret) safe = safe.split(encoded).join(OMITTED);
    }
    safe = safe.replace(/data:[^\s,;]+(?:;[^\s,]+)*,[^\s"'<>)]*/giu, '[附件数据已省略]');
    safe = safe.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${OMITTED}`);
    safe = safe.replace(/\b(?:sk|rk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu, OMITTED);
    safe = safe.replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/giu, `$1: ${OMITTED}`);
    safe = safe.replace(/(["']?(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|secret|token)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/giu, (_match: string, prefix: string, found: string) => `${prefix}${found.startsWith('"') ? JSON.stringify(OMITTED) : found.startsWith("'") ? `'${OMITTED}'` : OMITTED}`);
    safe = safe.replace(/https?:\/\/[^\s<>"']+/giu, found => {
      try {
        const url = new URL(found); const protectedUrl = !!url.username || !!url.password || !!url.search || !!url.hash;
        if (!protectedUrl) return found;
        url.username = ''; url.password = ''; url.hash = '';
        for (const name of [...url.searchParams.keys()]) url.searchParams.set(name, OMITTED);
        return url.toString();
      } catch { return '[地址已隐藏]'; }
    });
    if (safe !== text) redacted = true;
    return safe;
  }
  const arraySources = new WeakMap<JsonValue[], ArraySource>(); let nodes = 0;
  function sanitize(item: unknown, depth: number, recent = false): JsonValue {
    if (++nodes > 2000 || depth > 12) { truncated = true; return '[嵌套内容已省略]'; }
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (depth < 6 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try { const parsed: unknown = JSON.parse(item); return JSON.stringify(sanitize(parsed, depth + 1)); } catch { /* Ordinary text is handled below. */ }
      }
      return mask(item);
    }
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item;
    if (Array.isArray(item)) {
      const items: readonly unknown[] = item; const indices = select(items.map((_entry, index) => index), 200, recent);
      if (indices.length < items.length) truncated = true;
      const priority = recent ? [...indices].reverse() : indices;
      const entries = priority.map(index => ({ index, value: sanitize(items[index], depth + 1) })).sort((a, b) => a.index - b.index);
      const values = arrayValues(entries, items.length); arraySources.set(values, { entries, total: items.length, recent }); return values;
    }
    if (!record(item)) { redacted = true; return '[非数据内容已省略]'; }
    if (item['type'] === 'reasoning' || item['type'] === 'thinking') { redacted = true; return { type: item['type'], content: '[不记录模型内部思考]' }; }
    if (['input_image', 'input_file', 'input_audio', 'image', 'audio'].includes(typeof item['type'] === 'string' ? item['type'] : '')) { redacted = true; return { type: typeof item['type'] === 'string' ? item['type'] : 'attachment', content: '[附件内容已省略]' }; }
    const entries = Object.entries(item); const safe: [string, JsonValue][] = [];
    for (const [key, child] of entries.slice(0, 100)) {
      const name = mask(key);
      if (sensitiveName.test(key) && !(typeof child === 'number' && tokenMetricName.test(key)) || privateReasoningName.test(key)) { redacted = true; safe.push([name, OMITTED]); }
      else safe.push([name, sanitize(child, depth + 1, depth === 0 && recentArrayKeys.has(key))]);
    }
    if (entries.length > 100) { truncated = true; safe.push(['[审计省略]', '[更多字段已省略]']); }
    return Object.fromEntries(safe);
  }
  function boundedText(text: string, budget: number): string {
    const complete = JSON.stringify(text); if (complete.length <= budget) return complete;
    truncated = true;
    const suffix = (count: number): string => `…[已省略 ${count} 字符]`;
    if (JSON.stringify(suffix(text.length)).length > budget) return budget >= 3 ? '"…"' : budget >= 2 ? '""' : '';
    let low = 0; let high = Math.min(text.length, budget); let result = JSON.stringify(suffix(text.length));
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const end = middle > 0 && /[\uD800-\uDBFF]/u.test(text[middle - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(text[middle] ?? '') ? middle - 1 : middle;
      const candidate = JSON.stringify(text.slice(0, end) + suffix(text.length - end));
      if (candidate.length <= budget) { result = candidate; low = middle + 1; } else high = middle - 1;
    }
    return result;
  }
  function encode(item: JsonValue, budget: number): string {
    const complete = JSON.stringify(item); if (complete.length <= budget) return complete;
    truncated = true;
    if (typeof item === 'string') return boundedText(item, budget);
    if (budget < 3) return budget >= 2 ? (Array.isArray(item) ? '[]' : '{}') : '';
    if (Array.isArray(item)) {
      const source = arraySources.get(item) ?? { entries: item.map((child, index) => ({ index, value: child })), total: item.length, recent: false };
      let count = Math.min(source.entries.length, Math.max(1, Math.floor(budget / 180)));
      let selected = arrayValues(select(source.entries, count, source.recent), source.total);
      while (count > 0 && 2 + Math.max(0, selected.length - 1) + selected.length * 3 > budget) { count--; selected = arrayValues(select(source.entries, count, source.recent), source.total); }
      if (!count) return budget >= 5 ? '["…"]' : '[]';
      const allowances = shareBudget(selected.map(child => JSON.stringify(child).length), budget - 2 - Math.max(0, selected.length - 1));
      return `[${selected.map((child, index) => encode(child, allowances[index] ?? 0)).join(',')}]`;
    }
    if (item === null || typeof item !== 'object') return '"…"';
    const entries = Object.entries(item); const indexed = entries.map(([key, child], index) => ({ key, child, index }));
    const candidates = [...indexed].sort((a, b) => Number(identityNames.has(b.key)) - Number(identityNames.has(a.key)) || a.index - b.index);
    const selected: typeof candidates = []; let reserved = 2;
    // Reserve a visible marker when not every field can be kept.
    const markerKey = '[审计省略]'; const markerValue = '[更多字段已省略]';
    const markerCost = JSON.stringify(markerKey).length + JSON.stringify(markerValue).length + 2;
    const allCost = entries.reduce((total, [key, child]) => total + JSON.stringify(key).length + 2 + Math.min(32, JSON.stringify(child).length), 1);
    const contentBudget = allCost <= budget ? budget : budget - markerCost;
    for (const entry of candidates) {
      const cost = JSON.stringify(entry.key).length + 1 + (selected.length ? 1 : 0) + Math.min(32, JSON.stringify(entry.child).length);
      if (reserved + cost <= contentBudget) { selected.push(entry); reserved += cost; }
    }
    selected.sort((a, b) => a.index - b.index);
    const fields: [string, JsonValue][] = selected.map(({ key, child }) => [key, child]);
    if (selected.length < entries.length && markerCost + 1 <= budget) fields.push([markerKey, markerValue]);
    if (!fields.length) return '{}';
    const overhead = 2 + fields.length - 1 + fields.reduce((sum, [key]) => sum + JSON.stringify(key).length + 1, 0);
    const allowances = shareBudget(fields.map(([, child]) => JSON.stringify(child).length), Math.max(0, budget - overhead));
    return `{${fields.map(([key, child], index) => `${JSON.stringify(key)}:${encode(child, allowances[index] ?? 0)}`).join(',')}}`;
  }
  try {
    let parsed: unknown;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) { const safe = mask(value); return { text: safe.slice(0, maxChars), originalChars: raw.length, truncated: safe.length > maxChars, redacted }; }
      try { parsed = JSON.parse(value); } catch { const safe = mask(value); return { text: safe.slice(0, maxChars), originalChars: raw.length, truncated: safe.length > maxChars, redacted }; }
    } else parsed = JSON.parse(raw);
    const safe = sanitize(parsed, 0); const text = encode(safe, maxChars);
    return { text, originalChars: raw.length, truncated, redacted };
  } catch { return { text: '[审计预览无法生成，正文已省略]'.slice(0, maxChars), originalChars: raw.length, truncated: true, redacted: true }; }
}

/** Never persist provider exception bodies, headers, URLs or stack traces. */
export function safeAuditError(error: unknown, knownSecrets: readonly string[] = []): string {
  void knownSecrets;
  if (error instanceof Error && error.name === 'AbortError') return '调用已取消。';
  if (error instanceof Error && error.name === 'RunBudgetError') return '模型调用达到预算限制。';
  if (error instanceof Error && error.name === 'AuthorizationError') return '权限检查未通过。';
  return '调用失败。原始错误响应未写入审计记录。';
}
