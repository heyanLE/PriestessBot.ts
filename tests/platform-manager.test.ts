import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PlatformConfigSchema, SessionIdSchema, type MessageEvent } from '../packages/contracts/src/index.js';
import { PlatformManager, MemoryStateStore, TelegramAdapter, WeixinAdapter, type AdapterDependencies, type AdapterLifecycle, type PlatformAdapter, type PlatformStatus } from '../packages/adapters/src/platforms/index.js';

const telegramConfig = PlatformConfigSchema.parse({ id: 'tg-manager', type: 'telegram', tokenEnv: 'TG_TEST', enabled: true });
const json = (value: object): Response => new Response(JSON.stringify(value));
function pendingPoll(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }
    signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true });
  });
}

await test('Platform manager reports authenticated Telegram without waiting for a message and preserves unchanged consumers', async () => {
  const manager = new PlatformManager(); let authentications = 0;
  const dependencies: AdapterDependencies = { state: new MemoryStateStore(), secret: () => 'fixture', fetch: (url, init) => {
    if (String(url).endsWith('getMe')) { authentications++; return Promise.resolve(json({ ok: true, result: { id: 100 } })); }
    return pendingPoll(init?.signal);
  } };
  try {
    await manager.reconcile([telegramConfig], dependencies, () => Promise.resolve());
    await delay(0);
    assert.deepEqual(manager.status(), [{ id: telegramConfig.id, status: 'connected' }]);
    const adapter = manager.get(telegramConfig.id);
    await manager.reconcile([telegramConfig], dependencies, () => Promise.resolve());
    assert.equal(manager.get(telegramConfig.id), adapter); assert.equal(authentications, 1);
  } finally { await manager.stop(); }
  assert.deepEqual(manager.status(), [{ id: telegramConfig.id, status: 'stopped' }]);
});

await test('Telegram recovers after failed startup and empty polling restores connection state', { timeout: 5000 }, async () => {
  if (telegramConfig.type !== 'telegram') throw new Error('Invalid fixture');
  const states: AdapterLifecycle[] = []; let attempts = 0; let polls = 0;
  let recovered: (() => void) | undefined; const recovery = new Promise<void>(resolve => { recovered = resolve; });
  const adapter = new TelegramAdapter(telegramConfig, { state: new MemoryStateStore(), secret: () => 'fixture', onStatus: (_id, state) => { states.push(state); if (state.status === 'connected' && polls === 2) recovered?.(); }, fetch: (url, init) => {
    if (String(url).endsWith('getMe')) { attempts++; return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(json({ ok: true, result: { id: 100 } })); }
    polls++;
    if (polls === 1) return Promise.reject(new Error('connection reset'));
    if (polls === 2) return Promise.resolve(json({ ok: true, result: [] }));
    return pendingPoll(init?.signal);
  } });
  try { await adapter.start(() => Promise.resolve()); await recovery; }
  finally { await adapter.stop(); }
  assert.equal(attempts, 2);
  assert.deepEqual(states.map(state => state.status), ['starting', 'error', 'connected', 'error', 'connected', 'stopped']);
});

await test('WeChat remains pending until credentials are accepted by polling', async () => {
  const config = PlatformConfigSchema.parse({ id: 'wx-manager', type: 'weixin' });
  if (config.type !== 'weixin') throw new Error('Invalid fixture');
  const statuses: AdapterLifecycle[] = [];
  const adapter = new WeixinAdapter(config, { state: new MemoryStateStore(), secret: () => undefined, onStatus: (_id, state) => { statuses.push(state); }, fetch: () => Promise.reject(new Error('No requests expected before login')) });
  await adapter.start(() => Promise.resolve()); await adapter.stop();
  assert.ok(statuses.some(state => state.message === '等待微信扫码登录'));
  assert.equal(statuses.some(state => state.status === 'connected'), false);
});

await test('Manager ignores superseded and stopped instance callbacks and ingress', async () => {
  const callbacks: { report: (state: AdapterLifecycle) => void; receive?: (event: MessageEvent) => Promise<void> }[] = [];
  const manager = new PlatformManager((config, dependencies) => {
    const callbacksForInstance: { report: (state: AdapterLifecycle) => void; receive?: (event: MessageEvent) => Promise<void> } = { report: state => dependencies.onStatus?.(config.id, state) }; callbacks.push(callbacksForInstance);
    const adapter: PlatformAdapter = {
      id: config.id, capabilities: { edit: false, images: false, files: false, groups: false, audio: false },
      start: receive => { callbacksForInstance.receive = receive; callbacksForInstance.report({ status: 'connected' }); return Promise.resolve(); },
      stop: () => { callbacksForInstance.report({ status: 'stopped' }); return Promise.resolve(); },
      send: () => Promise.resolve({ status: 'confirmed', messageIds: [] }),
      edit: () => Promise.resolve({ status: 'confirmed', messageIds: [] }),
      downloadMedia: () => Promise.reject(new Error('Not used')),
    }; return adapter;
  });
  const dependencies = { state: new MemoryStateStore(), secret: () => undefined }; let ingress = 0;
  const event: MessageEvent = { platform: telegramConfig.id, platformType: 'telegram', sessionId: SessionIdSchema.parse('session'), sessionType: 'private', senderId: 'user', senderName: 'User', messageId: '1', timestamp: 1, botId: '100', parts: [] };
  await manager.reconcile([telegramConfig], dependencies, () => { ingress++; return Promise.resolve(); });
  await manager.reconcile([{ ...telegramConfig, enabled: false }], dependencies, () => Promise.resolve());
  callbacks[0]?.report({ status: 'connected' }); await callbacks[0]?.receive?.(event);
  assert.deepEqual(manager.status(), [{ id: telegramConfig.id, status: 'disabled' }]); assert.equal(ingress, 0);
  await manager.reconcile([telegramConfig], dependencies, () => { ingress++; return Promise.resolve(); });
  await manager.stop();
  callbacks.at(-1)?.report({ status: 'connected' }); await callbacks.at(-1)?.receive?.(event);
  assert.deepEqual(manager.status(), [{ id: telegramConfig.id, status: 'stopped' }]); assert.equal(ingress, 0);
  const snapshots: PlatformStatus[] = manager.status(); const first = snapshots[0]; if (first) first.status = 'connected';
  assert.equal(manager.status()[0]?.status, 'stopped');
});
