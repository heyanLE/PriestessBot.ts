import assert from 'node:assert/strict';
import test from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { RuntimeConfigSchema, PlatformConfigSchema } from '../packages/contracts/src/index.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore } from '../packages/adapters/src/platforms/transport.js';
import { isPrivateAddress, pinnedLookup, resolveMediaTarget } from '../packages/adapters/src/media/download.js';
import { StreamDelivery } from '../packages/adapters/src/messages/delivery.js';
import type { DeliveryOutcome, PlatformAdapter } from '../packages/adapters/src/platforms/types.js';
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => { complete = resolve; });
  return { promise, resolve: value => { if (!complete) throw new Error('Deferred not initialized'); complete(value); } };
}
await test('Queued stream edit rechecks authorization after a blocked send and cannot run after revocation', async () => {
  const entered = deferred<void>(); const release = deferred<DeliveryOutcome>(); let sends = 0; let edits = 0; let authorized = true;
  const adapter: PlatformAdapter = { id: 'review', capabilities: { edit: true, images: false, files: false, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), downloadMedia: () => Promise.reject(new Error('Unused')), send: () => { sends++; entered.resolve(); return release.promise; }, edit: () => { edits++; return Promise.resolve({ status: 'confirmed', messageIds: ['1'] }); } };
  const stream = new StreamDelivery(adapter, { kind: 'group', chatId: 'group' }, 'revoked', { enabled: true, throttleMs: 0, fallback: 'final', chunkChars: 100, beforeSend: () => { if (!authorized) throw new Error('Run revoked'); } });
  const first = stream.push('a'); await entered.promise;
  const next = stream.push('b'); const rejected = assert.rejects(next, /revoked/);
  authorized = false; release.resolve({ status: 'confirmed', messageIds: ['1'] }); await first; await rejected;
  await assert.rejects(stream.finish('abc'), /revoked/); assert.equal(sends, 1); assert.equal(edits, 0);
});
await test('Final chunk delivery stops between pages when its run is cancelled', async () => {
  let sent = 0; const controller = new AbortController();
  const adapter: PlatformAdapter = { id: 'review-chunks', capabilities: { edit: false, images: false, files: false, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), downloadMedia: () => Promise.reject(new Error('Unused')), send: () => { sent++; controller.abort(new Error('Run cancelled')); return Promise.resolve({ status: 'confirmed', messageIds: [String(sent)] }); }, edit: () => Promise.reject(new Error('Unused')) };
  const stream = new StreamDelivery(adapter, { kind: 'private', chatId: 'alice' }, 'cancelled', { enabled: false, throttleMs: 0, fallback: 'final', chunkChars: 100, beforeSend: () => { controller.signal.throwIfAborted(); } });
  await assert.rejects(stream.finish('x'.repeat(250)), /cancelled/); assert.equal(sent, 1);
});

await test('Public media rejects private IPv4, bracketed IPv6 and hexadecimal IPv4-mapped IPv6', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '[::1]', '::ffff:7f00:1', '::ffff:a00:1', 'fe90::1', 'fd12::1', '64:ff9b::7f00:1']) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress('8.8.8.8'), false); assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
  await assert.rejects(resolveMediaTarget('https://[::ffff:7f00:1]/secret'), /Private media/);
  await assert.rejects(resolveMediaTarget('https://media.example/file', () => Promise.resolve([{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.1', family: 4 }])), /Private media/);
});
await test('Pinned media lookup reuses validated addresses without a second DNS resolution', async () => {
  let queries = 0;
  const target = await resolveMediaTarget('https://media.example/file', () => { queries++; return Promise.resolve([{ address: queries === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]); });
  const lookup = pinnedLookup(target.addresses);
  for (let attempt = 0; attempt < 2; attempt++) await new Promise<void>((resolve, reject) => {
    lookup('media.example', { all: true }, (error, address) => { if (error) { reject(error); return; } assert.deepEqual(address, [{ address: '8.8.8.8', family: 4 }]); resolve(); });
  });
  assert.equal(queries, 1);
});

await test('A NapCat private chat and group with the same numeric ID never share model history', async () => {
  const requests: ModelRequest[] = [];
  const model: Model = { getResponse: (): Promise<ModelResponse> => Promise.reject(new Error('Streaming fixture')), async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> { requests.push(request); yield await Promise.resolve(protocol.StreamEvent.parse({ type: 'response_done', response: { id: `reply-${requests.length}`, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ack' }] }] } })); } };
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [{ id: 'agent', displayName: 'Agent', capabilities: ['chat'] }], flow: { routing: { defaultAgentId: 'agent', rules: [] } } });
  const platform = PlatformConfigSchema.parse({ id: 'qq-review', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1' }); if (platform.type !== 'napcat') throw new Error('Invalid fixture');
  const adapter = new NapCatAdapter(platform, { state: new MemoryStateStore(), secret: () => undefined });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  try {
    const privateMessage = await adapter.normalize({ post_type: 'message', message_type: 'private', user_id: 123, self_id: 999, message_id: 1, time: 1800000000, message: [{ type: 'text', data: { text: 'PRIVATE_ONLY_CANARY' } }] }); assert.ok(privateMessage);
    runtime.submit(privateMessage); await runtime.idle();
    const groupMessage = await adapter.normalize({ post_type: 'message', message_type: 'group', user_id: 123, group_id: 123, self_id: 999, message_id: 2, time: 1800000001, message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: 'public hello' } }] }); assert.ok(groupMessage);
    runtime.submit(groupMessage); await runtime.idle();
    assert.equal(requests.length, 2); assert.doesNotMatch(JSON.stringify(requests[1]?.input), /PRIVATE_ONLY_CANARY/);
  } finally { await runtime.stop(); }
});
