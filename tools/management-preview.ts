import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Usage, protocol, type Model, type ModelResponse, type ModelRequest } from '@openai/agents';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import { MemoryRecordSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';

/** An isolated local UI test service: no IM accounts, provider calls or host workspaces. */
class PreviewModel implements Model {
  getResponse(request: ModelRequest): Promise<ModelResponse> { request.signal?.throwIfAborted(); return Promise.resolve({ usage: new Usage({ inputTokens: 20, outputTokens: 20, totalTokens: 40 }), output: [protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ merges: [{ sourceIds: ['qa-first', 'qa-second'], text: '用户偏好绿色主题。' }] }) }] })] }); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve(); request.signal?.throwIfAborted();
    yield { type: 'response_started' };
    yield { type: 'output_text_delta', delta: '隔离测试回复。' };
    yield { type: 'response_done', response: { id: 'preview-response', usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, output: [protocol.AssistantMessageItem.parse({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '隔离测试回复。' }] })] } };
  }
}
const directory = await mkdtemp(path.join(tmpdir(), 'priestess-management-preview-')); const root = path.join(directory, 'workspace'); await mkdir(root); await writeFile(path.join(root, 'hello.txt'), '工作目录预览\n', { mode: 0o600 });
const config = RuntimeConfigSchema.parse({ ...defaultConfiguration(), executionEnvironments: [{ id: 'preview-workspace', type: 'local', root }] });
const runtime = new PriestessRuntime({ database: path.join(directory, 'runtime.sqlite'), config, model: new PreviewModel() });
for (const id of ['qa-first', 'qa-second']) runtime.store.put('memories', id, MemoryRecordSchema.parse({ id, agentId: 'assistant', libraryId: 'default', scope: 'sender', principal: { platform: 'dashboard', sessionType: 'private', sessionId: 'qa', senderId: 'qa' }, text: id === 'qa-first' ? '偏好绿色。' : '喜欢绿色主题。', source: `preview:${id}`, confidence: 0.9, createdAt: Date.now(), updatedAt: Date.now() }));
const server = createRuntimeServer(runtime, { token: 'local-preview-token', artifacts: path.join(directory, 'artifacts'), dashboard: path.resolve('dashboard/dist') }); await runtime.startPlatforms();
server.listen(8083, '127.0.0.1', () => { process.stdout.write(JSON.stringify({ url: 'http://127.0.0.1:8083', directory, token: 'local-preview-token' }) + '\n'); });
const stop = (): void => { server.close(); server.closeAllConnections(); void runtime.stop(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
