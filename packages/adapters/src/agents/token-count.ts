import { createHash } from 'node:crypto';
import type { AgentInputItem } from '@openai/agents';
import { z } from 'zod';

/** Fallback character weights; this is not a tokenizer. See docs/context-policy-parity.md for source comparison. */
export function estimateTextTokens(text: string): number {
  let chinese = 0; let other = 0;
  for (const character of text) { if (character >= '\u4e00' && character <= '\u9fff') chinese++; else other++; }
  return Math.floor(chinese * 0.6 + other * 0.3);
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function estimateContextTokens(value: unknown): number {
  if (typeof value === 'string') return value.startsWith('data:image/') ? 765 : estimateTextTokens(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, item: unknown) => sum + estimateContextTokens(item), 0);
  if (!record(value)) return 0;
  if (value.type === 'input_image' || value.type === 'image_url') return 765;
  if (value.type === 'input_audio' || value.type === 'audio') return 500;
  if ('content' in value) return estimateContextTokens(value.content);
  if ('text' in value) return estimateContextTokens(value.text);
  if ('output' in value) return estimateContextTokens(value.output);
  return estimateTextTokens(JSON.stringify(value));
}
export const UsageAnchorSchema = z.object({ prefixHash: z.string().length(64), prefixItems: z.number().int().nonnegative(), inputTokens: z.number().int().positive(), reservedTokens: z.number().nonnegative(), observedAt: z.number() }).strict();
export type UsageAnchor = z.infer<typeof UsageAnchorSchema>;
export const historyHash = (items: readonly AgentInputItem[]): string => createHash('sha256').update(JSON.stringify(items)).digest('hex');
export function countContextTokens(items: readonly AgentInputItem[], anchor?: UsageAnchor): number {
  if (anchor && anchor.prefixItems <= items.length && historyHash(items.slice(0, anchor.prefixItems)) === anchor.prefixHash) return Math.max(0, anchor.inputTokens - anchor.reservedTokens) + estimateContextTokens(items.slice(anchor.prefixItems));
  return estimateContextTokens(items);
}
