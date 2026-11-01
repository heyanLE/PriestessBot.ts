import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelMessageCards, modelPayloadSections, parseModelPayload, preferredModelDocument, rawPayloadFilename, rawStringSummary } from '../src/components/typescript/raw-model-payload.ts';
import { ModelPayloadDocumentSchema } from '../../packages/contracts/src/model-records.ts';
import { authorizeRuntime, runtimeText, RuntimeRequestError } from '../src/api/typescript.ts';

test('full model JSON retains large image data and unmasked prompt values without formatting the source', () => {
  const image = `data:image/png;base64,${'A'.repeat(1_100_000)}`;
  const request = { model: 'fixture', instructions: 'literal api_key=visible-request-data', input: [{ role: 'user', content: [{ type: 'input_text', text: '请求 <script>literal</script>' }, { type: 'input_image', image_url: image }] }], tools: [{ type: 'function', name: 'fixture', description: 'Complete description', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Exact path.' } } } }], stream: true };
  const text = JSON.stringify(request); const result = parseModelPayload(text, 'application/json; charset=utf-8');
  assert.equal(result.kind, 'json'); if (result.kind !== 'json') return;
  assert.deepEqual(result.value, request); assert.equal(JSON.stringify(result.value), text);
  const summary = rawStringSummary(image); assert.equal(summary.folded, true); assert.equal(summary.excerpt, ''); assert.match(summary.label, /图片 Base64/);
  assert.equal(image.length, 1_100_022); assert.match(text, /api_key=visible-request-data/);
  const sections = modelPayloadSections(result.value); assert.deepEqual(sections.map(section => section.title), ['系统指令', '输入消息 · 人格、上下文与对话', '工具定义与参数', '请求参数与其他字段']);
  assert.deepEqual(sections[2]?.value, request.tools);
});

test('chat messages preserve system roles, tool results, provider fields and exact zero or false parameters', () => {
  const data = { model: 'fixture', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }, { role: 'tool', tool_call_id: 'c1', content: '{"value":0,"ok":false}' }], tools: [], temperature: 0, stream: false, vendor_field: null };
  const sections = modelPayloadSections(data); const messages = sections[0]; assert.ok(messages?.messages);
  assert.deepEqual(modelMessageCards(messages.value).map(card => card.title), ['系统消息', '用户消息', '工具结果']);
  assert.deepEqual(sections.at(-1)?.value, { model: 'fixture', temperature: 0, stream: false, vendor_field: null });
  assert.deepEqual(modelMessageCards(messages.value)[2]?.extra, { tool_call_id: 'c1' });
});

test('persona and dynamic context remain original user messages with clear semantic labels', () => {
  const messages = [{ role: 'user', content: [{ type: 'input_text', text: '<context_anchor name="persona" hash="hash">persona</context_anchor>' }] }, { role: 'user', content: [{ type: 'input_text', text: '<context_anchor name="persona_examples" hash="hash">examples</context_anchor>' }] }, { role: 'user', content: [{ type: 'input_text', text: '<dynamic_context hash="hash">context</dynamic_context>' }] }];
  const before = JSON.stringify(messages); const cards = modelMessageCards(messages);
  assert.deepEqual(cards.map(card => card.title), ['人格指令', '示例对话', '当前动态上下文']); assert.ok(cards.every(card => card.metadata[0] === '原始角色：user'));
  assert.equal(JSON.stringify(messages), before);
});

test('message pagination limits rendered cards while retaining access to all original messages', () => {
  const messages = Array.from({ length: 83 }, (_, index) => ({ role: 'user', content: `message-${index}` }));
  assert.equal(modelMessageCards(messages).length, 30); assert.equal(modelMessageCards(messages, 60).length, 60); assert.equal(modelMessageCards(messages, 90).length, 83);
  assert.equal(messages.at(-1)?.content, 'message-82');
});

test('SSE view decodes complete events and preserves non-JSON or incomplete data in the original stream', () => {
  const text = ': heartbeat\r\n\r\nevent: response.created\r\ndata: {"id":"response-1","secret":"visible"}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"incomplete"';
  const parsed = parseModelPayload(text, 'text/event-stream'); assert.equal(parsed.kind, 'events'); if (parsed.kind !== 'events') return;
  assert.equal(parsed.events.length, 3); assert.deepEqual(parsed.events[0]?.value, { id: 'response-1', secret: 'visible' }); assert.equal(parsed.events[1]?.value, '[DONE]'); assert.equal(parsed.events[2]?.value, '{"incomplete"');
  assert.equal(rawPayloadFilename('provider_response', 2, 'text/event-stream'), 'model-provider_response-attempt-2.txt');
});

test('invalid or deeply nested JSON is never repaired and prototype-like field names stay inert', () => {
  assert.deepEqual(parseModelPayload('{"cut":', 'application/json'), { kind: 'text', reason: 'invalid_json' });
  const deep = '['.repeat(150) + '0' + ']'.repeat(150); assert.deepEqual(parseModelPayload(deep, 'application/json'), { kind: 'text', reason: 'deep_json' });
  const prototype = parseModelPayload('{"__proto__":{"inert":true},"constructor":"text","script":"<script>text</script>"}', 'application/json');
  assert.equal(prototype.kind, 'json'); if (prototype.kind !== 'json') return;
  assert.equal(JSON.stringify(prototype.value), '{"__proto__":{"inert":true},"constructor":"text","script":"<script>text</script>"}');
});

test('raw model text uses management authentication without exposing the token in a URL or altering payload text', async t => {
  authorizeRuntime('management-fixture-token'); t.after(() => authorizeRuntime(''));
  const raw = '{"prompt":"Bearer user-supplied-text","password":"literal model input"}\n';
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, '/api/ts/agent-records/run/model-calls/call/doc'); assert.equal(init?.method, 'GET');
    assert.ok(init?.headers instanceof Headers); assert.equal(init.headers.get('Authorization'), 'Bearer management-fixture-token');
    return new Response(raw, { headers: { 'content-type': 'text/plain;charset=utf-8' } });
  });
  assert.equal(await runtimeText('agent-records/run/model-calls/call/doc'), raw);
});

test('raw model text rejects unauthorized responses and preserves request cancellation', async t => {
  const signal = new AbortController().signal; const abort = new DOMException('Aborted', 'AbortError'); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => { assert.equal(init?.signal, signal); if (++calls === 1) return new Response('private body', { status: 401 }); throw abort; });
  await assert.rejects(runtimeText('agent-records/run/model-calls/call/doc', signal), error => error instanceof RuntimeRequestError && error.status === 401);
  await assert.rejects(runtimeText('agent-records/run/model-calls/call/doc', signal), error => error === abort);
});


test('SDK stream fallback displays its final response and retains every captured event and completion flag', () => {
  const response = { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'complete answer' }] }], usage: { inputTokens: 10 } };
  const events = [{ type: 'output_text_delta', delta: 'complete answer' }, { type: 'response_done', response }];
  const sections = modelPayloadSections({ events, complete: true });
  assert.deepEqual(sections.map(section => section.title), ['SDK 完整响应', 'SDK 流事件', '保存状态与其他字段']);
  assert.deepEqual(sections[0]?.value, response); assert.deepEqual(sections[1]?.value, events); assert.deepEqual(sections[2]?.value, { complete: true });
});


test('default selection promotes SDK fallback to the latest actual provider request without relying on metadata order', () => {
  const doc = (id: string, kind: string, attempt: number, createdAt: number) => ModelPayloadDocumentSchema.parse({ id, runId: 'run', callId: 'call', modelCall: 1, model: 'fixture', source: 'model', kind, attempt, contentType: 'application/json', status: 'complete', bytes: 50, createdAt, updatedAt: createdAt });
  const sdk = doc('00000000-0000-4000-8000-000000000001', 'sdk_request', 0, 1);
  const first = doc('00000000-0000-4000-8000-000000000002', 'provider_request', 1, 2);
  const latest = doc('00000000-0000-4000-8000-000000000003', 'provider_request', 2, 3);
  assert.equal(preferredModelDocument([sdk])?.id, sdk.id);
  assert.equal(preferredModelDocument([sdk, first])?.id, first.id);
  assert.equal(preferredModelDocument([latest, sdk, first])?.id, latest.id);
});
