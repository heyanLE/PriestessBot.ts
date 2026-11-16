/**
 * Cache accounting for model usage.
 *
 * The provider reports cache hits inside `input_tokens_details.cached_tokens`
 * (Chat Completions uses top-level `prompt_cache_hit_tokens`; the SDK normalises
 * both into per-request input details). Without this number every "shrink the
 * prefix" change is unverifiable, because the request still carries the text.
 */

export type TokenDetail = Readonly<Record<string, unknown>>;

export interface UsageLike {
  readonly inputTokens?: number;
  readonly inputTokensDetails?: readonly TokenDetail[];
}

/** Sum every cache-hit counter the provider reported for one usage record. */
export function cachedInputTokens(usage: UsageLike): number {
  let total = 0;
  for (const details of usage.inputTokensDetails ?? []) {
    for (const key of ['cached_tokens', 'cached_input_tokens']) {
      const value = details[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += value;
    }
  }
  return Math.trunc(total);
}

/** Share of the input served from cache, clamped to the reported input size. */
export function cacheHitRatio(usage: UsageLike): number {
  const input = usage.inputTokens ?? 0;
  if (!Number.isFinite(input) || input <= 0) return 0;
  return Math.min(1, cachedInputTokens(usage) / input);
}
