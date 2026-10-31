import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { DeliveryRecordSchema, type StoredRun } from '../packages/core/src/storage.js';

function latch(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function waitFor<T>(value: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = value();
    if (found !== undefined) return found;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error('NapCat runtime fixture did not become ready');
}

class ReplyModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly answers: readonly string[], private readonly approval = false, private readonly beforeFinal = (): Promise<void> => Promise.resolve()) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('This fixture exercises streaming Agents SDK execution')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const index = this.requests.length;
    this.requests.push(request);
    if (this.approval && index === 0) {
      yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'approval-tool', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ type: 'function_call', name: 'memory_save', callId: 'approved-memory', arguments: JSON.stringify({ libraryId: 'memory', text: 'Approved fixture note' }), status: 'completed' }] } });
      return;
    }
    const text = this.answers[this.approval ? index - 1 : index];
    if (text === undefined) throw new Error('Unexpected model round');
    yield { type: 'output_text_delta', delta: text.slice(0, 2500) };
    yield { type: 'output_text_delta', delta: text.slice(2500) };
    await this.beforeFinal();
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `answer-${index}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] } });
  }
}

interface ApiCall { readonly action: string; readonly params: Record<string, unknown>; }
interface Fixture {
  readonly runtime: PriestessRuntime;
  readonly calls: ApiCall[];
  readonly send: (kind?: 'private' | 'group', senderId?: string, text?: string) => Promise<StoredRun>;
  readonly beforeAction: (callback: (action: string) => void) => void;
}
type SendResult = 'confirmed' | 'rejected' | 'uncertain';
async function fixture(model: Model, work: (value: Fixture) => Promise<void>, result: SendResult = 'confirmed', resetEnabled = false): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'napcat-forward-runtime-'));
  const calls: ApiCall[] = [];
  let onAction: (action: string) => void = () => {};
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(z.string().parse(chunk)));
      const params = z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const action = request.url?.slice(1) ?? '';
      calls.push({ action, params });
      onAction(action);
      if (action === 'get_login_info') { response.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900, nickname: 'Fixture bot' } })); return; }
      if (action === 'get_group_member_info') { response.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 900, card: 'Fixture group card' } })); return; }
      if (result === 'uncertain') { response.destroy(); return; }
      response.end(JSON.stringify({ status: result === 'rejected' ? 'failed' : 'ok', retcode: result === 'rejected' ? 100 : 0, data: { message_id: calls.length } }));
    })().catch(() => { response.statusCode = 500; response.end(); });
  });
  const websocket = new WebSocketServer({ server });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'Fixture', capabilities: ['chat', 'memory.write', ...(resetEnabled ? ['conversation.reset'] : [])], resources: { memoryLibraries: ['memory'], tools: ['memory_save'] }, approvalTools: ['memory_save'] });
  const state = resetEnabled ? 'senior_operator' : 'operator';
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], memoryLibraries: [{ id: 'memory', displayName: 'Memory' }], grants: ['42', '43'].map(senderId => ({ platform: 'qq', senderId, maximumState: state, defaultState: state, capabilities: agent.capabilities, resources: agent.resources })), platforms: [{ id: 'qq', type: 'napcat', enabled: true, websocketUrl: `ws://127.0.0.1:${address.port}`, apiBase: `http://127.0.0.1:${address.port}`, forwardThreshold: 1500 }], flow: { routing: { defaultAgentId: 'a', rules: [] }, acceptance: { groupPolicy: 'all' }, delivery: { fallback: 'chunks', chunkChars: 100 } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model, secret: () => undefined });
  runtime.setArtifactDirectory(join(directory, 'artifacts'));
  let nextMessageId = 1;
  try {
    await runtime.startPlatforms();
    await waitFor(() => runtime.platformStatus().find(state => state.status === 'connected'));
    await work({ runtime, calls, beforeAction: callback => { onAction = callback; }, send: async (kind = 'group', senderId = '42', text = `Reply to sender ${senderId}`) => {
      const previous = new Set(runtime.store.runs().map(run => run.id));
      const socket = websocket.clients.values().next().value;
      assert.ok(socket);
      socket.send(JSON.stringify({ post_type: 'message', message_type: kind, message_id: nextMessageId++, user_id: Number(senderId), ...(kind === 'group' ? { group_id: 81 } : {}), self_id: 900, time: Math.floor(Date.now() / 1000), sender: { nickname: senderId === '42' ? 'Alice' : 'Bob' }, message: [{ type: 'text', data: { text } }] }));
      return waitFor(() => runtime.store.runs().find(run => !previous.has(run.id)));
    } });
  } finally {
    await runtime.stop();
    for (const client of websocket.clients) client.terminate();
    await new Promise<void>((resolve, reject) => websocket.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

const forwardSchema = z.object({ messages: z.array(z.object({ type: z.literal('node'), data: z.object({ user_id: z.literal('900'), nickname: z.string(), content: z.array(z.object({ type: z.literal('text'), data: z.object({ text: z.string() }) })) }) })).length(1) });
function sent(calls: readonly ApiCall[]): ApiCall[] { return calls.filter(call => call.action.startsWith('send_') || call.action.startsWith('upload_')); }
function forwardText(call: ApiCall | undefined): string {
  assert.ok(call);
  return forwardSchema.parse(call.params).messages.flatMap(node => node.data.content.map(part => part.data.text)).join('');
}
async function pause(value: Fixture, kind: 'private' | 'group'): Promise<{ run: StoredRun; approvalId: string }> {
  const run = await value.send(kind);
  await value.runtime.idle();
  const paused = value.runtime.detail(run.id).events.find(event => event.type === 'paused');
  assert.ok(paused && paused.type === 'paused');
  assert.deepEqual(sent(value.calls), []);
  return { run, approvalId: paused.approvalId };
}

void test('NapCat runtime waits for the full streamed answer and folds a long group reply into one card', { timeout: 10_000 }, async () => {
  const entered = latch(); const release = latch(); const text = '完整群聊回复。'.repeat(900);
  const model = new ReplyModel([text], false, async () => { entered.release(); await release.promise; });
  try {
    await fixture(model, async value => {
      const run = await value.send();
      try { await entered.promise; assert.deepEqual(sent(value.calls), []); }
      finally { release.release(); }
      await value.runtime.idle();
      assert.deepEqual(sent(value.calls).map(call => call.action), ['send_group_forward_msg']);
      assert.equal(forwardText(sent(value.calls)[0]), text);
      assert.equal(sent(value.calls)[0]?.params.group_id, '81');
      assert.equal(value.runtime.detail(run.id).run.status, 'completed');
    });
  } finally { release.release(); }
});

void test('NapCat approval resume sends a long private reply once without 2000-character pagination', { timeout: 10_000 }, async () => {
  const text = '审批后的完整私聊回复。'.repeat(700);
  await fixture(new ReplyModel([text], true), async value => {
    const { run, approvalId } = await pause(value, 'private');
    value.runtime.approve(run.id, approvalId, true); await value.runtime.idle();
    assert.deepEqual(sent(value.calls).map(call => call.action), ['send_private_forward_msg']);
    assert.equal(forwardText(sent(value.calls)[0]), text);
    assert.equal(sent(value.calls)[0]?.params.user_id, '42');
    const detail = value.runtime.detail(run.id);
    assert.equal(detail.run.status, 'completed');
    assert.equal(detail.events.filter(event => event.type === 'completed').length, 1);
    assert.equal(detail.events.filter(event => event.type === 'tool' && event.status === 'started').length, 1);
    assert.throws(() => value.runtime.approve(run.id, approvalId, true), /already resumed/);
    assert.equal(sent(value.calls).length, 1);
  });
});

for (const kind of ['private', 'group'] as const) void test(`NapCat runtime keeps short ${kind} replies as normal messages`, { timeout: 10_000 }, async () => {
  const text = '短回复。';
  await fixture(new ReplyModel([text]), async value => {
    const run = await value.send(kind); await value.runtime.idle();
    assert.deepEqual(sent(value.calls).map(call => call.action), [`send_${kind}_msg`]);
    assert.equal(value.runtime.detail(run.id).run.status, 'completed');
    assert.deepEqual(sent(value.calls)[0]?.params.message, [{ type: 'text', data: { text } }]);
  });
});

for (const approval of [false, true]) for (const result of ['rejected', 'uncertain'] as const) void test(`NapCat ${approval ? 'approved' : 'ordinary'} ${result} forward is not retried as split messages`, { timeout: 10_000 }, async () => {
  await fixture(new ReplyModel(['失败时也不拆分。'.repeat(900)], approval), async value => {
    let run: StoredRun;
    if (approval) { const paused = await pause(value, 'group'); run = paused.run; value.runtime.approve(run.id, paused.approvalId, true); }
    else run = await value.send();
    await value.runtime.idle();
    assert.deepEqual(sent(value.calls).map(call => call.action), ['send_group_forward_msg']);
    assert.equal(value.runtime.detail(run.id).run.status, 'failed');
    assert.equal(value.runtime.detail(run.id).events.some(event => event.type === 'completed'), false);
    assert.equal(value.runtime.store.list('delivery', DeliveryRecordSchema).at(-1)?.status, result === 'uncertain' ? 'uncertain' : 'failed');
  }, result);
});

void test('NapCat rechecks authorization after forward identity lookup and cannot deliver another sender’s stale reply', { timeout: 10_000 }, async () => {
  const aliceText = 'Alice 私有回复。'.repeat(700); const bobText = 'Bob 当前回复。'.repeat(700);
  await fixture(new ReplyModel([aliceText, bobText]), async value => {
    let revoked = false;
    value.beforeAction(action => {
      if (action === 'get_group_member_info' && !revoked) {
        revoked = true;
        value.runtime.auth.replaceGrants(value.runtime.config().grants.filter(grant => grant.senderIds.includes('43')));
      }
    });
    const alice = await value.send('group', '42'); await value.runtime.idle();
    assert.equal(revoked, true);
    assert.deepEqual(sent(value.calls), []);
    assert.equal(value.runtime.detail(alice.id).run.status, 'failed');
    const bob = await value.send('group', '43'); await value.runtime.idle();
    assert.deepEqual(sent(value.calls).map(call => call.action), ['send_group_forward_msg']);
    assert.equal(forwardText(sent(value.calls)[0]), bobText);
    assert.doesNotMatch(JSON.stringify(sent(value.calls)), /Alice 私有回复/);
    assert.equal(value.runtime.detail(bob.id).run.status, 'completed');
  });
});

void test('NapCat reset command acknowledges the new conversation after advancing its generation', { timeout: 10_000 }, async () => {
  const model = new ReplyModel([]);
  await fixture(model, async value => {
    const run = await value.send('group', '42', '/reset');
    await value.runtime.idle();
    assert.equal(value.runtime.store.generation(run.sessionKey), 1);
    assert.equal(value.runtime.detail(run.id).run.status, 'completed');
    assert.deepEqual(sent(value.calls).map(call => call.action), ['send_group_msg']);
    assert.deepEqual(sent(value.calls)[0]?.params.message, [{ type: 'text', data: { text: '已开始新会话（1）。' } }]);
    assert.equal(model.requests.length, 0);
  }, 'confirmed', true);
});
