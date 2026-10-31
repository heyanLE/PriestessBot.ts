import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceFiles } from '../apps/server/src/workspace-files.js';
import { RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { createRuntimeServer } from '../apps/server/src/http.js';

void test('workspace file mutations confine paths and reject symlinks, overwrite and nonempty removal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'priestess-files-')); const root = path.join(directory, 'root'); await mkdir(root);
  const files = new WorkspaceFiles(() => RuntimeConfigSchema.parse({ ...defaultConfiguration(), executionEnvironments: [{ id: 'local', type: 'local', root }] }));
  try {
    await files.mkdir('local', 'docs'); await files.upload('local', 'docs/a.txt', Buffer.from('你好'));
    assert.equal((await files.read('local', 'docs/a.txt')).toString(), '你好');
    await assert.rejects(files.upload('local', 'docs/a.txt', Buffer.from('overwrite')));
    await files.move('local', 'docs/a.txt', 'docs/b.txt'); assert.equal((await files.list('local', 'docs')).entries[0]?.name, 'b.txt');
    await assert.rejects(files.delete('local', 'docs')); await assert.rejects(files.delete('local', ''));
    await writeFile(path.join(directory, 'outside.txt'), 'secret'); await symlink(directory, path.join(root, 'escape')); await symlink(path.join(directory, 'outside.txt'), path.join(root, 'alias'));
    for (const invalid of ['../outside.txt', 'escape/outside.txt', 'alias']) { await assert.rejects(files.read('local', invalid)); await assert.rejects(files.upload('local', invalid, Buffer.from('bad'))); await assert.rejects(files.delete('local', invalid)); }
    assert.equal(await readFile(path.join(directory, 'outside.txt'), 'utf8'), 'secret');
    await files.delete('local', 'docs/b.txt'); await files.delete('local', 'docs');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

void test('management cookie restores access, rejects cross-origin and logout, and never exports secrets', async () => {
  const runtime = new PriestessRuntime({ database: ':memory:' }); const server = createRuntimeServer(runtime, { token: 'test-token', artifacts: '/tmp/operator-test-artifacts' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Address unavailable'); const base = `http://127.0.0.1:${address.port}/api/ts/`;
  try {
    assert.equal((await fetch(`${base}config`)).status, 401);
    const login = await fetch(`${base}auth/login`, { method: 'POST', headers: { Authorization: 'Bearer test-token' } }); assert.equal(login.status, 200);
    const rawCookie = login.headers.get('set-cookie'); assert.ok(rawCookie); assert.ok(rawCookie.includes('HttpOnly')); const cookie = rawCookie.split(';')[0]; assert.ok(cookie);
    assert.equal((await fetch(`${base}config`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}config`, { headers: { Cookie: cookie, Origin: 'https://evil.test' } })).status, 403);
    const secret = await fetch(`${base}management/secrets/TEST_SECRET`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'never-export-this' }) }); assert.equal(secret.status, 200);
    for (const endpoint of ['management/secrets', 'management/export', 'management/audit']) { const output = await (await fetch(`${base}${endpoint}`, { headers: { Cookie: cookie } })).text(); assert.ok(!output.includes('never-export-this')); }
    await fetch(`${base}auth/logout`, { method: 'POST', headers: { Cookie: cookie } }); assert.equal((await fetch(`${base}config`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await runtime.stop(); }
});

void test('authenticated workspace HTTP supports create upload preview move and download inside configured roots', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'priestess-http-files-'));
  const runtime = new PriestessRuntime({ database: ':memory:', config: RuntimeConfigSchema.parse({ ...defaultConfiguration(), executionEnvironments: [{ id: 'test-root', type: 'local', root: directory }] }) });
  const server = createRuntimeServer(runtime, { token: 'file-test-token', artifacts: path.join(directory, 'artifacts') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Address unavailable');
  const base = `http://127.0.0.1:${address.port}/api/ts/`;
  const request = (action: string, relative: string, method = 'GET', value?: object): Promise<Response> => fetch(`${base}files${action ? `/${action}` : ''}?${new URLSearchParams({ environmentId: 'test-root', path: relative })}`, { method, headers: { Authorization: 'Bearer file-test-token', 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
  try {
    assert.equal((await request('mkdir', 'folder', 'POST', {})).status, 201);
    assert.equal((await request('upload', 'folder/a.txt', 'POST', { content: Buffer.from('persisted workspace text').toString('base64') })).status, 201);
    assert.match(await (await request('read', 'folder/a.txt')).text(), /persisted workspace text/);
    assert.equal((await request('move', 'folder/a.txt', 'POST', { to: 'folder/b.txt' })).status, 200);
    assert.equal(await (await request('download', 'folder/b.txt')).text(), 'persisted workspace text');
    assert.equal((await request('read', '../outside')).status, 400);
    assert.equal((await request('', 'folder', 'DELETE')).status, 400);
    assert.equal((await request('', 'folder/b.txt', 'DELETE')).status, 200);
    assert.equal((await request('', 'folder', 'DELETE')).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
