import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBudgetUsage } from '../packages/adapters/src/agents/budget.js';
import { cachedInputTokens } from '../packages/adapters/src/agents/usage.js';

void test('provider usage details survive the budget wrapper', () => {
  const usage = toBudgetUsage({ inputTokens: 1000, outputTokens: 20, totalTokens: 1020, requests: 1, inputTokensDetails: { cached_tokens: 900 } });
  assert.equal(usage.inputTokens, 1000);
  assert.equal(cachedInputTokens(usage), 900);
});

void test('a provider without details reports zero instead of failing', () => {
  const usage = toBudgetUsage({ inputTokens: 500, outputTokens: 10, totalTokens: 510 });
  assert.equal(cachedInputTokens(usage), 0);
});
