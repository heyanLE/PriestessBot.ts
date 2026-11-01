import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ModelPayloadStore, ModelPayloadNotFound } from '../apps/server/src/model-payloads.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { ModelPayloadListSchema } from '../packages/contracts/src/model-records.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';
import type { RawModelPayloadMetadata } from '../packages/adapters/src/agents/raw-model-capture.js';

const meta: RawModelPayloadMetadata = { callId: 'call-1', modelCall: 1, model: 'fixture', source: 'model', kind: 'provider_request', attempt: 1, contentType: 'application/json' };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-payload-test-')); const store = new RuntimeStore(':memory:');
  const payloads = new ModelPayloadStore(store, () => path.join(root, 'model-records'));
  return { root, store, payloads, async close() { await payloads.drain(); store.close(); await rm(root, { recursive: true, force: true }); } };
}

await test('full model payload preserves values and multi-megabyte media exactly outside the event database', async () => {
  const f = await fixture();
  try {
    const body = JSON.stringify({ instructions: 'Exact instructions with api_key=literal-user-text', input: [{ role: 'user', content: 'data:image/png;base64,' + 'A'.repeat(5_100_000) }], tools: [{ name: 'x', description: 'Complete tool description', parameters: { type: 'object' } }] });
    const writer = await f.payloads.sink('run-1').open(meta); await writer.write(body.slice(0, 4000)); await writer.write(body.slice(4000)); await writer.close();
    const document = f.payloads.list('run-1', 'call-1')[0]; assert.ok(document); assert.equal(document.status, 'complete'); assert.equal(document.bytes, Buffer.byteLength(body));
    const opened = await f.payloads.read('run-1', 'call-1', document.id); try { assert.equal(await opened.file.readFile('utf8'), body); } finally { await opened.file.close(); }
    assert.ok(JSON.stringify(f.store.list('model-payload-documents', ModelPayloadListSchema.shape.documents.element)).length < 1000);
    assert.equal((await stat(path.join(f.root, 'model-records', `${document.id}.body`))).mode & 0o777, 0o600);
    assert.equal(f.store.events('run-1').length, 0);
  } finally { await f.close(); }
});

await test('model payload access binds run and call identity and refuses linked files', async () => {
  const f = await fixture();
  try {
    const writer = await f.payloads.sink('run-1').open(meta); await writer.write('original'); await writer.close(); const document = f.payloads.list('run-1', 'call-1')[0]; assert.ok(document);
    await assert.rejects(f.payloads.read('other-run', 'call-1', document.id), ModelPayloadNotFound);
    await assert.rejects(f.payloads.read('run-1', 'other-call', document.id), ModelPayloadNotFound);
    await assert.rejects(f.payloads.read('run-1', 'call-1', '../private'), ModelPayloadNotFound);
    const file = path.join(f.root, 'model-records', `${document.id}.body`); const outside = path.join(f.root, 'outside.txt'); await writeFile(outside, 'outside'); await unlink(file); await symlink(outside, file);
    await assert.rejects(f.payloads.read('run-1', 'call-1', document.id), ModelPayloadNotFound);
    assert.equal(await readFile(outside, 'utf8'), 'outside');
  } finally { await f.close(); }
});

await test('failed streaming body retains exact partial bytes and drain waits for an open writer', async () => {
  const f = await fixture();
  try {
    const writer = await f.payloads.sink('run-1').open({ ...meta, kind: 'provider_response', contentType: 'text/event-stream' });
    await writer.write('data: {"text":"中文"}\n\n'); let drained = false; const wait = f.payloads.drain().then(() => { drained = true; });
    await Promise.resolve(); assert.equal(drained, false); await writer.fail('Connection closed before completion.'); await wait;
    const document = f.payloads.list('run-1', 'call-1')[0]; assert.ok(document); assert.equal(document.status, 'failed');
    const file = await f.payloads.read('run-1', 'call-1', document.id); try { assert.equal(await file.file.readFile('utf8'), 'data: {"text":"中文"}\n\n'); } finally { await file.file.close(); }
  } finally { await f.close(); }
});

await test('raw body HTTP requires management authentication and serves inert exact text without truncation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-payload-http-'));
  const runtime = new PriestessRuntime({ database: ':memory:' }); const token = 'payload-test-token';
  const server = createRuntimeServer(runtime, { token, artifacts: path.join(root, 'artifacts') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`; const headers = { Authorization: `Bearer ${token}` };
  try {
    const text = '<script>window.privateData=true</script> secret=UNMASKED ' + 'x'.repeat(1_100_000);
    const writer = await runtime.modelPayloads.sink('run-1').open({ ...meta, kind: 'provider_response', contentType: 'text/html', httpStatus: 502 }); await writer.write(text); await writer.close();
    const route = '/api/ts/agent-records/run-1/model-calls/call-1';
    assert.equal((await fetch(base + route)).status, 401);
    assert.equal((await fetch(base + route, { headers: { ...headers, Origin: 'https://unrelated.invalid' } })).status, 403);
    const list = ModelPayloadListSchema.parse(await (await fetch(base + route, { headers })).json()); assert.equal(list.legacy, false); const document = list.documents[0]; assert.ok(document);
    const resource = `${base}${route}/${document.id}`;
    assert.equal((await fetch(resource)).status, 401);
    const response = await fetch(resource, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(await response.text(), text);
    const download = await fetch(resource + '?download=1', { headers }); assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/); assert.equal(await download.text(), text);
    assert.equal((await fetch(`${base}/api/ts/agent-records/other/model-calls/call-1/${document.id}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/ts/artifacts/${document.id}`, { headers })).status, 404);
    assert.equal((await fetch(base + route, { method: 'POST', headers })).status, 405);
    assert.equal((await fetch(base + '/api/ts/agent-records/run-1/model-calls/missing', { headers })).status, 404);
  } finally { await runtime.stop(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
});
