import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunEventSchema } from '../packages/contracts/src/index.js';
import { cacheHitRatio, cachedInputTokens } from '../packages/adapters/src/agents/usage.js';

void test('cache hit tokens sum every reported detail entry', () => {
  assert.equal(cachedInputTokens({}), 0);
  assert.equal(cachedInputTokens({ inputTokens: 1000, inputTokensDetails: [] }), 0);
  assert.equal(cachedInputTokens({ inputTokensDetails: [{ cached_tokens: 640 }] }), 640);
  assert.equal(cachedInputTokens({ inputTokensDetails: [{ cached_tokens: 640 }, { cached_tokens: 160 }] }), 800);
  // Some providers use the chat-completions spelling.
  assert.equal(cachedInputTokens({ inputTokensDetails: [{ cached_input_tokens: 320 }] }), 320);
  // Anything missing, negative or non-numeric is ignored rather than trusted.
  assert.equal(cachedInputTokens({ inputTokensDetails: [{ cached_tokens: -5 }, { cached_tokens: 'x' }, {}] }), 0);
});

void test('cache hit ratio clamps to the reported input size', () => {
  assert.equal(cacheHitRatio({ inputTokens: 0, inputTokensDetails: [{ cached_tokens: 10 }] }), 0);
  assert.equal(cacheHitRatio({ inputTokens: 1000, inputTokensDetails: [{ cached_tokens: 250 }] }), 0.25);
  assert.equal(cacheHitRatio({ inputTokens: 1000, inputTokensDetails: [{ cached_tokens: 2000 }] }), 1);
});

void test('usage events may carry cached input tokens without breaking older records', () => {
  const base = { runId: 'r', turnId: 't', sequence: 1, timestamp: 1, type: 'usage', inputTokens: 1000, outputTokens: 50 };
  assert.equal(RunEventSchema.parse(base).type, 'usage');
  const parsed = RunEventSchema.parse({ ...base, cachedInputTokens: 640 });
  assert.equal(parsed.type === 'usage' ? parsed.cachedInputTokens : undefined, 640);
});
