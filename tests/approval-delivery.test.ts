import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { protocol, type Model, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, MessageEventSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { DeliveryRecordSchema } from '../packages/core/src/storage.js';
function latch() { let release = (): void => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
class ApprovalModel implements Model {
  calls = 0;
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Streaming only')); }
  async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve(); const index = this.calls++;
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `reply-${index}`, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: index === 0 ? [{ type: 'function_call', name: 'attach_file', callId: 'attach-once', arguments: JSON.stringify({ path: 'note.txt', name: 'note.txt', mimeType: 'text/plain' }), status: 'completed' }] : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Here is the approved file' }] }] } });
  }
}
async function fixture(work: (runtime: PriestessRuntime, methods: string[], beforeSend: (callback: () => void) => void) => Promise<void>, uncertain = false): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'approval-delivery-')); const methods: string[] = []; let onSend = (): void => {};
  const server = createServer((request, response) => {
    const method = request.url?.split('/').at(-1) ?? ''; request.resume();
    if (method === 'getUpdates') { setTimeout(() => { if (!response.destroyed) response.end(JSON.stringify({ ok: true, result: [] })); }, 100).unref(); return; }
    if (method === 'getMe') { response.end(JSON.stringify({ ok: true, result: { id: 123, first_name: 'fixture', is_bot: true } })); return; }
    methods.push(method); onSend();
    if (uncertain) { response.destroy(); return; }
    response.end(JSON.stringify({ ok: true, result: { message_id: methods.length } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Listener unavailable');
  const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'a', capabilities: ['chat','files.read','conversation.stop'], resources: { executionEnvironment: 'local', tools: ['attach_file'] }, approvalTools: ['attach_file'] });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], executionEnvironments: [{ id: 'local', type: 'local', root: directory }], platforms: [{ id: 'tg', type: 'telegram', enabled: true, tokenEnv: 'TEST_TOKEN', apiBase: `http://127.0.0.1:${address.port}` }], flow: { routing: { defaultAgentId: 'a', rules: [] } } });
  const workspace = join(directory, createHash('sha256').update(JSON.stringify(['tg','private','chat','a',0])).digest('hex')); await mkdir(workspace); await writeFile(join(workspace, 'note.txt'), 'approved attachment');
  const runtime = new PriestessRuntime({ database: ':memory:', config, model: new ApprovalModel(), secret: () => 'fixture' }); runtime.setArtifactDirectory(join(directory, 'artifacts'));
  runtime.setMediaResolvers({ resolveMedia: async part => { const record = runtime.store.get('artifacts', part.url.slice(9), z.object({ file: z.string(), name: z.string(), mimeType: z.string() })); if (!record) throw new Error('Artifact missing'); return { bytes: await readFile(record.file), name: record.name, mimeType: record.mimeType }; } });
  try { await runtime.startPlatforms(); await work(runtime, methods, callback => { onSend = callback; }); }
  finally { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
async function pause(runtime: PriestessRuntime) {
  const message = MessageEventSchema.parse({ platform: 'tg', platformType: 'telegram', sessionId: 'chat', sessionType: 'private', senderId: 'alice', messageId: crypto.randomUUID(), timestamp: Date.now(), botId: '123', parts: [{ type: 'text', text: 'attach note' }] });
  const run = runtime.submit(message); await runtime.idle(); const event = runtime.detail(run.id).events.find(event => event.type === 'paused'); assert.ok(event && event.type === 'paused'); return { run, approvalId: event.approvalId };
}
void test('approval finalizes after text and attachment delivery and cannot repeat approved side effects', async () => fixture(async (runtime, methods) => {
  const { run, approvalId } = await pause(runtime); runtime.approve(run.id, approvalId, true); await runtime.idle();
  assert.deepEqual(methods, ['sendMessage','sendDocument']); assert.equal(runtime.detail(run.id).run.status, 'completed');
  assert.equal(runtime.detail(run.id).events.filter(event => event.type === 'completed').length, 1); assert.equal(runtime.detail(run.id).events.filter(event => event.type === 'tool' && event.status === 'started').length, 1);
  const conversation = runtime.management.conversations()[0]; assert.ok(conversation); assert.equal(runtime.management.detail(conversation.id).entries.at(-1)?.parts.length, 2);
  assert.throws(() => runtime.approve(run.id, approvalId, true), /already resumed/);
}));
void test('uncertain resumed delivery persists failure and stops before sending more parts', async () => fixture(async (runtime, methods) => {
  const { run, approvalId } = await pause(runtime); runtime.approve(run.id, approvalId, true); await runtime.idle();
  assert.deepEqual(methods, ['sendMessage']); assert.equal(runtime.detail(run.id).run.status, 'failed'); assert.equal(runtime.detail(run.id).events.some(event => event.type === 'completed'), false); assert.equal(runtime.store.list('delivery', DeliveryRecordSchema).at(-1)?.status, 'uncertain');
}, true));
void test('deleting a conversation during resumed SDK cleanup prevents late delivery and transcript resurrection', async () => fixture(async (runtime, methods) => {
  const { run, approvalId } = await pause(runtime); const entered = latch(); const release = latch(); const close = runtime.mcp.close.bind(runtime.mcp);
  runtime.mcp.close = async id => { await close(id); entered.release(); await release.promise; };
  runtime.approve(run.id, approvalId, true); await entered.promise;
  assert.equal(runtime.detail(run.id).events.some(event => event.type === 'completed'), false);
  const conversation = runtime.management.conversations()[0]; assert.ok(conversation); runtime.management.deleteConversation(conversation.id, conversation.revision, id => runtime.cancel(id)); release.release(); await runtime.idle();
  assert.deepEqual(methods, []); assert.equal(runtime.management.conversations().length, 0); assert.equal(runtime.detail(run.id).run.status, 'cancelled');
}));
void test('revocation after resumed text send prevents the remaining attachment effect', async () => fixture(async (runtime, methods, beforeSend) => {
  const { run, approvalId } = await pause(runtime); beforeSend(() => runtime.auth.replaceGrants([])); runtime.approve(run.id, approvalId, true); await runtime.idle();
  assert.deepEqual(methods, ['sendMessage']); assert.equal(runtime.detail(run.id).run.status, 'failed'); assert.equal(runtime.detail(run.id).events.some(event => event.type === 'completed'), false);
}));
