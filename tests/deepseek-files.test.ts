import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionSchema, MessageEventSchema } from '../packages/contracts/src/index.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { DeepSeekFiles, deepseekFilePurpose } from '../packages/adapters/src/media/deepseek-files.js';
import { MediaPipeline } from '../packages/adapters/src/media/pipeline.js';

const connection = () => ConnectionSchema.parse({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'KEY', fileUpload: {} });
const media = { name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new TextEncoder().encode('fixture document') };

void test('document upload orders purpose first, sets expiry, caches per credential/session and enforces reference ownership', async () => {
  const store = new RuntimeStore(':memory:'); let calls = 0; let key = 'first-secret';
  const service = new DeepSeekFiles(store, () => key, (url, init) => {
    calls++;
    assert.ok(url instanceof URL); assert.equal(url.href, 'https://api.deepseek.com/files');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.body instanceof FormData);
    assert.deepEqual([...init.body.keys()], ['purpose', 'expires_after[anchor]', 'expires_after[seconds]', 'file']);
    assert.equal(init.body.get('purpose'), 'rich_layout_recognition');
    assert.equal(init.body.get('expires_after[seconds]'), '604800');
    return Promise.resolve(Response.json({ id: `file-api-${calls}`, expires_at: Math.floor(Date.now() / 1000) + 604800 }));
  });
  try {
    const c = connection(); const signal = new AbortController().signal;
    const first = await service.upload(c, 'private-alice', media, signal, () => undefined);
    assert.deepEqual(await service.upload(c, 'private-alice', media, signal, () => undefined), first); assert.equal(calls, 1);
    const input = [{ role: 'user', content: [{ type: 'input_file', file: { id: first.fileId } }] }];
    service.assertReferences(c, 'private-alice', input);
    assert.throws(() => service.assertReferences(c, 'private-bob', input), /不属于/);
    assert.throws(() => service.assertReferences(undefined, 'private-alice', input), /关闭/);
    await service.upload(c, 'private-bob', media, signal, () => undefined); assert.equal(calls, 2);
    key = 'rotated-secret';
    assert.throws(() => service.assertReferences(c, 'private-alice', input), /不属于/);
    await service.upload(c, 'private-alice', media, signal, () => undefined); assert.equal(calls, 3);
  } finally { store.close(); }
});

void test('failed and expired upload responses never become model file references', async () => {
  for (const response of [new Response('SECRET', { status: 402 }), Response.json({ error: { message: 'SECRET' } }), Response.json({ id: 'file-api-old', expires_at: 1 })]) {
    const store = new RuntimeStore(':memory:');
    try {
      const service = new DeepSeekFiles(store, () => 'key', () => Promise.resolve(response));
      await assert.rejects(service.upload(connection(), 'scope', media, new AbortController().signal, () => undefined), error => error instanceof Error && !error.message.includes('SECRET'));
      assert.equal(store.db.prepare("SELECT COUNT(*) n FROM documents WHERE namespace='model-file-references'").get()?.['n'], 0);
    } finally { store.close(); }
  }
});

void test('file media uses remote parsing only when enabled and rejects cancelled uploads before sending', async () => {
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'chat', sessionType: 'private', senderId: 'alice', messageId: 'm', timestamp: 1, botId: 'bot', parts: [{ type: 'file', name: media.name, mimeType: media.mimeType, url: 'platform:file' }] });
  const pipeline = new MediaPipeline(); const download = { downloadMedia: () => Promise.resolve(media) };
  const reference = { provider: 'deepseek' as const, connectionId: 'deepseek', fileId: 'file-api-uploaded', expiresAt: Date.now() + 60000 };
  const prepared = await pipeline.prepare(message, download, new AbortController().signal, () => Promise.resolve(reference));
  assert.equal(prepared.parts[0]?.type, 'file');
  if (prepared.parts[0]?.type === 'file') { assert.deepEqual(prepared.parts[0].modelFile, reference); assert.equal(prepared.parts[0].extractedText, undefined); }
  await assert.rejects(pipeline.prepare(message, download, new AbortController().signal), /无法读取 DOCX|not supported/);
  const store = new RuntimeStore(':memory:'); let calls = 0;
  try { const files = new DeepSeekFiles(store, () => 'key', () => { calls++; return Promise.resolve(Response.json({})); }); await assert.rejects(files.upload(connection(), 'scope', media, AbortSignal.abort(), () => undefined)); assert.equal(calls, 0); }
  finally { store.close(); }
  assert.equal(deepseekFilePurpose('table.xlsx', 'application/octet-stream', 'rich_layout_recognition'), 'user_data');
  assert.equal(deepseekFilePurpose('notes.txt', 'text/plain', 'rich_layout_recognition'), 'user_data');
  assert.throws(() => deepseekFilePurpose('archive.zip', 'application/zip', 'rich_layout_recognition'), /不支持/);
});
