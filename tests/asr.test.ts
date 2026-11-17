import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsrSettingsSchema } from '../packages/contracts/src/asr.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { AsrError, AsrSettingsService, asrAvailable, DeepSeekAsr } from '../apps/server/src/asr.js';

const enabled = (overrides: Record<string, unknown> = {}) => AsrSettingsSchema.parse({ enabled: true, ...overrides });
const wav = new Uint8Array(1024);
const SIGNAL = new AbortController().signal;

/** Wrap a synchronous response builder in the promise shape fetch returns. */
function transportOf(handler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (input, init) => {
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
    return Promise.resolve(handler(url, init));
  };
}

void test('ASR defaults stay inert until enabled and credentialed', () => {
  const settings = AsrSettingsSchema.parse({});
  assert.equal(settings.enabled, false);
  assert.equal(settings.apiKeyEnv, 'DEEPSEEK_ASR_API_KEY');
  assert.equal(settings.maxBytes, 8 * 1024 * 1024);
  assert.equal(asrAvailable(settings, 'key'), false);
  assert.equal(asrAvailable(enabled(), undefined), false);
  assert.equal(asrAvailable(enabled(), 'key'), true);
});

void test('saving bumps the revision and rejects a stale one', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new AsrSettingsService(store, () => 'key');
    const saved = service.update({ enabled: true, apiBase: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_ASR_API_KEY', maxBytes: 1024, timeoutMs: 5000, maxDurationSeconds: 60 }, 0);
    assert.equal(saved.revision, 1);
    assert.throws(() => service.update({ enabled: false, apiBase: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_ASR_API_KEY', maxBytes: 1024, timeoutMs: 5000, maxDurationSeconds: 60 }, 0), AsrError);
    assert.equal(service.status().credentialConfigured, true);
  } finally { store.close(); }
});

void test('transcription sends multipart audio and returns the text', async () => {
  let seenUrl = '';
  let seenAuthorization: string | null = null;
  const client = new DeepSeekAsr(() => enabled(), () => 'secret-key', transportOf((url, init) => {
    seenUrl = url;
    seenAuthorization = new Headers(init?.headers).get('authorization');
    assert.ok(init?.body instanceof FormData);
    assert.ok(init.body.get('file'));
    return Response.json({ request_id: 'r', text: ' 上海今天天气怎么样？ ', duration_ms: 3200 });
  }));
  const result = await client.transcribe(wav, 'audio/wav', SIGNAL);
  assert.equal(result.text, '上海今天天气怎么样？');
  assert.equal(result.durationMs, 3200);
  assert.equal(seenUrl, 'https://api.deepseek.com/v1/tools/asr');
  assert.equal(seenAuthorization, 'Bearer secret-key');
});

void test('provider failures map to readable reasons', async () => {
  for (const [status, pattern] of [[400, /格式不受支持/u], [413, /8 MiB/u], [429, /并发/u], [503, /繁忙/u], [504, /超时/u]] as const) {
    const client = new DeepSeekAsr(() => enabled(), () => 'key', transportOf(() => new Response('{}', { status })));
    await assert.rejects(client.transcribe(wav, 'audio/wav', SIGNAL), pattern);
  }
});

void test('guards run before any request leaves the process', async () => {
  let calls = 0;
  const counting = transportOf(() => { calls++; return Response.json({ text: 'x', duration_ms: 1 }); });
  const disabled = new DeepSeekAsr(() => AsrSettingsSchema.parse({}), () => 'key', counting);
  await assert.rejects(disabled.transcribe(wav, 'audio/wav', SIGNAL), /未启用/u);
  const noKey = new DeepSeekAsr(() => enabled(), () => undefined, counting);
  await assert.rejects(noKey.transcribe(wav, 'audio/wav', SIGNAL), /凭据未配置/u);
  const tiny = new DeepSeekAsr(() => enabled({ maxBytes: 2048 }), () => 'key', counting);
  await assert.rejects(tiny.transcribe(new Uint8Array(4096), 'audio/wav', SIGNAL), /超过上限/u);
  assert.equal(calls, 0);
});

void test('malformed or empty results are rejected', async () => {
  const bad = new DeepSeekAsr(() => enabled(), () => 'key', transportOf(() => new Response('not json', { status: 200 })));
  await assert.rejects(bad.transcribe(wav, 'audio/wav', SIGNAL), /无效响应/u);
  const empty = new DeepSeekAsr(() => enabled(), () => 'key', transportOf(() => Response.json({ text: '   ', duration_ms: 10 })));
  await assert.rejects(empty.transcribe(wav, 'audio/wav', SIGNAL), /结果为空/u);
});
