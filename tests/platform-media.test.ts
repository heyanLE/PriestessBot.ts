import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageEventSchema } from '../packages/contracts/src/index.js';
import { MediaPipeline } from '../packages/adapters/src/media/pipeline.js';
import type { PlatformAdapter } from '../packages/adapters/src/platforms/types.js';
function makePdf(): Uint8Array {
  const content = 'BT /F1 12 Tf 72 700 Td (Hello PDF) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets: number[] = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
await test('Media pipeline parses PDF pages and rejects malformed text/binary files', async () => {
  const pipeline = new MediaPipeline({ maxBytes: 100_000, maxTextChars: 1000, maxPdfPages: 2 });
  assert.match(await pipeline.extract(makePdf(), 'application/pdf', 'document.pdf'), /\[Page 1\][\s\S]*Hello PDF/);
  assert.equal(await pipeline.extract(Buffer.from('# Title\n中文'), 'text/markdown', 'test.md'), '# Title\n中文');
  await assert.rejects(pipeline.extract(Buffer.from([255, 255]), 'text/plain', 'bad.txt'), /UTF-8/);
  await assert.rejects(pipeline.extract(Buffer.from('binary'), 'application/octet-stream', 'bad.exe'), /not supported/);
});
await test('Media pipeline materializes verified image data and file text without leaking token URLs', async () => {
  const pipeline = new MediaPipeline();
  const adapter: PlatformAdapter = { id: 'fixture', capabilities: { edit: false, images: true, files: true, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: () => Promise.reject(new Error('not used')), edit: () => Promise.reject(new Error('not used')), downloadMedia: part => Promise.resolve({ bytes: part.type === 'image' ? Buffer.from([255, 216, 255, 224]) : Buffer.from('Untrusted text'), mimeType: part.type === 'image' ? 'image/jpeg' : 'text/plain', name: part.type === 'image' ? 'image.jpg' : 'notes.txt' }) };
  const event = MessageEventSchema.parse({ platform: 'fixture', platformType: 'telegram', sessionId: 'alice', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'm1', timestamp: 0, parts: [{ type: 'image', url: 'telegram-file:123' }, { type: 'file', url: 'telegram-file:456', name: 'notes.txt', mimeType: 'text/plain' }] });
  const prepared = await pipeline.prepare(event, adapter, new AbortController().signal);
  const image = prepared.parts[0]; assert.ok(image?.type === 'image'); assert.match(image.url, /^data:image\/jpeg;base64,/);
  const file = prepared.parts[1]; assert.ok(file?.type === 'file'); assert.equal(file.extractedText, 'Untrusted text'); assert.match(file.url, /^attachment:sha256:/);
  adapter.downloadMedia = () => Promise.resolve({ bytes: Buffer.from('<html>fake</html>'), mimeType: 'image/jpeg', name: 'fake.jpg' });
  await assert.rejects(pipeline.prepare(event, adapter, new AbortController().signal), /supported image format/);
});
await test('Media budget applies to combined image and file bytes and stops before downloading further parts', async () => {
  let downloads = 0;
  const adapter: PlatformAdapter = { id: 'aggregate-bytes', capabilities: { edit: false, images: true, files: true, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: () => Promise.reject(new Error('Unused')), edit: () => Promise.reject(new Error('Unused')), downloadMedia: part => { downloads++; return Promise.resolve({ bytes: part.type === 'image' ? Buffer.from([255, 216, 255, 224]) : Buffer.from('text'), mimeType: part.mimeType, name: part.type === 'file' ? part.name : 'image.jpg' }); } };
  const event = MessageEventSchema.parse({ platform: adapter.id, platformType: 'telegram', sessionId: 'alice', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'aggregate', timestamp: 0, parts: [{ type: 'image', url: 'telegram-file:image' }, { type: 'file', url: 'telegram-file:a', mimeType: 'text/plain', name: 'a.txt' }, { type: 'file', url: 'telegram-file:b', mimeType: 'text/plain', name: 'b.txt' }] });
  const policy = { maxBytes: 7, maxTextChars: 100, maxPdfPages: 2 };
  await assert.rejects(new MediaPipeline(policy).prepare(event, adapter, new AbortController().signal), /Combined media exceeds size limit/);
  assert.equal(downloads, 2, 'The third attachment must not be downloaded after the aggregate budget is exhausted');
  const exact = await new MediaPipeline({ ...policy, maxBytes: 8 }).prepare({ ...event, parts: event.parts.slice(0, 2) }, adapter, new AbortController().signal);
  assert.equal(exact.parts.length, 2, 'An exact-budget image/file pair remains valid');
});
await test('Extraction budget applies to the combined text of all attachments', async () => {
  let downloads = 0;
  const adapter: PlatformAdapter = { id: 'aggregate-text', capabilities: { edit: false, images: true, files: true, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: () => Promise.reject(new Error('Unused')), edit: () => Promise.reject(new Error('Unused')), downloadMedia: part => { downloads++; return Promise.resolve({ bytes: Buffer.from('abcd'), mimeType: 'text/plain', name: part.type === 'file' ? part.name : 'unused' }); } };
  const event = MessageEventSchema.parse({ platform: adapter.id, platformType: 'telegram', sessionId: 'alice', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'text-budget', timestamp: 0, parts: ['a', 'b', 'c'].map(id => ({ type: 'file', url: `telegram-file:${id}`, mimeType: 'text/plain', name: `${id}.txt` })) });
  await assert.rejects(new MediaPipeline({ maxBytes: 100, maxTextChars: 7, maxPdfPages: 2 }).prepare(event, adapter, new AbortController().signal), /Combined extracted attachments exceed text limit/);
  assert.equal(downloads, 2);
  const exact = await new MediaPipeline({ maxBytes: 100, maxTextChars: 8, maxPdfPages: 2 }).prepare({ ...event, parts: event.parts.slice(0, 2) }, adapter, new AbortController().signal);
  assert.equal(exact.parts.filter(part => part.type === 'file').map(part => part.extractedText).join(''), 'abcdabcd');
});
