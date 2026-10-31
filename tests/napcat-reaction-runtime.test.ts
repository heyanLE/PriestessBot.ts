import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, MessageEventSchema, RuntimeConfigSchema, type MessageEvent, type RuntimeConfig } from '../packages/contracts/src/index.js';
import type { DeliveryOutcome, DownloadedMedia, PlatformAdapter } from '../packages/adapters/src/platforms/types.js';
import { principalKey } from '../packages/core/src/authorization.js';

function latch(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Reaction fixture did not reach the expected state');
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
}
async function waitUntilReleased(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  let abort = (): void => {};
  const cancelled = new Promise<void>((_resolve, reject: (error: Error) => void) => {
    abort = (): void => reject(new Error('Run cancelled'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  try { await Promise.race([promise, cancelled]); }
  finally { signal?.removeEventListener('abort', abort); }
}
class ReplyModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly before: (request: ModelRequest, index: number) => Promise<void> = () => Promise.resolve(), private readonly approval = false) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Streaming only')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const index = this.requests.length;
    this.requests.push(request);
    await this.before(request, index);
    const output = this.approval && index === 0
      ? [{ type: 'function_call', name: 'memory_save', callId: 'save-once', arguments: JSON.stringify({ libraryId: 'memory', text: 'approved fixture' }), status: 'completed' }]
      : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `answer-${index}` }] }];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `response-${index}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
  }
}
class ReactionAdapter implements PlatformAdapter {
  readonly capabilities = { edit: false, images: true, files: true, groups: true, audio: false, wholeReply: true } as const;
  readonly started: string[] = [];
  readonly reacted: string[] = [];
  constructor(readonly id = 'qq', private readonly beforeEffect = (): Promise<void> => Promise.resolve(), private readonly afterEffect = (): Promise<void> => Promise.resolve()) {}
  start(): Promise<void> { return Promise.resolve(); }
  stop(): Promise<void> { return Promise.resolve(); }
  send(): Promise<DeliveryOutcome> { return Promise.resolve({ status: 'confirmed', messageIds: ['reply'] }); }
  edit(): Promise<DeliveryOutcome> { return Promise.reject(new Error('Unsupported')); }
  downloadMedia(): Promise<DownloadedMedia> { return Promise.reject(new Error('No media in this fixture')); }
  async onProcessingStart(message: MessageEvent, signal: AbortSignal, beforeSend: () => void): Promise<void> {
    this.started.push(message.messageId);
    await waitUntilReleased(this.beforeEffect(), signal);
    beforeSend();
    this.reacted.push(message.messageId);
    await waitUntilReleased(this.afterEffect(), signal);
  }
}
function message(id: string, senderId = '42', text = 'Please reply', kind: 'group' | 'private' = 'group'): MessageEvent {
  return MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: kind === 'group' ? '81' : senderId, sessionType: kind, senderId, senderName: senderId, messageId: id, timestamp: Date.now(), botId: '900', parts: [{ type: 'text', text }] });
}
function configuration(): RuntimeConfig {
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'Fixture', capabilities: ['chat', 'conversation.stop', 'memory.write'], resources: { memoryLibraries: ['memory'], tools: ['memory_save'] }, approvalTools: ['memory_save'] });
  return RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], memoryLibraries: [{ id: 'memory', displayName: 'Memory' }], platforms: [{ id: 'qq', type: 'napcat', enabled: true, websocketUrl: 'ws://127.0.0.1:1', preAckEmoji: { enabled: true, emojis: ['124'] } }], flow: { routing: { defaultAgentId: agent.id, rules: [] }, acceptance: { groupPolicy: 'all' }, execution: { globalConcurrency: 1, perSessionQueueLimit: 1, globalQueueLimit: 1 } } });
}

void test('group processing acknowledges the trigger once before its model finishes, including signed message IDs', async () => {
  const entered = latch(); const release = latch(); const adapter = new ReactionAdapter();
  const model = new ReplyModel(async request => { entered.release(); await waitUntilReleased(release.promise, request.signal); });
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    const incoming = message('-123'); incoming.parts.push({ type: 'quote', messageId: '456', text: 'quoted source' });
    const run = runtime.submit(incoming, adapter);
    await entered.promise;
    assert.deepEqual(adapter.reacted, ['-123']);
    assert.equal(runtime.detail(run.id).run.status, 'running');
    runtime.submit(incoming, adapter);
    release.release(); await runtime.idle();
    assert.deepEqual(adapter.reacted, ['-123']);
    assert.equal(runtime.detail(run.id).run.status, 'completed');
  } finally { release.release(); await runtime.stop(); }
});

void test('private, synthetic, bot-owned and mismatched-adapter messages never receive group start reactions', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model: new ReplyModel() });
  const adapter = new ReactionAdapter(); const other = new ReactionAdapter('other');
  try {
    for (const incoming of [message('1', '42', 'private', 'private'), message('upload:file:1'), message('background:process'), message('2', '900')]) { runtime.submit(incoming, adapter); await runtime.idle(); }
    runtime.submit(message('3'), other); await runtime.idle();
    assert.deepEqual(adapter.started, []); assert.deepEqual(other.started, []);
  } finally { await runtime.stop(); }
});

void test('disabled reactions and empty emoji choices skip the lifecycle hook', async () => {
  for (const settings of [{ enabled: false, emojis: ['124'] }, { enabled: true, emojis: [] }]) {
    const base = configuration();
    const config = RuntimeConfigSchema.parse({ ...base, platforms: base.platforms.map(platform => ({ ...platform, preAckEmoji: settings })) });
    const adapter = new ReactionAdapter();
    const runtime = new PriestessRuntime({ database: ':memory:', config, model: new ReplyModel() });
    try {
      const run = runtime.submit(message('1'), adapter); await runtime.idle();
      assert.deepEqual(adapter.started, []); assert.equal(runtime.detail(run.id).run.status, 'completed');
    } finally { await runtime.stop(); }
  }
});

void test('a later ingress replay cannot repeat the reaction, while the same message ID in another group remains independent', async () => {
  const model = new ReplyModel(); const adapter = new ReactionAdapter();
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    const incoming = message('1'); runtime.submit(incoming, adapter); await runtime.idle();
    // Simulate expiry of the shorter ingress dedupe window while the reaction claim survives.
    runtime.store.db.prepare('DELETE FROM dedupe WHERE id=?').run(JSON.stringify([incoming.platform, incoming.sessionType, incoming.sessionId, incoming.messageId]));
    runtime.submit(incoming, adapter); await runtime.idle();
    assert.equal(model.requests.length, 2); assert.deepEqual(adapter.reacted, ['1']);
    runtime.submit(MessageEventSchema.parse({ ...incoming, sessionId: '82' }), adapter); await runtime.idle();
    assert.deepEqual(adapter.reacted, ['1', '1']);
  } finally { await runtime.stop(); }
});

void test('ignored and allowlist-blocked group input never starts a reaction', async () => {
  const base = configuration();
  const config = RuntimeConfigSchema.parse({ ...base, grants: [{ platform: 'qq', senderId: '43', maximumState: 'operator', capabilities: [], resources: {} }], flow: { ...base.flow, acceptance: { ...base.flow.acceptance, groupPolicy: 'mention_or_reply', allowlist: { enabled: true, entries: [{ platform: 'qq', sessionType: 'group', sessionId: '81' }] } } } });
  const model = new ReplyModel(); const adapter = new ReactionAdapter();
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  try {
    runtime.submit(message('1'), adapter);
    const denied = MessageEventSchema.parse({ ...message('2', '43'), sessionId: 'blocked-group' }); denied.parts.push({ type: 'mention', userId: '900' });
    runtime.submit(denied, adapter); await runtime.idle();
    assert.deepEqual(adapter.started, []); assert.equal(model.requests.length, 0);
  } finally { await runtime.stop(); }
});

void test('queued messages react only when dispatched and queue overflow never reacts', async () => {
  const entered = latch(); const release = latch(); const adapter = new ReactionAdapter();
  const model = new ReplyModel(async (request, index) => { if (index === 0) { entered.release(); await waitUntilReleased(release.promise, request.signal); } });
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    runtime.submit(message('1'), adapter); await entered.promise;
    const queued = runtime.submit(message('2', '43'), adapter);
    const overflow = runtime.submit(message('3', '44'), adapter);
    assert.equal(runtime.detail(queued.id).run.status, 'queued');
    assert.deepEqual(adapter.started, ['1']);
    release.release(); await runtime.idle();
    assert.deepEqual(adapter.reacted, ['1', '2']);
    assert.equal(runtime.detail(overflow.id).run.status, 'failed');
    assert.match(runtime.detail(overflow.id).run.summary, /queue/i);
  } finally { release.release(); await runtime.stop(); }
});

void test('cancelled queued messages and unconsumed follow-ups never receive reactions', async () => {
  const entered = latch(); const release = latch(); const adapter = new ReactionAdapter();
  const model = new ReplyModel(async request => { entered.release(); await waitUntilReleased(release.promise, request.signal); });
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    const initial = runtime.submit(message('1'), adapter); await entered.promise;
    const follow = runtime.submit(message('2'), adapter); const queued = runtime.submit(message('3', '43'), adapter);
    assert.equal(follow.id, initial.id);
    runtime.scheduler.cancel(queued.sessionKey, 'Stopped by user', principalKey(message('3', '43')));
    runtime.cancel(initial.id); await runtime.idle();
    assert.deepEqual(adapter.started, ['1']); assert.equal(model.requests.length, 1);
    assert.equal(runtime.detail(queued.id).run.status, 'cancelled');
  } finally { release.release(); await runtime.stop(); }
});

void test('same-run follow-ups react on consumption once without repeating the original reaction', async () => {
  const entered = latch(); const release = latch(); const adapter = new ReactionAdapter();
  const model = new ReplyModel(async (request, index) => { if (index === 0) { entered.release(); await waitUntilReleased(release.promise, request.signal); } });
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    const initial = runtime.submit(message('1'), adapter); await entered.promise;
    assert.equal(runtime.submit(message('2'), adapter).id, initial.id);
    assert.deepEqual(adapter.started, ['1']);
    release.release(); await runtime.idle();
    assert.deepEqual(adapter.reacted, ['1', '2']); assert.equal(model.requests.length, 2);
  } finally { release.release(); await runtime.stop(); }
});

void test('failed and pending optional reactions do not hold up model execution or alter successful results', async () => {
  for (const failure of [true, false]) {
    const release = latch();
    const adapter = new ReactionAdapter('qq', () => Promise.resolve(), () => failure ? Promise.reject(new Error('NapCat rejected reaction')) : release.promise);
    const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model: new ReplyModel() });
    try {
      const run = runtime.submit(message('1'), adapter);
      await waitFor(() => runtime.detail(run.id).run.status === 'completed');
      assert.deepEqual(adapter.reacted, ['1']);
      release.release(); await runtime.idle();
      assert.equal(runtime.detail(run.id).events.some(event => event.type === 'failed'), false);
    } finally { release.release(); await runtime.stop(); }
  }
});

void test('reaction permission is rechecked immediately before its effect', async () => {
  const release = latch(); const adapter = new ReactionAdapter('qq', () => release.promise);
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model: new ReplyModel() });
  try {
    const run = runtime.submit(message('1'), adapter);
    await waitFor(() => runtime.detail(run.id).run.status === 'completed');
    runtime.auth.replaceGrants([]); release.release(); await runtime.idle();
    assert.deepEqual(adapter.started, ['1']); assert.deepEqual(adapter.reacted, []);
    assert.equal(runtime.detail(run.id).run.status, 'completed');
  } finally { release.release(); await runtime.stop(); }
});

void test('approval resumes do not react again to the original triggering message', async () => {
  const adapter = new ReactionAdapter(); const model = new ReplyModel(undefined, true);
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  try {
    const run = runtime.submit(message('1'), adapter); await runtime.idle();
    const paused = runtime.detail(run.id).events.find(event => event.type === 'paused');
    assert.ok(paused && paused.type === 'paused'); assert.deepEqual(adapter.reacted, ['1']);
    runtime.approve(run.id, paused.approvalId, true); await runtime.idle();
    assert.deepEqual(adapter.reacted, ['1']); assert.equal(model.requests.length, 2);
    assert.equal(runtime.detail(run.id).run.status, 'completed');
  } finally { await runtime.stop(); }
});

void test('legacy Agent capability lists do not remove fixed-role chat access for control commands', async () => {
  const base = configuration();
  const config = RuntimeConfigSchema.parse({ ...base, agents: base.agents.map(agent => ({ ...agent, capabilities: ['conversation.stop'] })) });
  const adapter = new ReactionAdapter(); const model = new ReplyModel();
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  try {
    const run = runtime.submit(message('1', '42', '/help'), adapter); await runtime.idle();
    assert.equal(runtime.detail(run.id).run.status, 'completed');
    assert.deepEqual(adapter.started, ['1']); assert.equal(model.requests.length, 0);
  } finally { await runtime.stop(); }
});
