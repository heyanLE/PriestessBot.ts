import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Usage, protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import type { z } from 'zod';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { ConfigSnapshotSchema, JobsResponseSchema, KnowledgeDocumentSchema, MemoriesResponseSchema, MessageEventSchema, RunDetailSchema } from '../packages/contracts/src/index.js';

class JobModel implements Model {
  extractionCalls = 0;
  private extractionEntered: (() => void) | undefined;
  readonly extractionStarted = new Promise<void>(resolve => { this.extractionEntered = resolve; });
  releaseExtraction: (() => void) | undefined;
  constructor(readonly mode: 'complete' | 'pause' | 'hold_extraction') {}
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    assert.match(request.systemInstructions ?? '', /durable factual memories/); assert.deepEqual(request.tools, []); this.extractionCalls += 1; this.extractionEntered?.();
    if (this.mode === 'hold_extraction') await new Promise<void>((resolve, reject: (error: Error) => void) => { this.releaseExtraction = resolve; const abort = (): void => reject(new Error('Extraction aborted')); if (request.signal?.aborted) abort(); else request.signal?.addEventListener('abort', abort, { once: true }); });
    return { usage: new Usage({ inputTokens: 3, outputTokens: 3, totalTokens: 6 }), output: [protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ memories: [{ text: 'Prefers green tea', confidence: 0.9 }] }) }] })] };
  }
  async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve(); const output: unknown[] = this.mode === 'pause' ? [{ type: 'function_call', name: 'memory_save', callId: 'paused-save', arguments: JSON.stringify({ libraryId: 'default', text: 'Do not save after stop' }), status: 'completed' }] : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Acknowledged' }] }];
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'main-response', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output } });
  }
}
type Request = (route: string, method?: string, value?: unknown) => Promise<Response>;
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> { const value: unknown = await response.json(); return schema.parse(value); }
function message(text: string, sessionType: 'private' | 'group' = 'private') { return MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'chat', sessionType, senderId: 'alice', botId: 'bot', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text }, ...(sessionType === 'group' ? [{ type: 'mention', userId: 'bot' }] : [])] }); }
async function fixture(mode: JobModel['mode'], work: (runtime: PriestessRuntime, request: Request, model: JobModel) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'priestess-jobs-')); const base = defaultConfiguration();
  const config = { ...base, agents: base.agents.map(agent => ({ ...agent, memoryExtraction: { enabled: mode !== 'pause', libraryId: 'default' }, approvalTools: mode === 'pause' ? ['memory_save'] : [] })) };
  const model = new JobModel(mode); const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  const server = createRuntimeServer(runtime, { token: 'jobs-test-token', artifacts: join(directory, 'artifacts') });
  try {
    await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing address');
    const request: Request = (route, method = 'GET', value) => fetch(`http://127.0.0.1:${address.port}/api/ts/${route}`, { method, headers: { Authorization: 'Bearer jobs-test-token', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(5000) });
    await work(runtime, request, model);
  } finally { model.releaseExtraction?.(); await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}

void test('private completion runs bounded extraction and exposes memory and knowledge jobs through typed HTTP contracts', async () => fixture('complete', async (runtime, request, model) => {
  const initial = await parse(await request('chat', 'POST', { message: message('I prefer green tea') }), RunDetailSchema); await runtime.idle();
  const jobs = await parse(await request('jobs'), JobsResponseSchema); assert.equal(jobs.jobs.length, 1); assert.equal(jobs.jobs[0]?.runId, initial.run.id); assert.equal(jobs.jobs[0]?.kind, 'memory_extraction'); assert.equal(jobs.jobs[0]?.status, 'completed');
  const memories = await parse(await request('memory'), MemoriesResponseSchema); assert.equal(memories.memories.length, 1); assert.equal(memories.memories[0]?.scope, 'sender'); assert.equal(memories.memories[0]?.principal.sessionType, 'private'); assert.equal(model.extractionCalls, 1);
  await request('chat', 'POST', { message: message('Group says tea', 'group') }); await runtime.idle(); assert.equal(model.extractionCalls, 1);
  const document = await parse(await request('knowledge', 'POST', { libraryId: 'default', name: 'tea.md', mimeType: 'text/markdown', content: 'Green tea document.' }), KnowledgeDocumentSchema);
  const allJobs = await parse(await request('jobs'), JobsResponseSchema); assert.ok(allJobs.jobs.some(job => job.id === `knowledge:${document.id}` && job.kind === 'knowledge_import' && job.status === 'completed'));
}));
void test('configuration revocation while extraction waits prevents stale private-memory writes', async () => fixture('hold_extraction', async (runtime, request, model) => {
  await request('chat', 'POST', { message: message('I prefer green tea') }); await model.extractionStarted;
  const running = await parse(await request('jobs'), JobsResponseSchema); assert.equal(running.jobs[0]?.status, 'running');
  const snapshot = await parse(await request('config'), ConfigSnapshotSchema);
  const config = { ...snapshot.config, agents: snapshot.config.agents.map(agent => ({ ...agent, capabilities: agent.capabilities.filter(capability => capability !== 'memory.write') })) };
  assert.equal((await request('config', 'PUT', { expectedRevision: snapshot.revision, config })).status, 200);
  model.releaseExtraction?.(); await runtime.idle(); assert.equal(runtime.memory.list().length, 0);
  const failed = await parse(await request('jobs'), JobsResponseSchema); assert.ok(['failed', 'cancelled'].includes(failed.jobs[0]?.status ?? ''));
}));
void test('management cancel closes paused approval and prevents subsequent tool effects', async () => fixture('pause', async (runtime, request) => {
  const first = await parse(await request('chat', 'POST', { message: message('Save only with approval') }), RunDetailSchema); await runtime.idle();
  const paused = await parse(await request(`runs/${first.run.id}`), RunDetailSchema); const approval = paused.events.find(event => event.type === 'paused'); if (approval?.type !== 'paused') throw new Error('Missing pause');
  assert.equal((await request(`runs/${first.run.id}/cancel`, 'POST', {})).status, 200);
  assert.equal((await parse(await request(`runs/${first.run.id}`), RunDetailSchema)).run.status, 'cancelled');
  assert.notEqual((await request(`runs/${first.run.id}/approval`, 'POST', { approvalId: approval.approvalId, approved: true })).status, 202); await runtime.idle(); assert.equal(runtime.memory.list().length, 0);
}));
void test('sender stop command also invalidates durable paused input and cannot be approved afterward', async () => fixture('pause', async (runtime, request) => {
  const first = await parse(await request('chat', 'POST', { message: message('Save only with approval') }), RunDetailSchema); await runtime.idle();
  const paused = await parse(await request(`runs/${first.run.id}`), RunDetailSchema); const approval = paused.events.find(event => event.type === 'paused'); if (approval?.type !== 'paused') throw new Error('Missing pause');
  await request('chat', 'POST', { message: message('/stop') }); await runtime.idle();
  assert.equal((await parse(await request(`runs/${first.run.id}`), RunDetailSchema)).run.status, 'cancelled');
  assert.notEqual((await request(`runs/${first.run.id}/approval`, 'POST', { approvalId: approval.approvalId, approved: true })).status, 202); assert.equal(runtime.memory.list().length, 0);
}));
