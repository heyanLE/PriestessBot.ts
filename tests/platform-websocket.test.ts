import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { PlatformConfigSchema, type MessageEvent } from '../packages/contracts/src/index.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore } from '../packages/adapters/src/platforms/transport.js';
await test('NapCat WebSocket transport correlates API replies, receives messages, and closes cleanly', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening'); const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  const config = PlatformConfigSchema.parse({ id: 'fixture-qq', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}` }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const received: MessageEvent[] = []; let resolveMessage: (() => void) | undefined;
  const messageReady = new Promise<void>(resolve => { resolveMessage = resolve; });
  server.on('connection', socket => {
    socket.on('message', data => {
      const raw: unknown = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8'));
      const request = z.object({ action: z.string(), echo: z.string(), params: z.record(z.string(), z.unknown()) }).parse(raw);
      if (request.action === 'get_login_info') {
        socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900 }, echo: request.echo }));
        socket.send(JSON.stringify({ post_type: 'message', message_type: 'group', message_id: 7, user_id: 42, group_id: 81, self_id: 900, time: 1800000000, message: [{ type: 'text', data: { text: 'hello fixture' } }] }));
      } else if (request.action === 'send_group_msg') socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 8 }, echo: request.echo }));
    });
  });
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined });
  try {
    await adapter.start(event => { received.push(event); resolveMessage?.(); return Promise.resolve(); });
    await messageReady;
    assert.equal(received[0]?.senderId, '42'); assert.equal(received[0]?.sessionId, '81');
    const sent = await adapter.send({ chatId: '81', kind: 'group' }, { parts: [{ type: 'text', text: 'fixture reply' }] }, 'send-1');
    assert.deepEqual(sent, { status: 'confirmed', messageIds: ['8'] });
  } finally { await adapter.stop(); for (const client of server.clients) client.terminate(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }
});
await test('NapCat stop during quote hydration cannot submit an event after shutdown', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening'); const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  const config = PlatformConfigSchema.parse({ id: 'stop-qq', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}`, apiBase: 'http://fixture.invalid' }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  let enterQuote: (() => void) | undefined; const quoteStarted = new Promise<void>(resolve => { enterQuote = resolve; }); let received = 0;
  server.on('connection', socket => { socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 7, user_id: 42, self_id: 900, time: 1800000000, message: [{ type: 'reply', data: { id: 'old' } }, { type: 'text', data: { text: 'reply' } }] })); });
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, fetch: (url, init) => {
    if (String(url).endsWith('get_login_info')) return Promise.resolve(new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900 } })));
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true }); enterQuote?.(); });
  } });
  try { await adapter.start(() => { received++; return Promise.resolve(); }); await quoteStarted; await adapter.stop(); await new Promise<void>(resolve => setTimeout(resolve, 20)); assert.equal(received, 0); }
  finally { await adapter.stop(); for (const client of server.clients) client.terminate(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }
});
await test('NapCat reports readiness after login and recovers without needing an inbound message', { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening'); const address = server.address(); assert.ok(typeof address === 'object' && address !== null);
  const config = PlatformConfigSchema.parse({ id: 'recover-qq', type: 'napcat', websocketUrl: `ws://127.0.0.1:${address.port}` }); if (config.type !== 'napcat') throw new Error('Invalid fixture');
  let connections = 0; let finish: (() => void) | undefined; const recovered = new Promise<void>(resolve => { finish = resolve; }); const statuses: string[] = [];
  server.on('connection', socket => {
    connections++;
    socket.on('message', data => {
      const raw: unknown = JSON.parse(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8'));
      const request = z.object({ action: z.literal('get_login_info'), echo: z.string() }).parse(raw);
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900 }, echo: request.echo }));
      if (connections === 1) setTimeout(() => socket.close(), 10);
    });
  });
  const adapter = new NapCatAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, state) => { statuses.push(state.status); if (connections === 2 && state.status === 'connected') finish?.(); } });
  try {
    await adapter.start(() => Promise.reject(new Error('No inbound message expected')));
    assert.deepEqual(statuses, ['starting']);
    await recovered;
  } finally { await adapter.stop(); for (const client of server.clients) client.terminate(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }); }
  assert.deepEqual(statuses, ['starting', 'connected', 'error', 'connected', 'stopped']);
});
