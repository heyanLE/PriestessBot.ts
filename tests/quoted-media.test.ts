import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageEventSchema, PlatformConfigSchema, type MessageEvent } from '../packages/contracts/src/index.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore } from '../packages/adapters/src/platforms/transport.js';
import { MediaPipeline } from '../packages/adapters/src/media/pipeline.js';
import { GroupHistoryBuffer, MessageContextBuilder } from '../packages/adapters/src/messages/context.js';
import type { PlatformAdapter } from '../packages/adapters/src/platforms/types.js';
const envelope = (data: unknown): Response => new Response(JSON.stringify({ status: 'ok', retcode: 0, data }), { headers: { 'content-type': 'application/json' } });
const source = { message_id: 2, message_type: 'group', group_id: 8, time: 100, sender: { user_id: 20, nickname: '原发送者' }, message: [{ type: 'image', data: { file: 'secret-image-id' } }, { type: 'file', data: { file_id: 'notes', name: 'notes.txt' } }, { type: 'text', data: { text: '原图' } }] };
const incoming = { post_type: 'message', message_type: 'group', message_id: 3, user_id: 7, group_id: 8, group_name: '测试群', self_id: 999, time: 200, sender: { nickname: '当前发送者' }, message: [{ type: 'reply', data: { id: '2' } }, { type: 'text', data: { text: '看这个' } }, { type: 'image', data: { url: 'https://example.org/new.jpg' } }] };
function napcat(data: unknown, calls: string[] = []): NapCatAdapter {
  const config = PlatformConfigSchema.parse({ id: 'qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:3001', apiBase: 'http://127.0.0.1:3000' });
  if (config.type !== 'napcat') throw new Error('Invalid fixture');
  return new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, fetch: url => { calls.push(String(url)); return Promise.resolve(envelope(data)); } });
}
function media(): PlatformAdapter {
  return { id: 'qq', capabilities: { edit: false, images: true, files: true, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: () => Promise.reject(new Error('Never send')), edit: () => Promise.reject(new Error('Never edit')), downloadMedia: part => Promise.resolve({ bytes: part.type === 'image' ? Buffer.from([255, 216, 255, 224]) : Buffer.from('notes'), mimeType: part.type === 'image' ? 'image/jpeg' : 'text/plain', name: part.type === 'image' ? 'image.jpg' : part.name }) };
}
function firstQuote(event: MessageEvent | undefined) { const part = event?.parts[0]; assert.ok(part?.type === 'quote'); return part; }
await test('NapCat keeps original quote media and source distinct from current sender and newly attached image', async () => {
  const normalized = await napcat(source).normalize(incoming); assert.ok(normalized);
  assert.equal(normalized.sessionName, '测试群'); assert.equal(normalized.senderId, '7');
  const quote = firstQuote(normalized); assert.equal(quote.senderId, '20'); assert.equal(quote.timestamp, 100_000); assert.equal(quote.senderName, '原发送者'); assert.equal(quote.attachments?.length, 2);
  const prepared = await new MediaPipeline().prepare(normalized, media(), new AbortController().signal);
  const preparedQuote = firstQuote(prepared); const image = preparedQuote.attachments?.[0]; const file = preparedQuote.attachments?.[1];
  assert.ok(image?.type === 'image'); assert.match(image.url, /^data:image\/jpeg;base64,/);
  assert.ok(file?.type === 'file'); assert.equal(file.extractedText, 'notes'); assert.match(file.url, /^attachment:sha256:/);
  const top = prepared.parts[2]; assert.ok(top?.type === 'image'); assert.match(top.url, /^data:image\/jpeg;base64,/);
  const context = new MessageContextBuilder().prepare(prepared).context;
  assert.match(context, /当前场景：群聊/); assert.match(context, /sender_id=20/); assert.match(context, /Sender ID: 7/); assert.match(context, /被引用原消息/); assert.match(context, /imageIndex&quot;:1/); assert.match(context, /imageIndex&quot;:2/);
});
await test('CQ quote arrays/strings are equivalent and nested replies/forwards cannot recurse', async () => {
  const calls: string[] = [];
  const event = await napcat({ ...source, message: '图[CQ:image,file=original][CQ:reply,id=2]' }, calls).normalize(incoming);
  const quote = firstQuote(event); assert.equal(quote.attachments?.length, 1); assert.equal(quote.availability, 'partial'); assert.match(quote.text ?? '', /未展开/); assert.equal(calls.length, 1);
  const own = await napcat(source, calls).normalize({ ...incoming, message: [{ type: 'reply', data: { id: '3' } }] });
  assert.equal(firstQuote(own).unavailableReason, 'limit'); assert.equal(calls.length, 1);
});
await test('Quote provenance rejects cross-group, group/private mismatch, wrong message id and missing scope', async () => {
  for (const value of [{ ...source, group_id: 9 }, { ...source, message_type: 'private' }, { ...source, message_id: 4 }, { sender: source.sender, message: source.message }]) {
    const quote = firstQuote(await napcat(value).normalize(incoming)); assert.equal(quote.availability, 'unavailable'); assert.equal(quote.text, undefined); assert.equal(quote.attachments, undefined); assert.equal(quote.senderId, undefined);
  }
});
await test('Private quote must belong to current peer; bot messages require verified recipient', async () => {
  const event = { ...incoming, message_type: 'private', group_id: undefined };
  for (const sender of [7, 999]) {
    const quote = firstQuote(await napcat({ ...source, message_type: 'private', group_id: undefined, target_id: 7, sender: { user_id: sender } }).normalize(event)); assert.equal(quote.availability, 'available');
  }
  for (const sender of [20, 999]) {
    const quote = firstQuote(await napcat({ ...source, message_type: 'private', group_id: undefined, target_id: 6, sender: { user_id: sender } }).normalize(event)); assert.equal(quote.unavailableReason, 'scope_mismatch');
  }
});
await test('Quoted and current media share byte, count and extraction budgets', async () => {
  const event = await napcat(source).normalize(incoming); assert.ok(event);
  await assert.rejects(new MediaPipeline({ maxBytes: 10, maxTextChars: 100, maxPdfPages: 2 }).prepare(event, media(), new AbortController().signal), /Combined media exceeds size limit/);
  await assert.rejects(new MediaPipeline({ maxBytes: 100, maxTextChars: 100, maxPdfPages: 2, maxAttachments: 2 }).prepare(event, media(), new AbortController().signal), /attachment count limit/);
  await assert.rejects(new MediaPipeline({ maxBytes: 100, maxTextChars: 5, maxPdfPages: 2 }).prepare(event, media(), new AbortController().signal), /Combined extracted attachments exceed text limit/);
});
await test('Failed quote downloads remove inaccessible URLs and clearly identify unavailable media; cancellation propagates', async () => {
  const event = await napcat(source).normalize({ ...incoming, message: [{ type: 'reply', data: { id: '2' } }] }); assert.ok(event);
  const adapter = media(); adapter.downloadMedia = () => Promise.reject(new Error('private credentials in error must never appear'));
  const prepared = await new MediaPipeline().prepare(event, adapter, new AbortController().signal);
  const quote = firstQuote(prepared); assert.deepEqual(quote.attachments, []); assert.equal(quote.unavailableReason, 'media_unavailable');
  const context = new MessageContextBuilder().prepare(prepared).context; assert.match(context, /不可声称已看到/); assert.doesNotMatch(context, /credentials|secret-image-id/);
  const abort = new AbortController(); adapter.downloadMedia = () => { abort.abort(new Error('cancelled')); return Promise.reject(new Error('network')); };
  await assert.rejects(new MediaPipeline().prepare(event, adapter, abort.signal), /cancelled/);
});
await test('Message schema forbids recursive quoted attachments', () => {
  assert.throws(() => MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionType: 'group', sessionId: '8', senderId: '7', botId: '999', messageId: '3', timestamp: 0, parts: [{ type: 'quote', messageId: '2', attachments: [{ type: 'quote', messageId: '2' }] }] }));
});

await test('Forward media stays bounded, deduplicates cycles and carries each original node sender', async () => {
  const calls: string[] = [];
  const config = PlatformConfigSchema.parse({ id: 'qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:3001', apiBase: 'http://127.0.0.1:3000' }); if (config.type !== 'napcat') throw new Error('Fixture');
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, fetch: url => {
    calls.push(String(url));
    if (String(url).endsWith('/get_msg')) return Promise.resolve(envelope({ ...source, message: [{ type: 'forward', data: { id: 'forward' } }, { type: 'forward', data: { id: 'forward' } }] }));
    return Promise.resolve(envelope({ messages: [{ sender: { user_id: 55, nickname: '转发原作者' }, time: 50, content: [{ type: 'image', data: { file: 'forward-image' } }, { type: 'forward', data: { id: 'forward' } }] }] }));
  } });
  const event = await adapter.normalize(incoming); assert.ok(event); const quote = firstQuote(event);
  assert.equal(quote.attachments?.length, 1); assert.equal(quote.forwardedSources?.[0]?.senderId, '55'); assert.equal(quote.availability, 'partial'); assert.equal(calls.length, 2);
  const prepared = await new MediaPipeline().prepare(event, media(), new AbortController().signal);
  assert.equal(firstQuote(prepared).forwardedSources?.[0]?.attachmentIndex, 0);
  const context = new MessageContextBuilder().prepare(prepared).context;
  assert.match(context, /被引用消息中的转发节点/); assert.match(context, /senderId&quot;:&quot;55/);
});
await test('Shared group history defaults to 200 and retains newest entries when context space is smaller', () => {
  const history = new GroupHistoryBuffer(); const builder = new MessageContextBuilder(history, 3000);
  const base = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: '8', sessionType: 'group', senderId: '20', senderName: 'other', botId: '999', messageId: 'old', timestamp: 0, parts: [] });
  for (let index = 0; index < 100; index++) history.append({ ...base, messageId: String(index), timestamp: index, parts: [{ type: 'text', text: `chat-${index} ${'x'.repeat(100)}` }] });
  const context = builder.prepare({ ...base, messageId: 'current', senderId: '7', timestamp: 200 }).context;
  assert.match(context, /chat-99/); assert.doesNotMatch(context, /chat-0 /); assert.ok(context.length <= 3000); assert.match(context, /Sender ID: 7/);
  const buffer = new GroupHistoryBuffer(); for (let index = 0; index < 210; index++) buffer.append({ ...base, messageId: String(index), parts: [{ type: 'text', text: 'x' }] });
  assert.equal(buffer.reserve(base).history.length, 200);
});
await test('Forward expansion caps API calls and media across the whole incoming message', async () => {
  let forwardCalls = 0;
  const config = PlatformConfigSchema.parse({ id: 'qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:3001', apiBase: 'http://127.0.0.1:3000' }); if (config.type !== 'napcat') throw new Error('Fixture');
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, fetch: url => {
    if (String(url).endsWith('/get_msg')) return Promise.resolve(envelope({ ...source, message: [1, 2, 3, 4, 5].map(id => ({ type: 'forward', data: { id: `forward-${id}` } })) }));
    forwardCalls++;
    return Promise.resolve(envelope({ messages: [{ sender: { user_id: 55 }, content: Array.from({ length: 5 }, (_, index) => ({ type: 'image', data: { file: `image-${index}` } })) }] }));
  } });
  const quote = firstQuote(await adapter.normalize(incoming));
  assert.equal(quote.attachments?.length, 8); assert.equal(forwardCalls, 3); assert.equal(quote.availability, 'partial');
});
