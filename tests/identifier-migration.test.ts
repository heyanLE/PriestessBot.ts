import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { rewriteEnv, rewriteIdentifiers, migrateIdentifiers, restoreIdentifiers } from '../tools/migrate-identifiers.js';
import { RuntimeStore } from '../packages/core/src/storage.js';

void test('identifier rewrite is token scoped and never touches unrelated prose', () => {
  assert.equal(rewriteIdentifiers('astrbotx:菲亚梅塔'), 'priestess:菲亚梅塔');
  assert.equal(rewriteIdentifiers('astrbotx-archive-conversations'), 'priestess-archive-conversations');
  assert.equal(rewriteIdentifiers('{"executionEnvironment":"astrbotx-local"}'), '{"executionEnvironment":"priestess-local"}');
  assert.equal(rewriteIdentifiers('ASTRBOTX_MODEL_DEEPSEEK'), 'PRIESTESS_MODEL_DEEPSEEK');
  // A bare mention of the source project is not an identifier and stays intact.
  assert.equal(rewriteIdentifiers('参考 AstrBotX 的实现'), '参考 AstrBotX 的实现');
  assert.equal(rewriteIdentifiers('astrbot_plugin_deepseek_search_config.json'), 'astrbot_plugin_deepseek_search_config.json');
});

void test('env rewrite keeps comments, order and unrelated keys', () => {
  const source = '# runtime\nPRIESTESS_API_TOKEN=keep\nASTRBOTX_MODEL_DEEPSEEK=secret\nexport ASTRBOTX_NAPCAT_QQ=t\n';
  const { text, renamed } = rewriteEnv(source);
  assert.equal(renamed, 2);
  assert.equal(text, '# runtime\nPRIESTESS_API_TOKEN=keep\nPRIESTESS_MODEL_DEEPSEEK=secret\nexport PRIESTESS_NAPCAT_QQ=t\n');
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'identifier-migrate-'));
  const database = join(directory, 'runtime.sqlite');
  const store = new RuntimeStore(database);
  store.put('management-personas', 'astrbotx:菲亚梅塔', { id: 'astrbotx:菲亚梅塔', name: '菲亚梅塔', instructions: 'astrbot', exampleDialogs: [] });
  store.put('management-persona-bindings', 'assistant', { agentId: 'assistant', personaId: 'astrbotx:菲亚梅塔' });
  store.put('astrbotx-archive-preferences', 'codex', { threadId: 'old-thread', note: 'AstrBotX 存档' });
  store.put('operator-secrets', 'ASTRBOTX_MODEL_DEEPSEEK', { name: 'ASTRBOTX_MODEL_DEEPSEEK', value: 'SECRET-VALUE', updatedAt: 1 });
  store.db.prepare('INSERT INTO sessions(id,generation) VALUES(?,?)').run('conversation:astrbotx-local', 1);
  store.db.prepare('INSERT INTO configuration(revision,value,created_at) VALUES(?,?,?)').run(1, JSON.stringify({ runtime: 'priestess-ts', executionEnvironments: [{ id: 'astrbotx-local' }], memoryLibraries: [{ id: 'astrbotx-memory' }] }), 1);
  store.close();
  const env = join(directory, 'runtime.env');
  await writeFile(env, 'PRIESTESS_API_TOKEN=t\nASTRBOTX_MODEL_DEEPSEEK=SECRET-VALUE\n', { mode: 0o600 });
  const files = join(directory, 'data');
  await mkdir(join(files, 'imported', 'astrbotx'), { recursive: true });
  await writeFile(join(files, 'astrbotx-migration-report.json'), '{"format":"priestess-legacy-import-v1"}');
  return { directory, database, env, files };
}

void test('dry run is read only and reports what would change', async () => {
  const fixture = await setup();
  try {
    const before = await readFile(fixture.database);
    const report = await migrateIdentifiers({ database: fixture.database });
    assert.equal(report.applied, false);
    assert.equal(report.counts.ids, 2);
    assert.equal(report.counts.namespaces, 1);
    assert.equal(report.counts.sessions, 1);
    assert.equal(report.counts.configurations, 1);
    assert.ok(report.samples.some(sample => sample.includes('astrbotx:菲亚梅塔 -> priestess:菲亚梅塔')));
    assert.deepEqual(await readFile(fixture.database), before);
    assert.equal((await readdir(fixture.directory)).some(name => name.includes('.pre-priestess-')), false);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

void test('apply renames namespace, id, json references, configuration, env and archive paths', async () => {
  const fixture = await setup();
  try {
    const report = await migrateIdentifiers({ database: fixture.database, env: fixture.env, files: fixture.files, apply: true });
    assert.equal(report.applied, true);
    assert.ok(report.backup);
    assert.equal((await stat(report.backup)).mode & 0o777, 0o600);
    const store = new RuntimeStore(fixture.database);
    try {
      assert.equal(store.get('management-personas', 'priestess:菲亚梅塔', z.unknown()) !== undefined, true);
      assert.equal(store.get('management-personas', 'astrbotx:菲亚梅塔', z.unknown()), undefined);
      assert.deepEqual(store.get('management-persona-bindings', 'assistant', z.unknown()), { agentId: 'assistant', personaId: 'priestess:菲亚梅塔' });
      assert.deepEqual(store.get('priestess-archive-preferences', 'codex', z.unknown()), { threadId: 'old-thread', note: 'AstrBotX 存档' });
      assert.deepEqual(store.get('operator-secrets', 'PRIESTESS_MODEL_DEEPSEEK', z.unknown()), { name: 'PRIESTESS_MODEL_DEEPSEEK', value: 'SECRET-VALUE', updatedAt: 1 });
      const row = z.object({ value: z.string() }).parse(store.db.prepare('SELECT value FROM configuration WHERE revision=1').get());
      assert.equal(row.value.includes('astrbotx'), false);
      assert.match(row.value, /priestess-local/u);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id=?').get('conversation:priestess-local')?.count, 1);
    } finally { store.close(); }
    const env = await readFile(fixture.env, 'utf8');
    assert.match(env, /PRIESTESS_MODEL_DEEPSEEK=SECRET-VALUE/u);
    assert.doesNotMatch(env, /ASTRBOTX/u);
    assert.equal((await stat(fixture.env)).mode & 0o777, 0o600);
    assert.deepEqual(report.counts.fileMoves, ['astrbotx -> legacy', 'astrbotx-migration-report.json -> migration-report.json']);
    assert.equal((await stat(join(fixture.files, 'imported', 'legacy'))).isDirectory(), true);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

void test('second run is a no-op and a collision fails closed', async () => {
  const fixture = await setup();
  try {
    await migrateIdentifiers({ database: fixture.database, apply: true });
    const again = await migrateIdentifiers({ database: fixture.database, apply: true });
    assert.deepEqual(again.counts, { namespaces: 0, ids: 0, values: 0, configurations: 0, sessions: 0, envKeys: 0, fileMoves: [] });
    const store = new RuntimeStore(fixture.database);
    store.put('management-personas', 'astrbotx:collision', { id: 'astrbotx:collision' });
    store.put('management-personas', 'priestess:collision', { id: 'priestess:collision' });
    store.close();
    await assert.rejects(migrateIdentifiers({ database: fixture.database, apply: true }), /collision/u);
    const check = new RuntimeStore(fixture.database);
    try {
      assert.equal(check.get('management-personas', 'astrbotx:collision', z.unknown()) !== undefined, true);
    } finally { check.close(); }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

void test('rows backup keeps a full database copy off disk and restores exactly', async () => {
  const fixture = await setup();
  try {
    const report = await migrateIdentifiers({ database: fixture.database, backup: 'rows', apply: true });
    assert.equal(report.backupMode, 'rows');
    assert.match(report.backup, /\.rows\.json$/u);
    // No sibling database copy was created.
    assert.equal((await readdir(fixture.directory)).some(name => name.includes('.pre-priestess-') && !name.endsWith('.rows.json')), false);
    assert.equal((await stat(report.backup)).mode & 0o777, 0o600);
    const renamed = new RuntimeStore(fixture.database);
    assert.notEqual(renamed.get('management-personas', 'priestess:菲亚梅塔', z.unknown()), undefined);
    renamed.close();
    const { restored } = await restoreIdentifiers({ database: fixture.database, backup: report.backup });
    assert.equal(restored, 4);
    const back = new RuntimeStore(fixture.database);
    try {
      assert.notEqual(back.get('management-personas', 'astrbotx:菲亚梅塔', z.unknown()), undefined);
      assert.equal(back.get('management-personas', 'priestess:菲亚梅塔', z.unknown()), undefined);
      assert.deepEqual(back.get('management-persona-bindings', 'assistant', z.unknown()), { agentId: 'assistant', personaId: 'astrbotx:菲亚梅塔' });
      assert.notEqual(back.get('astrbotx-archive-preferences', 'codex', z.unknown()), undefined);
      const row = z.object({ value: z.string() }).parse(back.db.prepare('SELECT value FROM configuration WHERE revision=1').get());
      assert.match(row.value, /astrbotx-local/u);
    } finally { back.close(); }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
