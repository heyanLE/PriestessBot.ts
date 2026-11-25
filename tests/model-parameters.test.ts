import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { Agent, Runner, OpenAIProvider, setTracingDisabled, withTrace, type ModelRequest } from '@openai/agents';
import { z } from 'zod';
import { ConnectionSchema } from '../packages/contracts/src/index.js';
import { customModelSettings, customModelTools } from '../packages/adapters/src/agents/model-parameters.js';

const customParameters = { reasoning: { effort: 'high' }, safety_check: { level: 'high' }, title: { enabled: true }, tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }] };
setTracingDisabled(true);

void test('custom parameters are optional JSON and cannot replace runtime input, budgets or local tools', () => {
  assert.equal(ConnectionSchema.parse({ id: 'legacy' }).customParameters, undefined);
  assert.deepEqual(ConnectionSchema.parse({ id: 'deepseek', customParameters }).customParameters, customParameters);
  for (const parameters of [{ input: 'replace user' }, { stream: false }, { max_output_tokens: 99999 }, { extra_body: { input: 'replace user' } }, { tools: [{ type: 'function', name: 'exec' }] }, { tools: [{ type: 'deepseek_web_search' }, { type: 'deepseek_web_search' }] }, ['not an object']]) {
    assert.equal(ConnectionSchema.safeParse({ id: 'invalid', customParameters: parameters }).success, false);
  }
  assert.equal(ConnectionSchema.safeParse({ id: 'chat', protocol: 'chat_completions', customParameters }).success, false);
  assert.equal(ConnectionSchema.safeParse({ id: 'chat', protocol: 'chat_completions', customParameters: { thinking: { type: 'enabled' } } }).success, true);
});

void test('Responses sends custom settings alongside local tools and replays DeepSeek search metadata unchanged', async () => {
  const bodies: Record<string, unknown>[] = [];
  const webCall = { type: 'web_search_call', id: 'web-1', status: 'completed', kind: 'read_link', action: { type: 'open_page', url: 'https://example.com' }, page: { url: 'https://example.com', title: 'Example' }, signature: 'opaque-page-signature' };
  const reasoning = { type: 'reasoning', id: 'reason-1', summary: [], content: [{ type: 'reasoning_text', text: 'Provider reasoning for replay' }] };
  const provider = new OpenAIProvider({ useResponses: true, openAIClient: new OpenAI({ apiKey: 'test', baseURL: 'https://model.invalid/v1', maxRetries: 0, fetch: (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
    bodies.push(z.record(z.string(), z.unknown()).parse(JSON.parse(init.body)));
    return Promise.resolve(Response.json({ id: `response-${bodies.length}`, object: 'response', created_at: 1, model: 'deepseek-flash', status: 'completed', output: [reasoning, webCall, { type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Answer', annotations: [{ type: 'url_citation', url: 'https://example.com', title: 'Example', start_index: 0, end_index: 6 }] }] }], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } }));
  } }) });
  try {
    const connection = ConnectionSchema.parse({ id: 'deepseek', customParameters });
    const model = await provider.getModel('deepseek-flash');
    const request: ModelRequest = { systemInstructions: 'Instructions', input: 'Read this page', tools: [{ type: 'function', name: 'local_lookup', description: 'Local tool', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true }, ...customModelTools(connection)], handoffs: [], outputType: 'text', tracing: false, modelSettings: { ...customModelSettings(connection), maxTokens: 100 } };
    const first = await withTrace('custom parameters', () => model.getResponse(request));
    assert.deepEqual(bodies[0]?.tools, [{ type: 'function', name: 'local_lookup', description: 'Local tool', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true }, ...customParameters.tools]);
    assert.deepEqual(bodies[0]?.reasoning, customParameters.reasoning);
    assert.deepEqual(bodies[0]?.safety_check, customParameters.safety_check);
    assert.deepEqual(bodies[0]?.title, customParameters.title);
    assert.equal(bodies[0]?.max_output_tokens, 100);
    await withTrace('replay', () => model.getResponse({ ...request, input: [...first.output, { role: 'user', content: 'Continue from that page' }] }));
    const replay = z.array(z.record(z.string(), z.unknown())).parse(bodies[1]?.input);
    assert.deepEqual(replay.find(item => item.type === 'web_search_call'), webCall);
    assert.deepEqual(replay.find(item => item.type === 'reasoning')?.content, reasoning.content);
    await withTrace('finalize', () => model.getResponse({ ...request, tools: [], modelSettings: { ...customModelSettings(connection), maxTokens: 50, toolChoice: 'none' } }));
    assert.deepEqual(bodies[2]?.tools, []);
    assert.equal(bodies[2]?.tool_choice, 'none');
    // Match the runtime's resolved Model object; the SDK strips reasoning defaults from non-GPT model-name strings.
    const agent = new Agent({ name: 'configured', model, tools: customModelTools(connection), modelSettings: { ...customModelSettings(connection), maxTokens: 100 } });
    await new Runner({ modelProvider: provider, tracingDisabled: true }).run(agent, 'Read this page');
    assert.deepEqual(bodies[3]?.reasoning, customParameters.reasoning);
  } finally { await provider.close(); }
});
