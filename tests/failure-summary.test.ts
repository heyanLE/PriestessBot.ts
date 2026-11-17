import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunEventSchema } from '../packages/contracts/src/index.js';
import { failureSummary } from '../apps/server/src/runtime.js';

void test('known failure classes keep their real summary', () => {
  for (const message of [
    'Context window exceeded after dynamic context refresh; reduce input or retry after context changes',
    'Finalization input exceeds remaining cumulative budget',
    'Tool is unavailable for this run',
    'Model stream interrupted by response timeout',
    'Run token budget exhausted (used 100, limit 90)',
  ]) assert.equal(failureSummary(message), message);
});

void test('unknown provider text is replaced, not forwarded', () => {
  assert.equal(failureSummary('provider said: invalid api key sk-abc'), 'Execution failed; verify model and resource configuration');
  assert.equal(failureSummary('random internal stack detail'), 'Execution failed; verify model and resource configuration');
});

void test('model calls may carry request size and its estimate', () => {
  const base = { runId: 'r', turnId: 't', sequence: 1, timestamp: 1, type: 'model_call', callId: 'c', model: 'deepseek-flash', source: 'model', status: 'started' };
  const parsed = RunEventSchema.parse({ ...base, requestBytes: 12345, estimatedTokens: 6789 });
  assert.equal(parsed.type === 'model_call' ? parsed.requestBytes : undefined, 12345);
  assert.equal(parsed.type === 'model_call' ? parsed.estimatedTokens : undefined, 6789);
});
