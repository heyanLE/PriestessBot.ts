import type { ModelPayloadDocument } from '../../../../packages/contracts/src/model-records';
import { auditSections, isAuditJsonObject, type AuditJsonValue, type AuditSection } from './audit-preview-model';

export type RawPayloadValue = AuditJsonValue;
export type ParsedModelPayload = { kind: 'json'; value: RawPayloadValue } | { kind: 'events'; events: RawPayloadEvent[]; unparsed: number } | { kind: 'text'; reason: 'text' | 'invalid_json' | 'deep_json' };
export interface RawPayloadEvent { id: string; event: string; value: RawPayloadValue | string; json: boolean; }
export interface RawPayloadSection { title: string; value: RawPayloadValue; messages: boolean; }

function isJson(value: unknown): value is RawPayloadValue {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (pending.length) {
    const item = pending.pop(); if (!item) break;
    if (item.depth > 100) return false;
    if (item.value === null || typeof item.value === 'string' || typeof item.value === 'boolean') continue;
    if (typeof item.value === 'number') { if (!Number.isFinite(item.value)) return false; continue; }
    if (typeof item.value !== 'object') return false;
    const values: unknown[] = Array.isArray(item.value) ? item.value : Object.values(item.value);
    for (const child of values) pending.push({ value: child, depth: item.depth + 1 });
  }
  return true;
}
function parseJson(text: string): { value: RawPayloadValue } | null {
  try { const value: unknown = JSON.parse(text); return isJson(value) ? { value } : null; } catch { return null; }
}
export function parseModelPayload(text: string, contentType: string): ParsedModelPayload {
  if (contentType.toLowerCase().includes('text/event-stream')) {
    const events: RawPayloadEvent[] = []; let unparsed = 0;
    for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
      if (!block.trim()) continue;
      const lines = block.split('\n'); const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) { if (!lines.every(line => !line || line.startsWith(':'))) unparsed++; continue; }
      const parsed = parseJson(data);
      events.push({ id: String(events.length), event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() || (data === '[DONE]' ? 'done' : 'message'), value: parsed?.value ?? data, json: parsed !== null });
    }
    return { kind: 'events', events, unparsed };
  }
  try { const value: unknown = JSON.parse(text); return isJson(value) ? { kind: 'json', value } : { kind: 'text', reason: 'deep_json' }; }
  catch { return { kind: 'text', reason: contentType.toLowerCase().includes('json') || /^\s*[\[{]/u.test(text) ? 'invalid_json' : 'text' }; }
}
function remaining(value: Record<string, RawPayloadValue>, keys: readonly string[]): Record<string, RawPayloadValue> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}
function hasValues(value: Record<string, RawPayloadValue>): boolean { return Object.keys(value).length > 0; }
/** Reorganize the view without changing, removing, or redacting any stored value. */
export function modelPayloadSections(value: RawPayloadValue): RawPayloadSection[] {
  if (!isAuditJsonObject(value)) return [{ title: Array.isArray(value) ? '消息与事件' : '模型数据', value, messages: Array.isArray(value) }];
  const sections: RawPayloadSection[] = [];
  const events = value['events'];
  if (Array.isArray(events)) {
    const finalEvent = [...events].reverse().find(event => isAuditJsonObject(event) && event['type'] === 'response_done');
    if (finalEvent && isAuditJsonObject(finalEvent) && finalEvent['response'] !== undefined) sections.push({ title: 'SDK 完整响应', value: finalEvent['response'], messages: false });
    sections.push({ title: 'SDK 流事件', value: events, messages: false });
    const extra = remaining(value, ['events']); if (hasValues(extra)) sections.push({ title: '保存状态与其他字段', value: extra, messages: false });
    return sections;
  }
  const instructions = value['instructions'] ?? value['systemInstructions'];
  const input = value['input'] ?? value['messages'];
  if (input !== undefined || instructions !== undefined) {
    if (instructions !== undefined) sections.push({ title: '系统指令', value: instructions, messages: false });
    if (input !== undefined) sections.push({ title: '输入消息 · 人格、上下文与对话', value: input, messages: true });
    if (value['tools'] !== undefined) sections.push({ title: '工具定义与参数', value: value['tools'], messages: false });
    if (value['settings'] !== undefined) sections.push({ title: '模型参数', value: value['settings'], messages: false });
    if (value['modelSettings'] !== undefined) sections.push({ title: '模型参数', value: value['modelSettings'], messages: false });
    const extra = remaining(value, ['instructions', 'systemInstructions', 'input', 'messages', 'tools', 'settings', 'modelSettings']);
    if (hasValues(extra)) sections.push({ title: '请求参数与其他字段', value: extra, messages: false });
    return sections;
  }
  if (value['output'] !== undefined) {
    sections.push({ title: '模型输出', value: value['output'], messages: true });
    const extra = remaining(value, ['output']); if (hasValues(extra)) sections.push({ title: '响应参数与用量', value: extra, messages: false });
    return sections;
  }
  if (value['choices'] !== undefined) {
    sections.push({ title: '模型响应 choices', value: value['choices'], messages: false });
    const extra = remaining(value, ['choices']); if (hasValues(extra)) sections.push({ title: '响应参数与用量', value: extra, messages: false });
    return sections;
  }
  return [{ title: '模型数据', value, messages: false }];
}
export function modelMessageCards(value: RawPayloadValue, limit = 30): Extract<AuditSection, { kind: 'messages' }>['cards'] {
  const page = Array.isArray(value) ? value.slice(0, limit) : value;
  const section = auditSections(page).find(item => item.kind === 'messages');
  if (section?.kind !== 'messages') return [];
  return section.cards.map(card => {
    const text = card.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n');
    const title = text.startsWith('<context_anchor name="persona"') ? '人格指令' : text.startsWith('<context_anchor name="persona_examples"') ? '示例对话' : text.startsWith('<dynamic_context ') ? '当前动态上下文' : '';
    return title ? { ...card, title, metadata: ['原始角色：user', ...card.metadata] } : card;
  });
}
export function rawStringSummary(text: string): { label: string; folded: boolean; excerpt: string } {
  const mime = /^data:([^;,\s]+)(?:;[^,]*)?;base64,/iu.exec(text)?.[1];
  if (mime) return { label: `${mime.startsWith('image/') ? '图片' : '二进制'} Base64 · ${text.length.toLocaleString('zh-CN')} 字符`, folded: true, excerpt: '' };
  const folded = text.length > 1600;
  return { label: `文本 · ${text.length.toLocaleString('zh-CN')} 字符`, folded, excerpt: folded ? `${text.slice(0, 700)}…` : text };
}
export function rawPayloadFilename(kind: string, attempt: number, contentType: string): string { return `model-${kind}-attempt-${attempt}.${contentType.toLowerCase().includes('json') ? 'json' : 'txt'}`; }

/** Prefer the latest actual transmission unless the user selected a document explicitly. */
export function preferredModelDocument(documents: readonly ModelPayloadDocument[]): ModelPayloadDocument | undefined {
  const requests = documents.filter(item => item.kind === 'provider_request').sort((left, right) => right.attempt - left.attempt || right.createdAt - left.createdAt);
  return requests[0] ?? documents.find(item => item.kind === 'sdk_request') ?? documents[0];
}
