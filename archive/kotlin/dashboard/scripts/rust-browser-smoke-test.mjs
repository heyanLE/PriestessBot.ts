import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'priestess-browser-'));
const updates = [], sends = []; let modelCalls = 0;
const modelServer = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url === '/v1/responses') {
    modelCalls++;
    const item = modelCalls === 1 ? { type: 'custom_tool_call', call_id: 'canvas-exec', name: 'exec', input: 'const echo=ALL_TOOLS.find(t=>t.name.endsWith("echo")); const result=await tools[echo.name]({text:"CANVAS-TOOL-OK"}); text(result);' } : { type: 'message', role: 'assistant', id: 'canvas-answer', content: [{ type: 'output_text', text: 'CANVAS-AGENT-OK' }] };
    const frames = [{ type: 'response.created', response: { id: `r${modelCalls}` } }, { type: 'response.output_item.done', item }, { type: 'response.completed', response: { id: `r${modelCalls}`, usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } } }];
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frames.map(v => `event: ${v.type}\ndata: ${JSON.stringify(v)}\n\n`).join('')); return;
  }
  const method = req.url.split('/').pop(); let result;
  if (method === 'getMe') result = { id: 900, username: 'fixture_bot' };
  else if (method === 'getWebhookInfo') result = { url: '' };
  else if (method === 'getUpdates') { await new Promise(r => setTimeout(r, 30)); result = updates.filter(u => u.update_id >= (body.offset || 0)); }
  else { sends.push({ method, body }); result = method === 'sendMessageDraft' ? true : { message_id: 123 }; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result }));
});
await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
const mock = `http://127.0.0.1:${modelServer.address().port}`;
const config = JSON.parse(await readFile(resolve(root, 'rust/examples/application.json')));
config.code_mode_host = resolve(root, 'rust/target/debug/codex-code-mode-host');
config.llms[0].endpoint = `${mock}/v1`; config.llms[0].api_key_env = 'PRIESTESS_BROWSER_MODEL_KEY';
config.agents[0].workspace = resolve(temp, 'work'); config.agents[0].codex_home = resolve(temp, 'home');
config.ims[0].id = 'tg'; config.ims[0].connection = { type: 'telegram', token_env: 'PRIESTESS_BROWSER_BOT_TOKEN', api_base: mock, accept_chat_ids: ['42'] };
await writeFile(resolve(temp, 'config.json'), JSON.stringify(config));
const binary = resolve(root, 'rust/target/debug/priestess-server'), database = resolve(temp, 'state.sqlite');
const initialized = spawnSync(binary, ['state', 'init', database, resolve(temp, 'config.json')], { encoding: 'utf8' });
assert.equal(initialized.status, 0, initialized.stderr);
const token = randomBytes(24).toString('hex');
const env = { ...process.env, PRIESTESS_BROWSER_MANAGEMENT: token, PRIESTESS_BROWSER_MODEL_KEY: 'mock-only-model-key', PRIESTESS_BROWSER_BOT_TOKEN: 'fake', PRIESTESS_DASHBOARD_DIR: resolve(root, 'dashboard/dist') };
const service = spawn(binary, ['state', 'api', database, '127.0.0.1:0', 'PRIESTESS_BROWSER_MANAGEMENT'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let logs = ''; service.stderr.on('data', b => { logs += b; });
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out: ' + logs.slice(-2000)); };
let browser;
try {
  const address = await until(() => logs.match(/management ready: (127\.0\.0\.1:\d+)/)?.[1]);
  const base = `http://${address}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.TEST_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1650, height: 1100 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/rust`); await page.getByLabel('管理令牌').fill(token); await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.locator('.route-node').filter({ has: page.locator('small', { hasText: /^ordinary$/ }) }).locator('header').click();
  await page.locator('.inspector select').selectOption('senior_operator');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); assert.equal(await page.locator('.inspector select').inputValue(), 'operator');
  await page.getByRole('button', { name: '重做', exact: true }).click(); assert.equal(await page.locator('.inspector select').inputValue(), 'senior_operator');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await page.getByRole('status').filter({ hasText: '草稿已保存' }).waitFor();
  await page.getByLabel('调用者', { exact: true }).fill('42'); await page.getByLabel('消息', { exact: true }).fill('route agent test');
  await page.getByRole('button', { name: '模拟草稿（不产生副作用）' }).click(); await page.locator('.result').filter({ hasText: 'senior_operator' }).waitFor(); assert.equal(modelCalls, 0);
  await page.getByRole('button', { name: '发布路由', exact: true }).click(); await page.getByRole('status').filter({ hasText: '路由已发布' }).waitFor();
  const input = (n, text) => ({ update_id: n, message: { message_id: n, from: { id: 42 }, chat: { id: 42, type: 'private' }, text } });
  updates.push(input(1, '/echo CANVAS-COMMAND-OK')); await until(() => sends.some(v => v.body.text?.includes('CANVAS\\-COMMAND\\-OK') || v.body.text?.includes('CANVAS-COMMAND-OK')));
  updates.push(input(2, 'Please call echo')); await until(() => sends.some(v => v.method === 'sendMessage' && v.body.text?.includes('CANVAS\\-AGENT\\-OK')), 40000);
  assert.equal(modelCalls, 2);
  const runs = await fetch(`${base}/api/v4/runs`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  const agentRun = runs.find(r => r.agent_id === 'assistant'); assert.equal(agentRun.state, 'senior_operator');
  const trace = await fetch(`${base}/api/v4/runs/${agentRun.id}/events`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()); assert(trace.some(e => e.event.type === 'tool_result' && e.event.success));
  await page.getByLabel('消息', { exact: true }).fill('route agent test'); await page.getByRole('button', { name: '模拟草稿（不产生副作用）' }).click();
  await mkdir(resolve(root, 'rust/.build/unattended'), { recursive: true }); await page.screenshot({ path: resolve(root, 'rust/.build/unattended/rust-canvas.png'), fullPage: true });
  await page.getByRole('button', { name: 'Agent 与资源', exact: true }).click(); await page.getByLabel('资源类型').selectOption('environments');
  await page.getByRole('button', { name: '运行状态', exact: true }).click(); await page.getByRole('heading', { name: '引擎与并发' }).waitFor();
  assert.deepEqual(errors, []); console.log('PASS: real Rust API + canvas edit/undo/draft/simulation/publish + Telegram command + native Codex/code-mode tool + original-chat reply + trace');
} finally {
  await browser?.close(); service.kill('SIGINT'); await Promise.race([new Promise(r => service.once('exit', r)), new Promise(r => setTimeout(() => { service.kill('SIGKILL'); r(); }, 10000))]); await new Promise(r => modelServer.close(r)); await rm(temp, { recursive: true, force: true });
}
