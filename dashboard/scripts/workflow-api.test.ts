import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeRuntime, downloadRuntimeFile, RUNTIME_AUTH_EXPIRED_EVENT, RuntimeRequestError, runtimeAction, runtimeRequest, watchRun, type RuntimeRequestErrorCode } from '../src/api/typescript.ts';

const objectSchema = { parse(value: unknown): { ok: true } { if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true) throw new Error('schema failure with sensitive payload'); return { ok: true }; } };
function expectFailure(code: RuntimeRequestErrorCode, status?: number): (cause: unknown) => boolean {
  return cause => { assert.ok(cause instanceof RuntimeRequestError); assert.equal(cause.code, code); assert.equal(cause.status, status); assert.doesNotMatch(cause.message, /sensitive|secret-token|authorization|Bearer/i); return true; };
}

test('401 notifies the dashboard for request, action, download and event stream without replaying writes', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget(); let notifications = 0;
  events.addEventListener(RUNTIME_AUTH_EXPIRED_EVENT, () => { notifications++; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); authorizeRuntime(''); });
  authorizeRuntime('secret-token');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"Bearer secret-token"}', { status: 401 }));
  await assert.rejects(runtimeRequest('config', objectSchema), expectFailure('unauthorized', 401));
  await assert.rejects(runtimeAction('personas', { name: 'retained draft' }), expectFailure('unauthorized', 401));
  await assert.rejects(downloadRuntimeFile('artifacts/example', 'example'), expectFailure('unauthorized', 401));
  await assert.rejects(watchRun('example', new AbortController().signal, () => {}), expectFailure('unauthorized', 401));
  assert.equal(notifications, 4);
  assert.equal(fetchMock.mock.callCount(), 4);
});

test('409 explains independent edit preservation and merge without assuming global configuration', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"sensitive source"}', { status: 409 }));
  const draft = { name: '人格修改', instructions: '保留内容' };
  await assert.rejects(runtimeRequest('personas/example', objectSchema, draft, 'PUT'), cause => {
    expectFailure('conflict', 409)(cause);
    assert.ok(cause instanceof RuntimeRequestError);
    assert.match(cause.message, /当前输入已保留/);
    assert.match(cause.message, /最新版本.*合并/);
    assert.doesNotMatch(cause.message, /配置版本|全局|导出/);
    return true;
  });
  assert.deepEqual(draft, { name: '人格修改', instructions: '保留内容' });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('413 gives an actionable upload error and action shares the same response handling', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('sensitive', { status: 413 }));
  await assert.rejects(runtimeAction('knowledge', { content: 'content' }), cause => {
    expectFailure('payload_too_large', 413)(cause); assert.ok(cause instanceof RuntimeRequestError); assert.match(cause.message, /超过.*上限.*缩小/); return true;
  });
});

test('server and transport failures never reveal responses, URLs or credentials and never retry a write', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; if (calls === 1) return new Response('https://secret-token.example/sensitive', { status: 502 }); throw new TypeError('https://secret-token.example/sensitive'); });
  await assert.rejects(runtimeAction('management/secrets/name', { value: 'secret-token' }, 'PUT'), expectFailure('server_error', 502));
  await assert.rejects(runtimeAction('management/secrets/name', { value: 'secret-token' }, 'PUT'), expectFailure('network_error'));
  assert.equal(calls, 2);
});

test('JSON syntax and schema errors are distinct, safe and retain a single submission', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(calls === 1 ? 'sensitive invalid json' : '{"secret-token":"sensitive"}', { status: 200 }); });
  await assert.rejects(runtimeRequest('config', objectSchema), expectFailure('invalid_json', 200));
  await assert.rejects(runtimeRequest('config', objectSchema), expectFailure('invalid_response', 200));
  assert.equal(calls, 2);
});

test('successful request keeps method, body and typed parsed result while actions accept empty responses', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    assert.equal(options?.method, 'PUT'); assert.equal(options.body, '{"ok":true}');
    return new Response('{"ok":true}', { status: 200 });
  });
  assert.deepEqual(await runtimeRequest('config', objectSchema, { ok: true }, 'PUT'), { ok: true });
  await runtimeAction('personas/example', undefined, 'DELETE');
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('SSE fetch cancellation preserves AbortError identity instead of reporting connection failure', async t => {
  const aborted = new DOMException('Request aborted', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw aborted; });
  await assert.rejects(watchRun('example', new AbortController().signal, () => {}), cause => cause === aborted);
});

test('SSE body cancellation preserves AbortError and malformed event data uses typed errors', async t => {
  const aborted = new DOMException('Request aborted', 'AbortError'); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream<Uint8Array>({ pull() { throw aborted; } }));
    return new Response('data: sensitive invalid json\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(watchRun('example', new AbortController().signal, () => {}), cause => cause === aborted);
  await assert.rejects(watchRun('example', new AbortController().signal, () => {}), expectFailure('invalid_json', 200));
});

test('unserializable requests fail before fetch and do not leak submitted content', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await assert.rejects(runtimeAction('config', { value: BigInt(1) }), expectFailure('invalid_request'));
  assert.equal(fetchMock.mock.callCount(), 0);
});


test('draft test requests forward cancellation without retrying or mutating the unsent draft', async t => {
  const controller = new AbortController();
  const draft = { message: '保留待测试内容' };
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(options?.signal, controller.signal);
    return new Promise<Response>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
    });
  });
  const request = runtimeRequest('agents/example/draft-test', objectSchema, draft, 'POST', controller.signal);
  controller.abort();
  await assert.rejects(request, cause => cause instanceof Error && cause.name === 'AbortError');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(draft.message, '保留待测试内容');
});
