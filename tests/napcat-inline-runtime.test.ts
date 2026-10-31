import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { MarkdownSettingsSchema } from '../packages/contracts/src/plugins/markdown.js';
import { MarkdownPlugin } from '../packages/adapters/src/plugins/markdown.js';

const answer = '这是这次生成的图片。'.repeat(12);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64');
interface ApiCall { readonly action: string; readonly params: Record<string, unknown>; }
type ReplyFormat = 'legacy_tail' | 'inline' | 'forward_inline' | 'rendered';
interface ReplyCase { kind: 'group' | 'private'; approval: boolean; format: ReplyFormat; }
const SegmentSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('text'), data: z.object({ text: z.string() }) }), z.object({ type: z.literal('image'), data: z.object({ file: z.string() }) })]);
function deliveredParts(call: ApiCall | undefined): z.infer<typeof SegmentSchema>[] {
  assert.ok(call);
  if (call.action.endsWith('_forward_msg')) { const messages = z.array(z.object({ type: z.literal('node'), data: z.object({ content: z.array(SegmentSchema) }) })).length(1).parse(call.params['messages']); const node = messages[0]; assert.ok(node); return node.data.content; }
  return z.array(SegmentSchema).parse(call.params['message']);
}

class AttachmentModel implements Model {
  calls = 0;
  finalText = answer;
  constructor(readonly format: ReplyFormat) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('The fixture exercises streaming Agents SDK execution')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve();
    const index = this.calls++;
    if (index === 0) {
      yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'attach-image', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ type: 'function_call', name: 'attach_file', callId: 'attach-once', arguments: JSON.stringify({ path: 'image.png', name: 'image.png', mimeType: 'image/png' }), status: 'completed' }] } });
      return;
    }
    assert.equal(index, 1, 'The attachment must execute only once');
    if (this.format !== 'legacy_tail') {
      assert.ok(typeof request.input !== 'string', 'The SDK must supply the attach_file result');
      const result = request.input.find(item => item.type === 'function_call_result' && item.name === 'attach_file'); assert.ok(result && result.type === 'function_call_result');
      const raw = z.union([z.string(), z.object({ type: z.literal('text'), text: z.string() })]).parse(result.output); const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.text);
      const attachment = z.object({ id: z.string(), inlineMarkdown: z.string() }).parse(parsed); assert.equal(attachment.inlineMarkdown, `![图片](artifact:${attachment.id})`);
      this.finalText = this.format === 'rendered'
        ? `**前文**${attachment.inlineMarkdown}表格前文。\n\n| A | B |\n| --- | --- |\n| x | y |\n\n公式前文。\n\n$$x^2$$\n\n**后文**`
        : `**${this.format === 'forward_inline' ? '前文'.repeat(800) : '前文'}**${attachment.inlineMarkdown}**后文**`;
    }
    yield { type: 'output_text_delta', delta: this.finalText.slice(0, 5) };
    yield { type: 'output_text_delta', delta: this.finalText.slice(5) };
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'final-answer', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: this.finalText }] }] } });
  }
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error('NapCat inline reply fixture did not become ready');
}

const cases: ReplyCase[] = [];
for (const kind of ['group', 'private'] satisfies ReplyCase['kind'][]) for (const approval of [false, true]) for (const format of ['legacy_tail', 'inline'] satisfies ReplyFormat[]) cases.push({ kind, approval, format });
cases.push({ kind: 'group', approval: false, format: 'forward_inline' }, { kind: 'private', approval: true, format: 'forward_inline' }, { kind: 'group', approval: false, format: 'rendered' }, { kind: 'private', approval: true, format: 'rendered' });
for (const { kind, approval, format } of cases) {
  void test(`NapCat ${approval ? 'approval resume' : 'ordinary run'} delivers ${kind} ${format} images in source order`, { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'napcat-inline-runtime-'));
    const calls: ApiCall[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(z.string().parse(chunk)));
        const action = request.url?.slice(1) ?? '';
        const params = z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        calls.push({ action, params });
        const data = action === 'get_login_info' ? { user_id: 900, nickname: 'Fixture bot' } : { message_id: calls.length };
        response.end(JSON.stringify({ status: 'ok', retcode: 0, data }));
      })().catch(() => { response.statusCode = 500; response.end(); });
    });
    const websocket = new WebSocketServer({ server });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const agent = AgentDefinitionSchema.parse({ id: 'a', displayName: 'Fixture', capabilities: ['chat', 'files.read'], resources: { executionEnvironment: 'local', tools: ['attach_file'] }, approvalTools: approval ? ['attach_file'] : [] });
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], executionEnvironments: [{ id: 'local', type: 'local', root: directory }], grants: [{ platform: 'qq', senderId: '42', maximumState: 'operator', defaultState: 'operator', capabilities: agent.capabilities, resources: agent.resources }], platforms: [{ id: 'qq', type: 'napcat', enabled: true, websocketUrl: `ws://127.0.0.1:${address.port}`, apiBase: `http://127.0.0.1:${address.port}`, forwardThreshold: 1500 }], flow: { routing: { defaultAgentId: 'a', rules: [] }, acceptance: { groupPolicy: 'all' }, delivery: { fallback: 'chunks', chunkChars: 100 } } });
    const chatId = kind === 'group' ? '81' : '42';
    const workspace = join(directory, createHash('sha256').update(JSON.stringify(['qq', kind, chatId, 'a', 0])).digest('hex'));
    await mkdir(workspace);
    await writeFile(join(workspace, 'image.png'), png);
    const model = new AttachmentModel(format);
    const runtime = new PriestessRuntime({ database: ':memory:', config, model, secret: () => undefined });
    const renderedSources: string[] = [];
    if (format !== 'legacy_tail') runtime.plugins.settings.update('markdown_killer', { enabled: true, globalCleanup: true }, 0);
    if (format === 'rendered') {
      const plugin = new MarkdownPlugin(() => MarkdownSettingsSchema.parse(runtime.plugins.settings.get('markdown_killer').settings), text => { renderedSources.push(text); return Promise.resolve(png); });
      runtime.plugins.markdown.decorate = plugin.decorate.bind(plugin);
    }
    runtime.setArtifactDirectory(join(directory, 'artifacts'));
    runtime.setMediaResolvers({ resolveMedia: async part => {
      assert.ok(part.url.startsWith('artifact:'), 'The runtime must resolve its stored attachment');
      const record = runtime.store.get('artifacts', part.url.slice(9), z.object({ file: z.string(), name: z.string(), mimeType: z.string() }));
      assert.ok(record);
      return { bytes: await readFile(record.file), name: record.name, mimeType: record.mimeType };
    } });
    try {
      await runtime.startPlatforms();
      await waitFor(() => runtime.platformStatus().find(state => state.status === 'connected'));
      const socket = websocket.clients.values().next().value;
      assert.ok(socket);
      socket.send(JSON.stringify({ post_type: 'message', message_type: kind, message_id: 1, user_id: 42, ...(kind === 'group' ? { group_id: 81 } : {}), self_id: 900, time: Math.floor(Date.now() / 1000), sender: { nickname: 'Alice' }, message: [{ type: 'text', data: { text: '请附上生成的图片' } }] }));
      const run = await waitFor(() => runtime.store.runs()[0]);
      await runtime.idle();
      const sent = (): ApiCall[] => calls.filter(call => call.action.startsWith('send_') || call.action.startsWith('upload_'));
      if (approval) {
        const paused = runtime.detail(run.id).events.find(event => event.type === 'paused');
        assert.ok(paused && paused.type === 'paused');
        assert.deepEqual(sent(), [], 'Approval must finish before any part is delivered');
        runtime.approve(run.id, paused.approvalId, true);
        await runtime.idle();
        assert.throws(() => runtime.approve(run.id, paused.approvalId, true), /already resumed/);
      }
      assert.equal(runtime.detail(run.id).run.status, 'completed');
      assert.deepEqual(sent().map(call => call.action), [`send_${kind}_${format === 'forward_inline' ? 'forward_msg' : 'msg'}`]);
      assert.equal(sent()[0]?.params[kind === 'group' ? 'group_id' : 'user_id'], chatId);
      const delivered = deliveredParts(sent()[0]);
      if (format === 'legacy_tail') assert.deepEqual(delivered, [{ type: 'text', data: { text: answer } }, { type: 'image', data: { file: `base64://${png.toString('base64')}` } }]);
      else if (format === 'rendered') {
        assert.deepEqual(delivered.map(part => part.type), ['text', 'image', 'text', 'image', 'text', 'image', 'text']);
        assert.deepEqual(delivered.filter(part => part.type === 'text').map(part => part.data.text.trim()), ['前文', '表格前文。', '公式前文。', '后文']);
        assert.equal(renderedSources.length, 2); assert.match(renderedSources[0] ?? '', /\| A \| B \|/); assert.match(renderedSources[1] ?? '', /\$\$x\^2\$\$/);
      } else assert.deepEqual(delivered, [{ type: 'text', data: { text: format === 'forward_inline' ? '前文'.repeat(800) : '前文' } }, { type: 'image', data: { file: `base64://${png.toString('base64')}` } }, { type: 'text', data: { text: '后文' } }]);
      const detail = runtime.detail(run.id);
      assert.equal(detail.events.filter(event => event.type === 'completed').length, 1);
      assert.equal(detail.events.filter(event => event.type === 'tool' && event.name === 'attach_file' && event.status === 'started').length, 1);
      assert.equal(model.calls, 2);
      const conversation = runtime.management.conversations()[0];
      assert.ok(conversation);
      const transcript = runtime.management.detail(conversation.id).entries.at(-1); assert.ok(transcript); assert.equal(transcript.role, 'assistant');
      assert.deepEqual(transcript.parts.map(part => part.type), delivered.map(part => part.type));
      assert.deepEqual(transcript.parts.filter(part => part.type === 'text').map(part => part.text), delivered.filter(part => part.type === 'text').map(part => part.data.text));
      const imageIds = transcript.parts.filter(part => part.type === 'image').map(part => part.artifactId); assert.equal(imageIds.length, format === 'rendered' ? 3 : 1); assert.equal(new Set(imageIds).size, imageIds.length, 'Each attached/rendered image is archived once');
      assert.ok(transcript.parts.filter(part => part.type === 'image').every(part => part.url.startsWith('artifact:')));
    } finally {
      await runtime.stop();
      for (const client of websocket.clients) client.terminate();
      await new Promise<void>((resolve, reject) => websocket.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
