import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { PlatformConfigSchema, type ReplyPlan } from '../packages/contracts/src/index.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore } from '../packages/adapters/src/platforms/transport.js';
import type { AdapterDependencies, PlatformTarget } from '../packages/adapters/src/platforms/types.js';

interface CapturedRequest { readonly action: string; readonly body: unknown; }
const group = { kind: 'group', chatId: '81' } satisfies PlatformTarget;
const privateChat = { kind: 'private', chatId: '42' } satisfies PlatformTarget;
const reply = (text: string): ReplyPlan => ({ replyTo: 'original', parts: [{ type: 'text', text }] });
const json = (data: unknown, status = 'ok', retcode = 0): Response => new Response(JSON.stringify({ status, retcode, data }));
function fixture(options: { threshold?: number; state?: MemoryStateStore; respond?: (request: CapturedRequest) => Response | Promise<Response> | undefined; dependencies?: Partial<AdapterDependencies> } = {}): { adapter: NapCatAdapter; requests: CapturedRequest[] } {
  const config = PlatformConfigSchema.parse({ id: 'forward-qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1', apiBase: 'http://fixture.invalid', forwardThreshold: options.threshold ?? 8 });
  if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const requests: CapturedRequest[] = [];
  const adapter = new NapCatAdapter(config, {
    state: options.state ?? new MemoryStateStore(), secret: () => undefined, ...options.dependencies,
    fetch: async (url, init) => {
      assert.equal(typeof init?.body, 'string');
      if (typeof init?.body !== 'string') throw new Error('Missing request body');
      const body: unknown = JSON.parse(init.body);
      const request = { action: new URL(url).pathname.slice(1), body };
      requests.push(request);
      const custom = options.respond?.(request); if (custom !== undefined) return custom;
      if (request.action === 'get_login_info') return json({ user_id: 900, nickname: 'Bot login' });
      if (request.action === 'get_group_member_info') return json({ user_id: 900, card: 'Group bot', nickname: 'Bot QQ' });
      if (request.action.startsWith('send_')) return json({ message_id: requests.length });
      if (request.action.startsWith('upload_')) return json(null);
      throw new Error(`Unexpected fixture action: ${request.action}`);
    },
  });
  return { adapter, requests };
}
const sent = (requests: readonly CapturedRequest[]): CapturedRequest[] => requests.filter(request => /^(send_|upload_)/.test(request.action));
const forwardSchema = z.object({
  group_id: z.string().optional(), user_id: z.string().optional(),
  messages: z.tuple([z.object({ type: z.literal('node'), data: z.object({ user_id: z.string(), nickname: z.string(), content: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })) }).strict() }).strict()]),
}).strict();

await test('NapCat forwards only above the complete raw text threshold and counts Unicode code points', async () => {
  const { adapter, requests } = fixture({ threshold: 4 });
  assert.equal(adapter.capabilities.wholeReply, true);
  for (const [index, text] of ['1234', '😀😀😀😀', '12345', '😀😀😀😀😀', 'x'.repeat(7001), '**a**'].entries()) {
    assert.equal((await adapter.send(group, reply(text), `boundary-${index}`)).status, 'confirmed');
  }
  assert.deepEqual(sent(requests).map(request => request.action), ['send_group_msg', 'send_group_msg', 'send_group_forward_msg', 'send_group_forward_msg', 'send_group_forward_msg', 'send_group_forward_msg']);
  const formatted = forwardSchema.parse(sent(requests).at(-1)?.body);
  assert.deepEqual(formatted.messages[0].data.content, [{ type: 'text', data: { text: 'a' } }]);
});

await test('NapCat totals multiple text parts and forwards one complete chain without reply decoration', async () => {
  const { adapter, requests } = fixture();
  const outcome = await adapter.send(group, { replyTo: 'original', parts: [{ type: 'text', text: '12345' }, { type: 'text', text: '6789' }] }, 'multiple');
  assert.equal(outcome.status, 'confirmed');
  assert.equal(sent(requests).length, 1);
  const body = forwardSchema.parse(sent(requests)[0]?.body);
  assert.equal(body.group_id, '81'); assert.equal(body.user_id, undefined);
  assert.equal(body.messages[0].data.user_id, '900'); assert.equal(body.messages[0].data.nickname, 'Group bot');
  assert.deepEqual(body.messages[0].data.content, [{ type: 'text', data: { text: '12345' } }, { type: 'text', data: { text: '6789' } }]);
  assert.deepEqual(requests.find(request => request.action === 'get_group_member_info')?.body, { group_id: '81', user_id: '900', no_cache: false });
});

await test('NapCat private forwards use the real login account and private API', async () => {
  const { adapter, requests } = fixture();
  assert.equal((await adapter.send(privateChat, reply('123456789'), 'private')).status, 'confirmed');
  const [request] = sent(requests); assert.equal(request?.action, 'send_private_forward_msg');
  const body = forwardSchema.parse(request?.body);
  assert.equal(body.user_id, '42'); assert.equal(body.group_id, undefined);
  assert.equal(body.messages[0].data.user_id, '900'); assert.equal(body.messages[0].data.nickname, 'Bot login');
  assert.equal(requests.some(request => request.action === 'get_group_member_info'), false);
});

await test('NapCat preserves text/image/file ordering while files remain independent uploads', async () => {
  let mediaReads = 0; let signedReads = 0;
  const { adapter, requests } = fixture({ dependencies: {
    resolveMedia: () => { mediaReads++; return Promise.resolve({ bytes: Buffer.from('image fixture'), mimeType: 'image/png', name: 'image.png' }); },
    resolvePublicMediaUrl: () => { signedReads++; return Promise.resolve('https://runtime.example/signed/file'); },
  } });
  const outcome = await adapter.send(group, { parts: [
    { type: 'text', text: '123456789' }, { type: 'image', url: 'artifact:image', mimeType: 'image/png' }, { type: 'text', text: 'after image' },
    { type: 'file', url: 'artifact:file', mimeType: 'text/plain', name: 'notes.txt' }, { type: 'text', text: 'after file' },
  ] }, 'media');
  assert.equal(outcome.status, 'confirmed'); assert.equal(mediaReads, 1); assert.equal(signedReads, 1);
  const effects = sent(requests);
  assert.deepEqual(effects.map(request => request.action), ['send_group_forward_msg', 'upload_group_file', 'send_group_forward_msg']);
  assert.deepEqual(forwardSchema.parse(effects[0]?.body).messages[0].data.content, [
    { type: 'text', data: { text: '123456789' } }, { type: 'image', data: { file: `base64://${Buffer.from('image fixture').toString('base64')}` } }, { type: 'text', data: { text: 'after image' } },
  ]);
  assert.deepEqual(effects[1]?.body, { group_id: '81', file: 'https://runtime.example/signed/file', name: 'notes.txt' });
  assert.deepEqual(forwardSchema.parse(effects[2]?.body).messages[0].data.content, [{ type: 'text', data: { text: 'after file' } }]);
});

await test('NapCat threshold zero keeps normal pagination and short replies keep their quote', async () => {
  const { adapter, requests } = fixture({ threshold: 0 });
  assert.equal((await adapter.send(privateChat, reply('x'.repeat(7001)), 'disabled')).status, 'confirmed');
  assert.deepEqual(requests.map(request => request.action), ['send_private_msg', 'send_private_msg', 'send_private_msg']);
  for (const request of requests) {
    const body = z.object({ user_id: z.literal('42'), message: z.tuple([z.object({ type: z.literal('reply'), data: z.object({ id: z.literal('original') }) }), z.object({ type: z.literal('text'), data: z.object({ text: z.string().max(3500) }) })]) }).parse(request.body);
    assert.ok(body.message[1].data.text);
  }
});

await test('NapCat chooses group nickname when card is empty, then login name when lookup fails', async () => {
  for (const member of [{ user_id: 900, card: '  ', nickname: 'QQ nickname' }, undefined]) {
    const { adapter, requests } = fixture({ respond: request => request.action === 'get_group_member_info' ? member ? json(member) : Promise.reject(new Error('lookup unavailable')) : undefined });
    assert.equal((await adapter.send(group, reply('123456789'), 'name')).status, 'confirmed');
    assert.equal(forwardSchema.parse(sent(requests)[0]?.body).messages[0].data.nickname, member ? 'QQ nickname' : 'Bot login');
  }
});

await test('NapCat can use validated event self_id while nickname APIs are unavailable', async () => {
  const { adapter, requests } = fixture({ respond: request => request.action.startsWith('get_') ? Promise.reject(new Error('lookup unavailable')) : undefined });
  await adapter.normalize({ post_type: 'message', message_type: 'group', message_id: 1, group_id: 81, user_id: 42, self_id: 901, time: 1000, message: 'hello' });
  assert.equal((await adapter.send(group, reply('123456789'), 'event-identity')).status, 'confirmed');
  const sender = forwardSchema.parse(sent(requests)[0]?.body).messages[0].data;
  assert.equal(sender.user_id, '901'); assert.equal(sender.nickname, '普瑞赛斯');
});

await test('NapCat refuses forward without verified bot identity and never invents the sender', async () => {
  for (const invalidLogin of [undefined, { user_id: 0 }, { user_id: 'not-a-bot' }]) {
    const { adapter, requests } = fixture({ respond: request => request.action === 'get_login_info' ? invalidLogin ? json(invalidLogin) : Promise.reject(new Error('lookup unavailable')) : undefined });
    const outcome = await adapter.send(group, reply('123456789'), 'missing-identity');
    assert.equal(outcome.status, 'failed'); if (outcome.status === 'failed') assert.equal(outcome.kind, 'rejected');
    assert.deepEqual(sent(requests), []);
  }
});

await test('NapCat uncertain forward outcomes block replay and never fall back to ordinary messages', async () => {
  const state = new MemoryStateStore();
  let sends = 0;
  const respond = (request: CapturedRequest): Response | undefined => {
    if (request.action === 'send_group_forward_msg') { sends++; throw new Error('timeout after request write'); }
    return undefined;
  };
  const first = fixture({ state, respond });
  assert.equal((await first.adapter.send(group, reply('123456789'), 'uncertain')).status, 'uncertain');
  assert.deepEqual(sent(first.requests).map(request => request.action), ['send_group_forward_msg']);
  const restarted = fixture({ state, respond });
  assert.equal((await restarted.adapter.send(group, reply('123456789'), 'uncertain')).status, 'uncertain');
  assert.equal(sends, 1); assert.deepEqual(restarted.requests, []);
});

await test('NapCat rechecks send permission after identity and image preparation', async () => {
  for (const revokeDuring of ['identity', 'image']) {
    let revoked = false; let checks = 0;
    const { adapter, requests } = fixture({
      respond: request => { if (revokeDuring === 'identity' && request.action === 'get_group_member_info') revoked = true; return undefined; },
      dependencies: { resolveMedia: () => { if (revokeDuring === 'image') revoked = true; return Promise.resolve({ bytes: Buffer.from('image fixture'), mimeType: 'image/png', name: 'image.png' }); } },
    });
    const outcome = await adapter.send(group, { parts: [{ type: 'text', text: '123456789' }, { type: 'image', url: 'artifact:image', mimeType: 'image/png' }] }, 'revoked', () => { checks++; if (revoked) throw new Error('Permission revoked'); });
    assert.equal(outcome.status, 'failed'); assert.equal(checks, 1); assert.deepEqual(sent(requests), []);
  }
});

await test('NapCat confirmed forward deliveries are idempotent and rejected sends do not fan out', async () => {
  const state = new MemoryStateStore(); const first = fixture({ state });
  assert.equal((await first.adapter.send(group, reply('123456789'), 'confirmed')).status, 'confirmed');
  const restarted = fixture({ state });
  assert.equal((await restarted.adapter.send(group, reply('123456789'), 'confirmed')).status, 'confirmed');
  assert.deepEqual(restarted.requests, []);
  const rejected = fixture({ respond: request => request.action === 'send_group_forward_msg' ? json(null, 'failed', 1200) : undefined });
  assert.equal((await rejected.adapter.send(group, reply('123456789'), 'rejected')).status, 'failed');
  assert.deepEqual(sent(rejected.requests).map(request => request.action), ['send_group_forward_msg']);
});

await test('NapCat WebSocket disconnect during forward submission remains uncertain without retry', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  const config = PlatformConfigSchema.parse({ id: 'forward-ws', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}`, forwardThreshold: 8 });
  if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const actions: string[] = []; let ready: (() => void) | undefined;
  const connected = new Promise<void>(resolve => { ready = resolve; });
  server.on('connection', socket => {
    socket.on('message', data => {
      const raw: unknown = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8'));
      const request = z.object({ action: z.string(), echo: z.string(), params: z.unknown() }).parse(raw); actions.push(request.action);
      if (request.action === 'get_login_info') socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900, nickname: 'Socket bot' }, echo: request.echo }));
      else if (request.action === 'send_private_forward_msg') { assert.equal(forwardSchema.parse(request.params).messages[0].data.user_id, '900'); socket.close(); }
      else throw new Error(`Unexpected action ${request.action}`);
    });
  });
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, state) => { if (state.status === 'connected') ready?.(); } });
  try {
    await adapter.start(() => Promise.resolve()); await connected;
    assert.equal((await adapter.send(privateChat, reply('123456789'), 'ws-disconnect')).status, 'uncertain');
    assert.equal((await adapter.send(privateChat, reply('123456789'), 'ws-disconnect')).status, 'uncertain');
    assert.deepEqual(actions, ['get_login_info', 'send_private_forward_msg']);
  } finally {
    await adapter.stop(); for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  }
});
