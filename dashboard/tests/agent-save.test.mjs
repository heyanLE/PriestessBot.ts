import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRuntimeServer } from '../../apps/server/src/http.ts';
import { PriestessRuntime } from '../../apps/server/src/runtime.ts';

test('Agent form saves configuration and persona together and preserves the draft on conflict', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-save-'));
  const runtime = new PriestessRuntime({ database: ':memory:' });
  const server = createRuntimeServer(runtime, {
    token: 'test-token', artifacts: join(directory, 'artifacts'), dashboard: fileURLToPath(new URL('../', import.meta.url)),
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const original = runtime.config();
  const agent = original.agents[0];
  const persona = runtime.management.savePersona({ name: 'Test persona', instructions: 'Test instructions' });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const login = await page.request.post(`${base}/api/ts/auth/login`, { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(login.status(), 200);
  const writes = [];
  page.on('request', request => {
    if (request.method() === 'PUT') writes.push(new URL(request.url()).pathname);
  });
  async function openEditor() {
    await page.goto(base);
    await page.locator('#conn-text', { hasText: '已连接' }).waitFor();
    await page.locator('.rail-mode[data-screen="agents"]').click();
  }
  const form = page.locator('#agent-form');
  const name = form.locator('[name="displayName"]');
  const selectedPersona = form.locator('[name="personaId"]');
  const save = form.getByRole('button', { name: '保存 Agent' });
  await openEditor();
  await name.fill('Draft after conflict');
  await selectedPersona.selectOption(persona.id);
  const competing = runtime.management.bindPersona(agent.id, null, 0);
  await save.click();
  await page.locator('#global-error', { hasText: 'reload' }).waitFor();
  assert.deepEqual(runtime.config(), original);
  assert.deepEqual(runtime.management.bindings(), [competing]);
  assert.equal(await name.inputValue(), 'Draft after conflict');
  assert.equal(await selectedPersona.inputValue(), persona.id);
  assert.equal(await page.locator('#toast').isVisible(), false);

  await openEditor();
  await name.fill('Saved with persona');
  await selectedPersona.selectOption(persona.id);
  await save.click();
  await form.getByRole('heading', { name: 'Saved with persona' }).waitFor();
  assert.equal(runtime.config().revision, original.revision + 1);
  assert.equal(runtime.management.bindings()[0].personaId, persona.id);
  assert.equal(await selectedPersona.inputValue(), persona.id);

  // A second save without reloading must use both revisions returned by the first.
  await name.fill('Saved without persona');
  await selectedPersona.selectOption('');
  await save.click();
  await form.getByRole('heading', { name: 'Saved without persona' }).waitFor();
  assert.equal(runtime.config().revision, original.revision + 2);
  assert.equal(runtime.config().agents[0].displayName, 'Saved without persona');
  assert.deepEqual(runtime.management.bindings(), [{ agentId: agent.id, personaId: null, revision: competing.revision + 2 }]);
  assert.deepEqual(writes, Array(3).fill(`/api/ts/agents/${agent.id}/workbench`));
});
