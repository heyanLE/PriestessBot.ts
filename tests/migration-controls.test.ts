import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageEventSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { AuthorizationService, ConversationScheduler, FlowService, RuntimeStore, simulateFlow } from '../packages/core/src/index.js';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';

const base = defaultConfiguration();
const config = RuntimeConfigSchema.parse({ ...base, flow: { ...base.flow, acceptance: { ...base.flow.acceptance, allowlist: { enabled: true, entries: [{ platform: 'qq', sessionType: 'group', sessionId: 'allowed' }], administrators: [{ platform: 'qq', senderId: 'owner' }], bypassAdministratorsInPrivate: true, bypassAdministratorsInGroups: false } } } });
const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionType: 'group', sessionId: 'allowed', senderId: 'visitor', messageId: '1', timestamp: 1, botId: 'bot', parts: [{ type: 'text', text: '/help' }] });

void test('allowlist gates commands before routing and isolates instance, session type and administrator bindings', () => {
  assert.equal(simulateFlow(config, message).outcome, 'command');
  assert.equal(simulateFlow(config, { ...message, platform: 'other' }).reason, 'Conversation is not in the allowlist');
  assert.equal(simulateFlow(config, { ...message, sessionType: 'private' }).outcome, 'ignored');
  const denied = simulateFlow(config, MessageEventSchema.parse({ ...message, sessionId: 'unknown', senderId: 'owner' }));
  assert.equal(denied.outcome, 'ignored'); assert.equal(denied.path.some(step => step.nodeId === 'command' || step.nodeId === 'route'), false);
  assert.equal(simulateFlow(config, { ...message, sessionType: 'private', senderId: 'owner' }).outcome, 'command');
  assert.equal(simulateFlow(config, { ...message, platform: 'other', sessionType: 'private', senderId: 'owner' }).outcome, 'ignored');
  assert.equal(simulateFlow(config, { ...message, platform: 'dashboard', sessionType: 'private' }).outcome, 'command');
  const empty = RuntimeConfigSchema.parse({ ...config, flow: { ...config.flow, acceptance: { ...config.flow.acceptance, allowlist: { enabled: true } } } });
  assert.equal(simulateFlow(empty, message).outcome, 'ignored');
  assert.equal(base.flow.acceptance.allowlist.enabled, false);
  assert.deepEqual(base.flow.execution, { timeoutMs: 120000, maxTurns: 12, globalConcurrency: 4, perSessionQueueLimit: 16, globalQueueLimit: 256 });
});

void test('rate count zero disables rate limiting but preserves message deduplication', () => {
  const store = new RuntimeStore(':memory:'); const flow = new FlowService(store, new AuthorizationService([]));
  const unlimited = RuntimeConfigSchema.parse({ ...config, flow: { ...config.flow, acceptance: { ...config.flow.acceptance, rateLimitCount: 0 } } });
  try {
    for (let index = 0; index < 40; index++) assert.equal(flow.accept(unlimited, { ...message, messageId: String(index) }).outcome, 'command');
    assert.equal(flow.accept(unlimited, { ...message, messageId: '39' }).reason, 'Duplicate message');
  } finally { store.close(); }
});

void test('scheduler reconfiguration retains admitted work and enforces new admission bounds', async () => {
  const scheduler = new ConversationScheduler(1, 5, 8);
  const releases: (() => void)[] = [];
  const first = scheduler.enqueue('first', () => new Promise<void>(resolve => { releases.push(resolve); }));
  const second = scheduler.enqueue('second', () => new Promise<void>(resolve => { releases.push(resolve); }));
  const sameSession = scheduler.enqueue('first', () => Promise.resolve());
  scheduler.configure(2, 1, 1);
  assert.equal(scheduler.running, 2); assert.equal(scheduler.pending, 1);
  await assert.rejects(scheduler.enqueue('first', () => Promise.resolve()), /queue is full/);
  await assert.rejects(scheduler.enqueue('third', () => Promise.resolve()), /queue is full/);
  scheduler.configure(1, 1, 1);
  assert.equal(scheduler.running, 2);
  assert.throws(() => scheduler.configure(Number.NaN, 1, 1), /Invalid scheduler/);
  for (const release of releases) release();
  await Promise.all([first, second, sameSession]);
  await scheduler.shutdown();
});

void test('runtime initializes and republishes migrated queue bounds', async () => {
  const queueConfig = RuntimeConfigSchema.parse({ ...base, flow: { ...base.flow, execution: { ...base.flow.execution, globalConcurrency: 1, perSessionQueueLimit: 1, globalQueueLimit: 1 } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config: queueConfig });
  const releases: (() => void)[] = [];
  const first = runtime.scheduler.enqueue('first', () => new Promise<void>(resolve => { releases.push(resolve); }));
  const second = runtime.scheduler.enqueue('first', () => Promise.resolve());
  try {
    await assert.rejects(runtime.scheduler.enqueue('first', () => Promise.resolve()), /queue is full/);
    const current = runtime.config();
    await runtime.publish(RuntimeConfigSchema.parse({ ...current, flow: { ...current.flow, execution: { ...current.flow.execution, perSessionQueueLimit: 2, globalQueueLimit: 2 } } }), current.revision);
    const third = runtime.scheduler.enqueue('first', () => Promise.resolve());
    for (const release of releases) release();
    await Promise.all([first, second, third]);
  } finally { for (const release of releases) release(); await runtime.stop(); }
});
