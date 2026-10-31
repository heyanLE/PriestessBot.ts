import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { PlatformConfigSchema } from '../packages/contracts/src/index.js';
import { TelegramAdapter } from '../packages/adapters/src/platforms/telegram.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { WeixinAdapter, decryptWeixinMedia, encryptWeixinMedia, parseWeixinKey } from '../packages/adapters/src/platforms/weixin.js';
import { MemoryStateStore, type HttpFetch } from '../packages/adapters/src/platforms/transport.js';
import { readBoundedResponse } from '../packages/adapters/src/media/download.js';
const telegramConfig = PlatformConfigSchema.parse({ id: 'tg', type: 'telegram', tokenEnv: 'TEST' });
function telegram(fetcher: HttpFetch, state = new MemoryStateStore()): TelegramAdapter { if (telegramConfig.type !== 'telegram') throw new Error('Invalid fixture'); return new TelegramAdapter(telegramConfig, { fetch: fetcher, state, secret: () => '100:fixture' }); }
const json = (body: object): Response => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function requestBody(init: RequestInit | undefined): unknown { if (typeof init?.body !== 'string') throw new Error('Missing JSON request'); return JSON.parse(init.body); }
await test('Telegram keeps sender separate from group and preserves file, quote and Unicode text', () => {
  const adapter = telegram(() => Promise.resolve(json({ ok: true })));
  const event = adapter.normalize({ message_id: 42, date: 1000, chat: { id: -10, type: 'group' }, from: { id: 7, first_name: 'A' }, text: '你好😀', photo: [{ file_id: 'abc', width: 20, height: 30 }], reply_to_message: { message_id: 40, from: { id: 100 }, text: 'original' } });
  assert.equal(event?.senderId, '7'); assert.equal(event?.sessionId, '-10'); assert.equal(event?.parts[1]?.type, 'image'); assert.equal(event?.parts[2]?.type, 'quote');
  const anonymous = adapter.normalize({ message_id: 1, date: 1000, chat: { id: -10, type: 'group' }, from: { id: 7 }, sender_chat: { id: -10 }, text: 'admin' });
  assert.equal(anonymous?.senderId, 'anonymous-chat:-10');
});
await test('Telegram pagination escapes Markdown and durable delivery IDs prevent duplicate sends', async () => {
  const texts: string[] = []; const state = new MemoryStateStore();
  const fetcher: HttpFetch = (_url, init) => { const body = z.object({ text: z.string(), chat_id: z.string(), parse_mode: z.literal('MarkdownV2') }).parse(requestBody(init)); texts.push(body.text); return Promise.resolve(json({ ok: true, result: { message_id: texts.length } })); };
  const adapter = telegram(fetcher, state);
  const reply = { parts: [{ type: 'text' as const, text: '[user]😀'.repeat(600) }] };
  const first = await adapter.send({ chatId: '-10', kind: 'group' }, reply, 'run-1');
  assert.equal(first.status, 'confirmed'); assert.ok(texts.length > 1); assert.ok(texts.every(text => text.length <= 4096)); assert.ok(texts[0]?.startsWith('\\[user\\]'));
  const count = texts.length;
  await telegram(fetcher, state).send({ chatId: '-10', kind: 'group' }, reply, 'run-1'); assert.equal(texts.length, count);
});
await test('Unknown send outcome is persisted and blocks replay after restart', async () => {
  const state = new MemoryStateStore(); let calls = 0;
  const fetcher: HttpFetch = () => { calls++; return Promise.reject(new Error('connection reset after write')); };
  const reply = { parts: [{ type: 'text' as const, text: 'side effect' }] };
  const first = await telegram(fetcher, state).send({ chatId: '7', kind: 'private' }, reply, 'unknown'); assert.equal(first.status, 'uncertain');
  const second = await telegram(fetcher, state).send({ chatId: '7', kind: 'private' }, reply, 'unknown'); assert.equal(second.status, 'uncertain'); assert.equal(calls, 1);
});
await test('Telegram polling only persists offset after ingress acknowledges and stops long polling', async () => {
  const state = new MemoryStateStore(); let received = 0;
  let resolveReceived: (() => void) | undefined;
  const done = new Promise<void>(resolve => { resolveReceived = resolve; });
  const adapter = telegram(async (url, init) => {
    if (String(url).endsWith('getMe')) return json({ ok: true, result: { id: 100, username: 'test_bot' } });
    const body = z.object({ offset: z.number() }).parse(requestBody(init));
    if (body.offset === 0) return json({ ok: true, result: [{ update_id: 50, message: { message_id: 1, date: 1000, chat: { id: 7, type: 'private' }, from: { id: 7 }, text: 'hello' } }] });
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true }); resolveReceived?.(); });
  }, state);
  await adapter.start(async () => { received++; assert.equal(await state.get('platform:tg:offset'), undefined); });
  await done; await adapter.stop(); assert.equal(received, 1); assert.equal(await state.get('platform:tg:offset'), '51');
});
await test('NapCat validates real sender, fetches quoted speaker, and sends native segments', async () => {
  const config = PlatformConfigSchema.parse({ id: 'qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:3001', apiBase: 'http://127.0.0.1:3000' }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  let sent: unknown;
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => 'test', fetch: (url, init) => {
    if (String(url).endsWith('/get_msg')) return Promise.resolve(json({ status: 'ok', retcode: 0, data: { message_id: 2, message_type: 'group', group_id: 8, sender: { user_id: 999 }, message: [{ type: 'text', data: { text: 'bot reply' } }] } }));
    sent = requestBody(init); return Promise.resolve(json({ status: 'ok', retcode: 0, data: { message_id: 11 } }));
  } });
  const event = await adapter.normalize({ post_type: 'message', message_type: 'group', message_id: 1, user_id: 7, group_id: 8, self_id: 999, time: 1000, sender: { nickname: 'QQ' }, message: [{ type: 'at', data: { qq: '999' } }, { type: 'reply', data: { id: '2' } }, { type: 'text', data: { text: 'hello' } }, { type: 'image', data: { url: 'https://example.org/a.jpg' } }] });
  assert.equal(event?.senderId, '7'); assert.equal(event?.sessionId, '8'); assert.deepEqual(event?.parts[1], { type: 'quote', messageId: '2', senderId: '999', senderName: '999', text: 'bot reply', attachments: [], availability: 'available' });
  await adapter.send({ chatId: '8', kind: 'group' }, { replyTo: '1', parts: [{ type: 'text', text: '**bold**' }] }, 'send');
  assert.deepEqual(sent, { group_id: '8', message: [{ type: 'reply', data: { id: '1' } }, { type: 'text', data: { text: 'bold' } }] });
});
await test('WeChat QR login, context tokens, encrypted inbound media and send item protocol', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx', type: 'weixin' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const key = Buffer.alloc(16, 5); const clear = Buffer.from('test image bytes'); const ciphertext = encryptWeixinMedia(clear, key); let sent: unknown;
  const adapter = new WeixinAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, fetch: (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/get_bot_qrcode')) return Promise.resolve(json({ qrcode: 'qr-ticket', qrcode_img_content: 'https://example.org/qr' }));
    if (path.endsWith('/get_qrcode_status')) return Promise.resolve(json({ status: 'confirmed', bot_token: 'test-token', ilink_bot_id: 'bot' }));
    if (path.endsWith('/download')) return Promise.resolve(new Response(new Uint8Array(ciphertext).buffer));
    if (path.endsWith('/sendmessage')) { sent = requestBody(init); return Promise.resolve(json({ ret: 0 })); }
    throw new Error('Unexpected fixture request');
  } });
  assert.equal((await adapter.beginLogin()).qrcode, 'qr-ticket'); assert.equal(await adapter.pollLogin(), 'confirmed');
  const event = await adapter.normalize({ message_id: 'm1', from_user_id: 'alice', message_type: 1, create_time_ms: 1_800_000_000_000, context_token: 'reply-ticket', item_list: [{ type: 1, text_item: { text: 'photo' } }, { type: 2, image_item: { media: { encrypt_query_param: 'encrypted-query', aes_key: key.toString('base64') } } }] });
  const image = event?.parts.find(part => part.type === 'image'); assert.ok(image?.type === 'image');
  assert.deepEqual(Buffer.from((await adapter.downloadMedia(image, new AbortController().signal)).bytes), clear);
  const result = await adapter.send({ chatId: 'alice', kind: 'private' }, { parts: [{ type: 'text', text: '**Hello**' }] }, 'reply-1'); assert.equal(result.status, 'confirmed');
  const payload = z.object({ msg: z.object({ context_token: z.literal('reply-ticket'), to_user_id: z.literal('alice'), item_list: z.array(z.object({ type: z.literal(1), text_item: z.object({ text: z.literal('Hello') }) })) }) }).parse(sent); assert.equal(payload.msg.item_list.length, 1);
});
await test('WeChat media keys support raw and encoded-hex formats; invalid padding fails', () => {
  const key = Buffer.alloc(16, 9);
  assert.deepEqual(parseWeixinKey(key.toString('base64')), key); assert.deepEqual(parseWeixinKey(Buffer.from(key.toString('hex')).toString('base64')), key);
  assert.throws(() => parseWeixinKey('YmFk'));
  assert.throws(() => decryptWeixinMedia(Buffer.alloc(17), key));
});
await test('Media size is enforced while streaming even without content-length', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); } }));
  await assert.rejects(readBoundedResponse(response, 8), /size limit/);
});
await test('WeChat uploads encrypted image and file bytes before sending native media items', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-upload', type: 'weixin', accountId: 'bot' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const plaintext = Buffer.from('private upload fixture'); let uploadKey = Buffer.alloc(0); const itemTypes: number[] = []; let uploads = 0;
  const adapter = new WeixinAdapter(config, { state: new MemoryStateStore(), secret: () => 'fixture-token', resolveMedia: part => Promise.resolve({ bytes: plaintext, mimeType: part.mimeType, name: part.type === 'file' ? part.name : 'fixture.jpg' }), fetch: (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/getuploadurl')) {
      const request = z.object({ aeskey: z.string(), rawsize: z.literal(plaintext.length), filesize: z.number(), media_type: z.number() }).parse(requestBody(init));
      uploadKey = Buffer.from(request.aeskey, 'hex'); assert.equal(request.filesize % 16, 0);
      return Promise.resolve(json({ ret: 0, upload_param: 'upload-query' }));
    }
    if (path.endsWith('/upload')) {
      assert.ok(init?.body instanceof ArrayBuffer); assert.deepEqual(decryptWeixinMedia(new Uint8Array(init.body), uploadKey), plaintext); uploads++;
      return Promise.resolve(new Response('', { headers: { 'x-encrypted-param': 'download-query' } }));
    }
    if (path.endsWith('/sendmessage')) {
      const request = z.object({ msg: z.object({ item_list: z.array(z.object({ type: z.number(), image_item: z.object({ media: z.object({ aes_key: z.string() }) }).optional(), file_item: z.object({ file_name: z.string(), len: z.string(), media: z.object({ aes_key: z.string() }) }).optional() })) }) }).parse(requestBody(init));
      for (const item of request.msg.item_list) { itemTypes.push(item.type); const key = item.image_item?.media.aes_key ?? item.file_item?.media.aes_key; assert.ok(key); assert.deepEqual(parseWeixinKey(key), uploadKey); if (item.file_item) assert.equal(item.file_item.file_name, 'notes.txt'); }
      return Promise.resolve(json({ ret: 0 }));
    }
    return Promise.reject(new Error('Unexpected fixture endpoint'));
  } });
  await adapter.normalize({ from_user_id: 'alice', message_id: 'm1', context_token: 'context', item_list: [] });
  const result = await adapter.send({ chatId: 'alice', kind: 'private' }, { parts: [{ type: 'image', url: 'artifact:image1', mimeType: 'image/jpeg' }, { type: 'file', url: 'artifact:file1', mimeType: 'text/plain', name: 'notes.txt' }] }, 'upload-1');
  assert.equal(result.status, 'confirmed'); assert.equal(uploads, 2); assert.deepEqual(itemTypes, [2, 4]);
});
await test('Telegram authorized artifacts use multipart uploads without exposing local paths', async () => {
  if (telegramConfig.type !== 'telegram') throw new Error('Invalid fixture'); let name = '';
  const adapter = new TelegramAdapter(telegramConfig, { state: new MemoryStateStore(), secret: () => '100:fixture', resolveMedia: () => Promise.resolve({ bytes: Buffer.from('file text'), mimeType: 'text/plain', name: 'hello.txt' }), fetch: (_url, init) => {
    assert.ok(init?.body instanceof FormData); const file = init.body.get('document'); assert.ok(file instanceof File); name = file.name;
    assert.equal(init.body.get('chat_id'), 'alice'); return Promise.resolve(json({ ok: true, result: { message_id: '44' } }));
  } });
  const result = await adapter.send({ chatId: 'alice', kind: 'private' }, { parts: [{ type: 'file', url: 'artifact:file1', mimeType: 'text/plain', name: 'hello.txt' }] }, 'file-send');
  assert.equal(result.status, 'confirmed'); assert.equal(name, 'hello.txt');
});
await test('NapCat CQ strings distinguish serialized mentions from user-typed escaped tags', async () => {
  const config = PlatformConfigSchema.parse({ id: 'qq-cq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1' }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined });
  const event = await adapter.normalize({ post_type: 'message', message_type: 'private', message_id: 1, user_id: 7, self_id: 9, time: 1000, message: 'hello [CQ:at,qq=9] &#91;CQ:at,qq=admin&#93;' });
  assert.deepEqual(event?.parts, [{ type: 'text', text: 'hello ' }, { type: 'mention', userId: '9' }, { type: 'text', text: ' [CQ:at,qq=admin]' }]);
  const file = await adapter.normalize({ post_type: 'notice', notice_type: 'group_upload', group_id: 8, user_id: 7, self_id: 9, time: 1000, file: { id: 'fileid', name: 'notes.txt', size: 123, busid: 102 } });
  assert.equal(file?.sessionId, '8'); assert.equal(file?.senderId, '7'); assert.equal(file?.parts[0]?.type, 'file');
});
await test('NapCat artifacts use the host signed URL resolver for protocol file uploads', async () => {
  const config = PlatformConfigSchema.parse({ id: 'qq-file', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1', apiBase: 'http://127.0.0.1:2' }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  let requestedArtifact = ''; let fileUrl = '';
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, resolvePublicMediaUrl: part => { requestedArtifact = part.url; return Promise.resolve('https://runtime.example/signed/artifact1?expires=1800000000&signature=fixture'); }, fetch: (_url, init) => {
    const body = z.object({ user_id: z.literal('alice'), file: z.string().url(), name: z.literal('notes.txt') }).parse(requestBody(init)); fileUrl = body.file;
    return Promise.resolve(json({ status: 'ok', retcode: 0, data: null }));
  } });
  const result = await adapter.send({ chatId: 'alice', kind: 'private' }, { parts: [{ type: 'file', url: 'artifact:artifact1', mimeType: 'text/plain', name: 'notes.txt' }] }, 'signed-file');
  assert.equal(result.status, 'confirmed'); assert.equal(requestedArtifact, 'artifact:artifact1'); assert.match(fileUrl, /signature=fixture/);
});
await test('Telegram can restart the same adapter after aborting its previous polling session', async () => {
  let meRequests = 0; let pollingRequests = 0; let notifyPolling: (() => void) | undefined;
  const adapter = telegram((url, init) => {
    init?.signal?.throwIfAborted();
    if (String(url).endsWith('getMe')) { meRequests++; return Promise.resolve(json({ ok: true, result: { id: 100 } })); }
    pollingRequests++; notifyPolling?.();
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true }); });
  });
  for (let index = 0; index < 2; index++) {
    const polling = new Promise<void>(resolve => { notifyPolling = resolve; });
    await adapter.start(() => Promise.resolve()); await polling; await adapter.stop();
  }
  assert.equal(meRequests, 2); assert.equal(pollingRequests, 2);
});
await test('WeChat session timeout uses errcode even with a generic ret and clears all account cursors', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-expired', type: 'weixin' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const state = new MemoryStateStore();
  await state.set('platform:wx-expired:account', JSON.stringify({ token: 'old', accountId: 'old-bot', apiBase: config.apiBase, cursor: 'old-cursor', contexts: { alice: 'old-context' } }));
  let report: ((kind: string) => void) | undefined; const failed = new Promise<string>(resolve => { report = resolve; });
  const adapter = new WeixinAdapter(config, { state, secret: () => undefined, fetch: () => Promise.resolve(json({ ret: -1, errcode: -14 })), onError: (_id, kind) => { report?.(kind); } });
  await adapter.start(() => Promise.resolve()); const kind = await failed; await adapter.stop(); assert.equal(kind, 'authentication');
  const raw = await state.get('platform:wx-expired:account'); assert.ok(raw);
  const saved = z.object({ token: z.literal(''), accountId: z.literal(''), cursor: z.literal(''), contexts: z.record(z.string(), z.string()) }).parse(JSON.parse(raw)); assert.deepEqual(saved.contexts, {});
});
await test('WeChat QR login into a different account drops previous reply context', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-switch', type: 'weixin', accountId: 'old-bot' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const state = new MemoryStateStore();
  const adapter = new WeixinAdapter(config, { state, secret: () => 'old-token', fetch: url => Promise.resolve(json(String(url).includes('get_bot_qrcode') ? { qrcode: 'qr', qrcode_img_content: 'https://example.org/qr' } : { status: 'confirmed', bot_token: 'new-token', ilink_bot_id: 'new-bot' })) });
  await adapter.normalize({ from_user_id: 'alice', message_id: 'old-message', context_token: 'old-context', item_list: [] }); await adapter.beginLogin(); await adapter.pollLogin();
  const raw = await state.get('platform:wx-switch:account'); assert.ok(raw); const saved = z.object({ accountId: z.literal('new-bot'), contexts: z.record(z.string(), z.string()), cursor: z.literal('') }).parse(JSON.parse(raw)); assert.deepEqual(saved.contexts, {});
  assert.equal((await adapter.send({ chatId: 'alice', kind: 'private' }, { parts: [{ type: 'text', text: 'no stale context' }] }, 'new-send')).status, 'failed');
});
await test('WeChat stop during context persistence cannot submit a late message', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-stop', type: 'weixin', accountId: 'bot' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const memory = new MemoryStateStore(); let enteredSave: (() => void) | undefined; let releaseSave: (() => void) | undefined; let received = 0;
  const saving = new Promise<void>(resolve => { enteredSave = resolve; }); const release = new Promise<void>(resolve => { releaseSave = resolve; });
  const adapter = new WeixinAdapter(config, { secret: () => 'token', state: { get: key => memory.get(key), delete: key => memory.delete(key), set: async (key, value) => { enteredSave?.(); await release; await memory.set(key, value); } }, fetch: () => Promise.resolve(json({ ret: 0, get_updates_buf: 'next', msgs: [{ message_id: 'm', from_user_id: 'alice', context_token: 'reply', item_list: [{ type: 1, text_item: { text: 'hello' } }] }] })) });
  await adapter.start(() => { received++; return Promise.resolve(); }); await saving; const stopped = adapter.stop(); releaseSave?.(); await stopped; assert.equal(received, 0);
  const raw = await memory.get('platform:wx-stop:account'); assert.ok(raw); assert.equal(z.object({ cursor: z.string() }).parse(JSON.parse(raw)).cursor, '', 'Unaccepted message must not advance the cursor');
});
await test('Telegram isolates malformed message payloads so later valid updates still advance the cursor', async () => {
  const state = new MemoryStateStore(); let invalid = 0; const received: string[] = []; let reached: (() => void) | undefined; const advanced = new Promise<void>(resolve => { reached = resolve; });
  if (telegramConfig.type !== 'telegram') throw new Error('Invalid fixture');
  const adapter = new TelegramAdapter(telegramConfig, { state, secret: () => '100:fixture', onError: (_id, kind) => { if (kind === 'invalid_payload') invalid++; }, fetch: (url, init) => {
    if (String(url).endsWith('getMe')) return Promise.resolve(json({ ok: true, result: { id: 100 } }));
    const body = z.object({ offset: z.number() }).parse(requestBody(init));
    if (body.offset === 0) return Promise.resolve(json({ ok: true, result: [{ update_id: 1, message: { message_id: 1, text: 'invalid shape' } }, { update_id: 2, message: { message_id: 2, date: 1000, chat: { id: 7, type: 'private' }, from: { id: 7 }, text: 'valid' } }] }));
    reached?.(); return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true }); });
  } });
  await adapter.start(event => { received.push(event.messageId); return Promise.resolve(); }); await advanced; await adapter.stop();
  assert.deepEqual(received, ['2']); assert.equal(invalid, 1); assert.equal(await state.get('platform:tg:offset'), '3');
});
await test('WeChat isolates malformed encrypted media instead of permanently blocking polling', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-invalid', type: 'weixin', accountId: 'bot' }); if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const state = new MemoryStateStore(); let invalid = 0; const received: string[] = []; let reached: (() => void) | undefined; const advanced = new Promise<void>(resolve => { reached = resolve; });
  const adapter = new WeixinAdapter(config, { state, secret: () => 'token', onError: (_id, kind) => { if (kind === 'invalid_payload') invalid++; }, fetch: (_url, init) => {
    const body = z.object({ get_updates_buf: z.string() }).parse(requestBody(init));
    if (!body.get_updates_buf) return Promise.resolve(json({ ret: 0, get_updates_buf: 'advanced', msgs: [{ message_id: 'bad', from_user_id: 'alice', item_list: [{ type: 2, image_item: { media: { encrypt_query_param: 'q', aes_key: 'invalid' } } }] }, { message_id: 'good', from_user_id: 'alice', item_list: [{ type: 1, text_item: { text: 'hello' } }] }] }));
    reached?.(); return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true }); });
  } });
  await adapter.start(event => { received.push(event.messageId); return Promise.resolve(); }); await advanced; await adapter.stop();
  assert.deepEqual(received, ['good']); assert.equal(invalid, 1); const raw = await state.get('platform:wx-invalid:account'); assert.ok(raw); assert.equal(z.object({ cursor: z.string() }).parse(JSON.parse(raw)).cursor, 'advanced');
});
