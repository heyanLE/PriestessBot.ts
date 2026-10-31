import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { MemoryRecordSchema, MessageEventSchema, RuntimeConfigSchema, type MessageEvent } from '../packages/contracts/src/index.js';
import { GROUP_HISTORY_TOOL, GroupHistorySearchResultSchema, type GroupHistorySearchResult } from '../packages/contracts/src/group-history-search.js';
import { conversationKey } from '../packages/core/src/authorization.js';
import type { PlatformAdapter } from '../packages/adapters/src/platforms/types.js';

class HistoryModel implements Model {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: (request: ModelRequest, index: number) => Promise<protocol.StreamEvent>) {}
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streaming')); }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const index = this.requests.length;
    this.requests.push(request);
    yield await this.script(request, index);
  }
}
function done(text: string): protocol.StreamEvent {
  return protocol.StreamEvent.parse({ type: 'response_done', response: { id: crypto.randomUUID(), usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] } });
}
function call(name = GROUP_HISTORY_TOOL, args: unknown = { limit: 20, before_id: null, keyword: 'needle', sender: null }): protocol.StreamEvent {
  return protocol.StreamEvent.parse({ type: 'response_done', response: { id: crypto.randomUUID(), usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }, output: [{ type: 'function_call', name, arguments: JSON.stringify(args), callId: crypto.randomUUID(), status: 'completed' }] } });
}
function message(senderId: string, text: string, options: { group?: string; private?: boolean; attention?: boolean } = {}): MessageEvent {
  return MessageEventSchema.parse({ platform: 'history-test', platformType: 'napcat', sessionId: options.group ?? 'group-a', sessionType: options.private ? 'private' : 'group', senderId, senderName: senderId, messageId: crypto.randomUUID(), timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text }, ...(options.attention === false || options.private ? [] : [{ type: 'mention', userId: 'bot' }])] });
}
function adapter(): PlatformAdapter {
  return { id: 'history-test', capabilities: { edit: false, images: false, files: false, groups: true, audio: false }, start: () => Promise.resolve(), stop: () => Promise.resolve(), send: () => Promise.resolve({ status: 'confirmed', messageIds: [crypto.randomUUID()] }), edit: () => Promise.reject(new Error('Unused')), downloadMedia: () => Promise.reject(new Error('Unused')) };
}
function configuration() {
  const base = defaultConfiguration();
  return RuntimeConfigSchema.parse({ ...base, agents: base.agents.map(agent => ({ ...agent, resources: { ...agent.resources, tools: [...new Set([...agent.resources.tools, GROUP_HISTORY_TOOL])] } })) });
}
function historyResult(request: ModelRequest | undefined): GroupHistorySearchResult {
  assert.ok(request, 'Expected a model request after the history tool');
  assert.ok(Array.isArray(request.input), 'Expected structured SDK model input');
  const result = request.input.find(item => item.type === 'function_call_result' && item.name === GROUP_HISTORY_TOOL);
  assert.ok(result && result.type === 'function_call_result', 'Expected a real SDK function_call_result');
  const output = z.union([z.string(), z.object({ type: z.literal('text'), text: z.string() })]).parse(result.output);
  const parsed: unknown = JSON.parse(typeof output === 'string' ? output : output.text);
  return GroupHistorySearchResultSchema.parse(parsed);
}
function hasHistoryTool(request: ModelRequest | undefined): boolean {
  assert.ok(request);
  return request.tools.some(tool => tool.type === 'function' && tool.name === GROUP_HISTORY_TOOL);
}

void test('SDK history search finds unmentioned public chatter and confirmed bot replies without private data or future ingress', async () => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const model = new HistoryModel(async (_request, index) => {
    if (index === 0) return call('memory_recall', { query: 'needle' });
    if (index === 1) return done('needle PUBLIC_BOT_REPLY');
    if (index === 2) return done('needle PRIVATE_REPLY');
    if (index === 3) { entered(); await gate; return call(); }
    return done('Search complete');
  });
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  const transport = adapter();
  try {
    runtime.store.put('memories', 'private-tool', MemoryRecordSchema.parse({ id: 'private-tool', libraryId: 'default', agentId: 'assistant', principal: { platform: 'history-test', sessionType: 'group', sessionId: 'group-a', senderId: 'alice' }, scope: 'sender', text: 'needle PRIVATE_TOOL_SECRET', source: 'fixture', confidence: 1, createdAt: 1, updatedAt: 1 }));
    const chatter = message('carol', 'needle PUBLIC_UNMENTIONED', { attention: false });
    runtime.submit(chatter, transport);
    assert.equal(model.requests.length, 0, 'Unmentioned chatter must be recorded without invoking the model');
    const first = runtime.submit(message('alice', 'Recall my private memory'), transport);
    await runtime.idle();
    assert.equal(runtime.detail(first.id).run.status, 'completed');
    assert.match(JSON.stringify(model.requests[1]?.input), /PRIVATE_TOOL_SECRET/, 'The fixture must exercise a real private tool result');
    runtime.submit(message('alice', 'needle PRIVATE_CHAT', { private: true }), transport);
    await runtime.idle();
    assert.equal(hasHistoryTool(model.requests[2]), false, 'Private chats cannot receive the group history tool');
    runtime.submit(message('outsider', 'needle OTHER_GROUP', { group: 'group-b', attention: false }), transport);
    const searchMessage = message('bob', 'Search prior group messages');
    runtime.submit({ ...message('carol', 'needle SAME_TIMESTAMP_BEFORE', { attention: false }), timestamp: searchMessage.timestamp }, transport);
    const search = runtime.submit(searchMessage, transport);
    await started;
    runtime.submit({ ...message('carol', 'needle FUTURE_CHATTER', { attention: false }), timestamp: searchMessage.timestamp }, transport);
    release();
    await runtime.idle();
    assert.equal(runtime.detail(search.id).run.status, 'completed');
    assert.equal(hasHistoryTool(model.requests[3]), true);
    const result = historyResult(model.requests[4]);
    assert.deepEqual(result.messages.map(item => item.text), ['needle PUBLIC_UNMENTIONED', 'needle PUBLIC_BOT_REPLY', 'needle SAME_TIMESTAMP_BEFORE']);
    assert.equal(result.messages[0]?.messageId, chatter.messageId);
    assert.equal(result.messages[0]?.senderId, 'carol');
    assert.equal(result.messages[1]?.role, 'bot');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOOL_SECRET|PRIVATE_CHAT|PRIVATE_REPLY|OTHER_GROUP|FUTURE_CHATTER/);
  } finally { release(); await runtime.stop(); }
});

void test('SDK history searches cannot resurrect messages across reset or conversation deletion', async () => {
  const model = new HistoryModel((_request, index) => Promise.resolve(index % 2 === 0 ? call() : done('Search complete')));
  const runtime = new PriestessRuntime({ database: ':memory:', config: configuration(), model });
  const transport = adapter();
  const first = message('alice', 'Search the old generation');
  try {
    runtime.submit(message('carol', 'needle BEFORE_RESET', { attention: false }), transport);
    runtime.submit(first, transport);
    await runtime.idle();
    assert.match(JSON.stringify(historyResult(model.requests[1]).messages), /BEFORE_RESET/);

    runtime.store.reset(conversationKey(first, 'assistant'));
    runtime.submit(message('bob', 'Search after reset'), transport);
    await runtime.idle();
    assert.deepEqual(historyResult(model.requests[3]).messages, []);

    runtime.submit(message('carol', 'needle BEFORE_DELETE', { attention: false }), transport);
    runtime.submit(message('bob', 'Search the new generation'), transport);
    await runtime.idle();
    assert.match(JSON.stringify(historyResult(model.requests[5]).messages), /BEFORE_DELETE/);
    const active = runtime.management.conversations({ archived: 'all' }).find(conversation => conversation.platform === first.platform && conversation.sessionId === first.sessionId && conversation.generation === 1);
    assert.ok(active);
    runtime.management.deleteConversation(active.id, active.revision, id => runtime.cancel(id));
    runtime.submit(message('bob', 'Search after deletion'), transport);
    await runtime.idle();
    assert.deepEqual(historyResult(model.requests[7]).messages, []);
    assert.equal(model.requests.length, 8);
  } finally { await runtime.stop(); }
});
