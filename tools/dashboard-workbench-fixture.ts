import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { RuntimeConfigSchema, MessageEventSchema, MemoryRecordSchema } from '../packages/contracts/src/index.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';

/** Isolated local UI fixture. This model never calls a provider or executes tools. */
class FixtureModel implements Model {
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Use the streaming fixture model')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const inputText = JSON.stringify(request.input);
    if (inputText.includes('[audit fixture]') && !inputText.includes('function_call_result')) {
      await setTimeout(50);
      yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `fixture-tool-${Date.now()}`, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: [{ type: 'function_call', name: 'memory_recall', arguments: JSON.stringify({ query: '本地测试' }), callId: `fixture-call-${Date.now()}`, status: 'completed' }] } });
      return;
    }
    const text = '本地测试模型已收到请求。此结果仅用于验证 Dashboard 操作流程；未访问真实模型或 IM。';
    for (const delta of ['本地测试模型已收到请求。', '此结果仅用于验证 Dashboard 操作流程；', '未访问真实模型或 IM。']) { await setTimeout(80); yield { type: 'output_text_delta', delta }; }
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: `fixture-${Date.now()}`, usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] } });
  }
}

const port = z.coerce.number().int().min(1024).max(65535).parse(process.env['DASHBOARD_FIXTURE_PORT'] ?? '4190');
const directory = await mkdtemp(path.join(tmpdir(), 'priestess-dashboard-fixture-'));
const dashboard = path.resolve('dashboard/dist');
const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1,
  connections: [{ id: 'fixture-model', apiKeyEnv: 'FIXTURE_ONLY_KEY', protocol: 'responses' }],
  agents: [
    { id: 'assistant', displayName: '普瑞赛斯', model: 'fixture-model', connectionId: 'fixture-model', instructions: '使用简洁中文提供帮助。此环境仅用于本地流程验证。', capabilities: ['chat', 'knowledge.read', 'memory.read'], resources: { memoryLibraries: ['default'], knowledgeLibraries: ['guide'], tools: ['memory_recall', 'knowledge_search', 'get_group_message_history'] }, budget: { tokenLimitMode: 'context' } },
    { id: 'researcher', displayName: '资料助理', model: 'fixture-model', connectionId: 'fixture-model', instructions: '整理来源并说明结论。', capabilities: ['chat', 'knowledge.read'], resources: { knowledgeLibraries: ['guide'], tools: ['knowledge_search'] } },
  ],
  platforms: [
    { id: 'napcat-fixture', type: 'napcat', displayName: 'QQ · 本地测试', websocketUrl: 'ws://127.0.0.1:1', enabled: false },
    { id: 'telegram-fixture', type: 'telegram', displayName: 'Telegram · 本地测试', tokenEnv: 'FIXTURE_TELEGRAM_TOKEN', enabled: false },
    { id: 'weixin-fixture', type: 'weixin', displayName: '微信 · 本地测试', enabled: false },
  ], memoryLibraries: [{ id: 'default', displayName: '个人记忆' }], knowledgeLibraries: [{ id: 'guide', displayName: '使用资料' }],
  flow: { routing: { defaultAgentId: 'assistant', rules: [] } },
});
const runtime = new PriestessRuntime({ database: path.join(directory, 'runtime.sqlite'), config, model: new FixtureModel(), secret: () => undefined });
const originalPublish = runtime.publish.bind(runtime);
runtime.publish = (candidate, revision, commitRelated) => {
  if (candidate.platforms.some(platform => platform.enabled) || candidate.mcpServers.length || candidate.executionEnvironments.length) return Promise.reject(new Error('隔离测试环境不允许启用 IM、MCP 或执行环境；请保持禁用。'));
  return originalPublish(candidate, revision, commitRelated);
};
const persona = runtime.management.savePersona({ name: '普瑞赛斯', instructions: '你是普瑞赛斯。表达沉稳、简洁，完成操作后按实际结果汇报。', exampleDialogs: [{ role: 'user', content: '帮我整理这个任务。', scene: '任务梳理' }, { role: 'assistant', content: '先确认目标，再列出必要步骤。完成后我会说明结果和未解决的问题。' }] });
runtime.management.savePersona({ name: '资料助理', instructions: '核对来源，区分已知事实和不确定信息。', exampleDialogs: [{ role: 'user', content: '这些资料有什么差别？' }, { role: 'assistant', content: '我会按来源、时间和关键结论对照。' }] });
runtime.management.bindPersona('assistant', persona.id, 0);
runtime.store.put('memories', 'fixture-memory', MemoryRecordSchema.parse({ id: 'fixture-memory', libraryId: 'default', agentId: 'assistant', principal: { platform: 'dashboard', senderId: 'dashboard-user', sessionId: 'fixture', sessionType: 'private' }, scope: 'sender', text: '此记录是本地 Dashboard 测试数据，不来自生产会话。', source: 'local-fixture', confidence: 1, createdAt: Date.now(), updatedAt: Date.now() }));
await runtime.startPlatforms();
const conversation = runtime.management.createWebConversation('assistant', '本地流程测试');
if (conversation.lastMessage) { runtime.submitDashboard(MessageEventSchema.parse({ ...conversation.lastMessage, messageId: 'fixture-first-message', timestamp: Date.now(), parts: [{ type: 'text', text: '确认本地测试环境。' }] }), 'assistant'); await runtime.idle(); }
// Real local pipeline with fixture events: no IM adapter or external model is used.
const fixtureGroup = { platform: 'napcat-fixture', platformType: 'napcat', sessionType: 'group', sessionId: 'fixture-qq-group', sessionName: 'NapCat 验收群', senderId: 'fixture-sender', senderName: '本地验收用户', botId: 'fixture-bot', timestamp: Date.now() };
runtime.submit(MessageEventSchema.parse({ ...fixtureGroup, messageId: 'fixture-untriggered', parts: [{ type: 'text', text: '这条未提及机器人的消息只应生成路由记录。' }] }));
runtime.submit(MessageEventSchema.parse({ ...fixtureGroup, messageId: 'fixture-agent', parts: [{ type: 'mention', userId: 'fixture-bot' }, { type: 'text', text: '[audit fixture] 读取本地测试记忆并回复。' }] }));
await runtime.idle();
runtime.submit(MessageEventSchema.parse({ ...fixtureGroup, messageId: 'fixture-command', parts: [{ type: 'text', text: '/help' }] }));
await runtime.idle();
const server = createRuntimeServer(runtime, { token: 'fixture-only-token', artifacts: path.join(directory, 'artifacts'), dashboard });
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}`, token: 'fixture-only-token', pid: process.pid, database: path.join(directory, 'runtime.sqlite'), dashboard, model: 'in-process FixtureModel; no provider or IM calls', platforms: 'disabled; enabling blocked' }));
let stopping = false;
async function stop(): Promise<void> { if (stopping) return; stopping = true; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
