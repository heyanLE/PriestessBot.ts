import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { MessageEventSchema, PlatformConfigSchema, normalizeNapCatReactionEmoji, type MessageEvent } from '../packages/contracts/src/index.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore, PlatformError } from '../packages/adapters/src/platforms/transport.js';
import type { AdapterLifecycle } from '../packages/adapters/src/platforms/types.js';

interface CapturedRequest { readonly action: string; readonly body: unknown; readonly signal: AbortSignal | undefined; }
const event = (overrides: Partial<MessageEvent> = {}): MessageEvent => MessageEventSchema.parse({ platform: 'reaction-qq', platformType: 'napcat', sessionId: '81', sessionType: 'group', senderId: '42', senderName: 'User', messageId: '-12345', timestamp: 1_000, botId: '900', parts: [{ type: 'text', text: 'hello' }], ...overrides });
const json = (data: unknown, status = 'ok', retcode = 0): Response => new Response(JSON.stringify({ status, retcode, data }));
function fixture(options: { enabled?: boolean; emojis?: string[]; defaults?: boolean; respond?: (request: CapturedRequest) => Response | Promise<Response> } = {}): { adapter: NapCatAdapter; requests: CapturedRequest[]; statuses: AdapterLifecycle[] } {
  const base = PlatformConfigSchema.parse({ id: 'reaction-qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1', apiBase: 'http://fixture.invalid' });
  if (base.type !== 'napcat') throw new Error('Invalid fixture');
  // Direct typed construction also exercises defensive handling of a malformed external configuration.
  const config = options.defaults ? base : { ...base, preAckEmoji: { enabled: options.enabled ?? true, emojis: options.emojis ?? ['124'] } };
  const requests: CapturedRequest[] = []; const statuses: AdapterLifecycle[] = [];
  const adapter = new NapCatAdapter(config, {
    state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, status) => { statuses.push(status); },
    fetch: async (url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing request body');
      const body: unknown = JSON.parse(init.body);
      const request = { action: new URL(url).pathname.slice(1), body, signal: init.signal ?? undefined };
      requests.push(request);
      return options.respond ? options.respond(request) : json(null);
    },
  });
  return { adapter, requests, statuses };
}
const signal = (): AbortSignal => new AbortController().signal;
function untilAborted(request: CapturedRequest): Promise<Response> {
  const abortSignal = request.signal;
  assert.ok(abortSignal);
  return new Promise((_resolve, reject) => {
    if (abortSignal.aborted) { reject(new Error('Aborted')); return; }
    abortSignal.addEventListener('abort', () => { reject(new Error('Aborted')); }, { once: true });
  });
}

await test('NapCat reaction uses the triggering signed message ID and creates one emoji-like without a text reply', async () => {
  const { adapter, requests, statuses } = fixture(); let guards = 0;
  await adapter.onProcessingStart(event(), signal(), () => { guards++; assert.equal(requests.length, 0); });
  assert.equal(guards, 1); assert.equal(requests.length, 1);
  assert.equal(requests[0]?.action, 'set_msg_emoji_like');
  assert.deepEqual(requests[0]?.body, { message_id: '-12345', emoji_id: '124', set: true });
  assert.deepEqual(statuses, []);
});

await test('NapCat reactions are off by default and ignore disabled, empty, private, other-adapter and synthetic events', async () => {
  for (const options of [{ defaults: true }, { enabled: false }, { emojis: [] }]) {
    const { adapter, requests } = fixture(options);
    await adapter.onProcessingStart(event(), signal(), () => { assert.fail('Ignored configuration must not claim a send'); });
    assert.deepEqual(requests, []);
  }
  const { adapter, requests } = fixture();
  for (const message of [
    event({ sessionType: 'private' }), event({ platform: 'other-qq' }), event({ platformType: 'telegram' }),
    ...['upload:abc:1000', 'synthetic:42', '1.5', '+123', ' 123 ', 'NaN'].map(messageId => event({ messageId })),
  ]) await adapter.onProcessingStart(message, signal(), () => { assert.fail('Ignored event must not claim a send'); });
  assert.deepEqual(requests, []);
});

await test('NapCat reaction emoji normalization matches QQ face IDs and single Unicode code points', async () => {
  for (const [emoji, emojiId] of [[' 124 ', '124'], ['76', '76'], ['👀', '128064'], ['🤔', '129300'], ['❤️', '10084']]) {
    assert.ok(emoji !== undefined && emojiId !== undefined);
    assert.equal(normalizeNapCatReactionEmoji(emoji), emojiId);
    const { adapter, requests } = fixture({ emojis: [emoji] });
    await adapter.onProcessingStart(event({ messageId: '12345' }), signal(), () => undefined);
    assert.deepEqual(requests[0]?.body, { message_id: '12345', emoji_id: emojiId, set: true });
  }
  for (const emoji of [' ', '#️⃣', '1️⃣', '©', '🇨🇳', '👍🏻', '👨‍👩‍👧', '１２']) {
    assert.equal(normalizeNapCatReactionEmoji(emoji), undefined);
    const { adapter, requests } = fixture({ emojis: [emoji] });
    await assert.rejects(adapter.onProcessingStart(event(), signal(), () => { assert.fail('Invalid emoji must not claim a send'); }), error => error instanceof PlatformError && error.kind === 'invalid_payload');
    assert.deepEqual(requests, []);
  }
});

await test('NapCat selects only one configured candidate for each processing start', async () => {
  const { adapter, requests } = fixture({ emojis: ['76', '👀', '❤️'] });
  const ids = new Set(['76', '128064', '10084']);
  for (let index = 0; index < 12; index++) {
    await adapter.onProcessingStart(event({ messageId: String(index + 1) }), signal(), () => undefined);
    assert.equal(requests.length, index + 1);
    const body = z.object({ message_id: z.literal(String(index + 1)), emoji_id: z.string(), set: z.literal(true) }).strict().parse(requests[index]?.body);
    assert.ok(ids.has(body.emoji_id));
  }
});

await test('NapCat reaction rechecks permission and cancellation immediately before submitting', async () => {
  const { adapter, requests } = fixture();
  await assert.rejects(adapter.onProcessingStart(event(), signal(), () => { throw new Error('Permission revoked'); }), /Permission revoked/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(adapter.onProcessingStart(event(), cancelled.signal, () => { assert.fail('Cancelled start must not claim a send'); }));
  const duringGuard = new AbortController();
  await assert.rejects(adapter.onProcessingStart(event(), duringGuard.signal, () => { duringGuard.abort(); }));
  assert.deepEqual(requests, []);
});

await test('NapCat reaction cancellation interrupts an in-flight HTTP action without retry or fallback', async () => {
  const controller = new AbortController(); let entered: (() => void) | undefined;
  const requested = new Promise<void>(resolve => { entered = resolve; });
  const { adapter, requests, statuses } = fixture({ respond: request => { entered?.(); return untilAborted(request); } });
  const result = adapter.onProcessingStart(event(), controller.signal, () => undefined);
  await requested; controller.abort();
  await assert.rejects(result, error => error instanceof PlatformError && error.kind === 'cancelled' && error.uncertain);
  assert.deepEqual(requests.map(request => request.action), ['set_msg_emoji_like']); assert.deepEqual(statuses, []);
});

await test('NapCat reaction timeout is bounded to five seconds even when the protocol stalls', { timeout: 8_000 }, async () => {
  const { adapter, requests, statuses } = fixture({ respond: untilAborted });
  const started = performance.now();
  // A real stalled HTTP socket keeps the event loop alive; the in-memory transport must do so too.
  const keepAlive = setTimeout(() => undefined, 7_000);
  try { await assert.rejects(adapter.onProcessingStart(event(), signal(), () => undefined), error => error instanceof PlatformError && error.kind === 'cancelled'); }
  finally { clearTimeout(keepAlive); }
  assert.ok(performance.now() - started < 7_000);
  assert.deepEqual(requests.map(request => request.action), ['set_msg_emoji_like']); assert.deepEqual(statuses, []);
});

await test('NapCat reaction protocol rejection and transport failure remain isolated from connection state', async () => {
  for (const respond of [() => json(null, 'failed', 1200), () => Promise.reject(new Error('Network interrupted'))]) {
    const { adapter, requests, statuses } = fixture({ respond });
    await assert.rejects(adapter.onProcessingStart(event(), signal(), () => undefined), PlatformError);
    assert.deepEqual(requests.map(request => request.action), ['set_msg_emoji_like']); assert.deepEqual(statuses, []);
  }
});

await test('NapCat WebSocket reaction sends the same fields and rejection leaves the adapter connected', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  const config = PlatformConfigSchema.parse({ id: 'reaction-qq', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}`, preAckEmoji: { enabled: true, emojis: ['124'] } });
  if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const actions: string[] = []; const statuses: AdapterLifecycle[] = []; let ready: (() => void) | undefined;
  const connected = new Promise<void>(resolve => { ready = resolve; });
  server.on('connection', socket => {
    socket.on('message', data => {
      const raw: unknown = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8'));
      const request = z.object({ action: z.string(), echo: z.string(), params: z.unknown() }).parse(raw); actions.push(request.action);
      if (request.action === 'get_login_info') socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900, nickname: 'Socket bot' }, echo: request.echo }));
      else if (request.action === 'set_msg_emoji_like') {
        assert.deepEqual(request.params, { message_id: '-12345', emoji_id: '124', set: true });
        socket.send(JSON.stringify({ status: 'failed', retcode: 1200, data: null, echo: request.echo }));
      } else assert.fail(`Unexpected action ${request.action}`);
    });
  });
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, state) => { statuses.push(state); if (state.status === 'connected') ready?.(); } });
  try {
    await adapter.start(() => Promise.resolve()); await connected;
    await assert.rejects(adapter.onProcessingStart(event(), signal(), () => undefined), error => error instanceof PlatformError && error.kind === 'rejected');
    assert.deepEqual(actions, ['get_login_info', 'set_msg_emoji_like']);
    assert.equal(statuses.at(-1)?.status, 'connected');
  } finally {
    await adapter.stop(); for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  }
});
