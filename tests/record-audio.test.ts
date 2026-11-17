import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordAudioBytes } from '../packages/adapters/src/platforms/napcat.js';

void test('base64 payloads decode without a network call', async () => {
  const bytes = await recordAudioBytes('base64://aGVsbG8=');
  assert.equal(Buffer.from(bytes).toString('utf8'), 'hello');
  const raw = await recordAudioBytes(Buffer.from('hello world '.repeat(10)).toString('base64'));
  assert.equal(Buffer.from(raw).toString('utf8'), 'hello world '.repeat(10));
});

void test('http references download through the transport', async () => {
  let seen = '';
  const bytes = await recordAudioBytes('https://napcat.invalid/record.wav', (input) => {
    seen = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  });
  assert.equal(seen, 'https://napcat.invalid/record.wav');
  assert.deepEqual([...bytes], [1, 2, 3]);
});

void test('a host path is refused instead of read', async () => {
  await assert.rejects(recordAudioBytes('/root/.config/QQ/record/abc.wav'), /本地路径/u);
});
