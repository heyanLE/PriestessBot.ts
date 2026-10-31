import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RunContext as SdkContext, protocol, type Model, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { McpConnections } from '../packages/adapters/src/agents/mcp.js';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunEvent, type RuntimeConfig } from '../packages/contracts/src/index.js';
import { AuthorizationService, RuntimeStore } from '../packages/core/src/index.js';

async function fixture(work: (mcp: McpConnections, input: EngineInput, auth: AuthorizationService, controller: AbortController, counts: { echo: number; slowCancelled: boolean }, state: { store: RuntimeStore; config: RuntimeConfig }) => Promise<void>): Promise<void> {
  const counts = { echo: 0, slowCancelled: false };
  const service = new McpServer({ name: 'fixture', version: '1.0.0' });
  service.registerTool('echo', { description: 'Echo a message.', inputSchema: { text: z.string() } }, args => { counts.echo += 1; return { content: [{ type: 'text', text: args.text }] }; });
  service.registerTool('image', { description: 'Return a small image.', inputSchema: {} }, () => ({ content: [{ type: 'text', text: 'A test image' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=' }] }));
  service.registerTool('slow', { description: 'Wait until cancelled.', inputSchema: {} }, (_args, extra) => new Promise(resolve => {
    const abort = (): void => { counts.slowCancelled = true; resolve({ content: [{ type: 'text', text: 'Cancelled' }] }); };
    if (extra.signal.aborted) abort(); else extra.signal.addEventListener('abort', abort, { once: true });
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true });
  await service.connect(transport);
  const server = createServer((request, response) => { void transport.handleRequest(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); }); });
  const store = new RuntimeStore(':memory:'); let connections: McpConnections | undefined;
  try {
    await new Promise<void>((resolve, reject: (error: Error) => void) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing MCP server address');
    const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'MCP Agent', capabilities: ['chat', 'external.write'], resources: { mcpServers: ['fixture'], tools: ['mcp_fixture__echo', 'mcp_fixture__image', 'mcp_fixture__slow'] } });
    const message = MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: 'chat', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'msg', timestamp: 1, parts: [{ type: 'text', text: 'Use MCP' }] });
    const principal = { platform: message.platform, sessionId: message.sessionId, senderId: message.senderId };
    const grant = GrantSchema.parse({ ...principal, maximumState: 'senior_operator', defaultState: 'senior_operator', capabilities: agent.capabilities, resources: agent.resources });
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], grants: [grant], mcpServers: [{ id: 'fixture', transport: 'streamable_http', url: `http://127.0.0.1:${address.port}/mcp` }], flow: { routing: { defaultAgentId: 'agent', rules: [] } } });
    const auth = new AuthorizationService([grant], store); const controller = new AbortController();
    const context = { runId: RunIdSchema.parse('mcp-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: controller.signal, budget: agent.budget, depth: 0 };
    const input: EngineInput = { agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 'session' } };
    connections = new McpConnections(() => config, auth, store, () => undefined);
    await work(connections, input, auth, controller, counts, { store, config });
  } finally { await connections?.stop(); await service.close(); await transport.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
}
function detail(name: string, callId: string, args: unknown) { return { toolCall: protocol.FunctionCallItem.parse({ type: 'function_call', name, callId, arguments: JSON.stringify(args) }) }; }

void test('MCP real HTTP transport validates and filters catalog, forwards structured text/image and rejects duplicate calls', async () => fixture(async (connections, input, _auth, _controller, counts) => {
  const events: RunEvent[] = [];
  const tools = await connections.tools(input, event => events.push(event));
  assert.deepEqual(tools.map(entry => entry.type === 'function' ? entry.name : entry.type).sort(), ['mcp_fixture__echo', 'mcp_fixture__image', 'mcp_fixture__slow']);
  const echo = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__echo'); const image = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__image');
  if (echo?.type !== 'function' || image?.type !== 'function') throw new Error('Expected MCP functions');
  const sdk = new SdkContext<SdkLocalContext>({ runId: input.context.runId });
  const result: unknown = await echo.invoke(sdk, '{"text":"hello MCP"}', detail(echo.name, 'call-1', { text: 'hello MCP' }));
  assert.match(JSON.stringify(result), /hello MCP/); assert.equal(counts.echo, 1);
  await assert.rejects(echo.invoke(sdk, '{"text":"duplicate"}', detail(echo.name, 'call-1', { text: 'duplicate' })), /Duplicate/); assert.equal(counts.echo, 1);
  const visual: unknown = await image.invoke(sdk, '{}', detail(image.name, 'image-1', {}));
  assert.match(JSON.stringify(visual), /input_image|image/); assert.match(JSON.stringify(visual), /image\/png/);
  assert.equal(events.filter(event => event.type === 'tool' && event.status === 'completed').length, 2);
}));
void test('MCP tool execution rechecks trusted run identity and revoked authorization', async () => fixture(async (connections, input, auth, _controller, counts) => {
  const tools = await connections.tools(input, () => undefined); const echo = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__echo');
  if (echo?.type !== 'function') throw new Error('Expected echo');
  await assert.rejects(echo.invoke(new SdkContext<SdkLocalContext>({ runId: 'forged' }), '{"text":"bad"}', detail(echo.name, 'forged', {})), /context mismatch/);
  auth.replaceGrants([]); await assert.rejects(echo.invoke(new SdkContext<SdkLocalContext>({ runId: input.context.runId }), '{"text":"bad"}', detail(echo.name, 'revoked', {})), /Authorization changed/); assert.equal(counts.echo, 0);
}));
void test('MCP call cancellation reaches the real transport and never reports completed output', async () => fixture(async (connections, input, _auth, controller, counts) => {
  const events: RunEvent[] = []; const tools = await connections.tools(input, event => events.push(event)); const slow = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__slow');
  if (slow?.type !== 'function') throw new Error('Expected slow');
  const pending = slow.invoke(new SdkContext<SdkLocalContext>({ runId: input.context.runId }), '{}', detail(slow.name, 'slow-1', {}));
  const rejection = assert.rejects(pending, /failed|revoked|cancel/i);
  await new Promise<void>(resolve => setTimeout(resolve, 30)); controller.abort(); await rejection;
  for (let attempts = 0; attempts < 50 && !counts.slowCancelled; attempts += 1) await new Promise<void>(resolve => setTimeout(resolve, 10));
  assert.equal(counts.slowCancelled, true); assert.equal(events.some(event => event.type === 'tool' && event.status === 'completed'), false);
}));

void test('MCP Agent approval selection applies only to matching tools and never bypasses live authorization', async () => fixture(async (connections, input, auth, _controller, counts) => {
  input.agent.approvalTools = ['mcp_fixture__echo'];
  const tools = await connections.tools(input, () => undefined);
  const echo = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__echo');
  const image = tools.find(entry => entry.type === 'function' && entry.name === 'mcp_fixture__image');
  if (echo?.type !== 'function' || image?.type !== 'function') throw new Error('Expected MCP functions');
  const sdk = new SdkContext<SdkLocalContext>({ runId: input.context.runId });
  assert.equal(await echo.needsApproval(sdk, { text: 'review first' }, 'reviewed-call'), true);
  assert.equal(await image.needsApproval(sdk, {}, 'unlisted-call'), false);
  assert.equal(counts.echo, 0);
  auth.replaceGrants([]);
  await assert.rejects(echo.invoke(sdk, '{"text":"must not execute"}', detail(echo.name, 'revoked-approved-call', { text: 'must not execute' })), /Authorization changed/);
  assert.equal(counts.echo, 0);
}));

class McpApprovalModel implements Model {
  getResponse(): Promise<ModelResponse> { return Promise.reject(new Error('Expected streaming model')); }
  async *getStreamedResponse(): AsyncIterable<protocol.StreamEvent> {
    await Promise.resolve();
    yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: 'mcp-approval-response', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, output: [{ type: 'function_call', name: 'mcp_fixture__echo', callId: 'mcp-pause', arguments: '{"text":"review first"}', status: 'completed' }] } });
  }
}
void test('real SDK pauses a selected MCP call before the MCP server executes it', async () => fixture(async (connections, input, auth, _controller, counts, state) => {
  input.agent.approvalTools = ['mcp_fixture__echo'];
  const events: RunEvent[] = [];
  const engine = new AgentsSdkEngine({ store: state.store, config: () => state.config, secret: () => undefined, model: new McpApprovalModel(), assertCurrent: current => auth.assert(current.context, 'chat', current.agent), tools: (current, emit) => connections.tools(current, emit) });
  const result = await engine.run(input, event => events.push(event));
  assert.equal(result.status, 'paused');
  assert.equal(counts.echo, 0);
  assert.ok(events.some(event => event.type === 'paused' && event.tools.includes('mcp_fixture__echo')));
  assert.equal(events.some(event => event.type === 'tool' && event.status === 'started'), false);
}));
