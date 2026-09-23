import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, root } from './v3-test-support.mjs';

// Uses an isolated mock backend; never connects to or mutates a user's running bot.
// Set PLAYWRIGHT_MODULE to a preinstalled Playwright entry point, or install playwright locally.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file =
    pathname.startsWith('/assets/') && !pathname.includes('..') ? pathname.slice(1) : 'index.html';
  try {
    const body = await readFile(resolve(root, 'dist', file));
    res.writeHead(200, {
      'Content-Type': file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.png')
            ? 'image/png'
            : file.endsWith('.jpg')
              ? 'image/jpeg'
              : 'text/html',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.TEST_BROWSER_EXECUTABLE }
    : {}),
});
let revision = 1;
let saved = fixture();
saved.toolPolicy.enabled = { web_search: true };
let skillWrites = 0;
let memoryWrites = 0;
let personaWrites = 0;
let routeTests = 0;
let memoryRecords = [];
const errors = [];
const execution = {
  id: 'exec-1',
  status: 'SUCCEEDED',
  platform: 'qq',
  sessionId: 'group-1',
  messageId: 'm1',
  senderId: 'u1',
  workspaceId: 'assistant',
  agent: 'assistant',
  provider: 'main',
  model: 'gpt-4.1',
  inputPreview: '你好',
  outputPreview: '你好，今天有什么安排？',
  startedAt: Date.now(),
  finishedAt: Date.now(),
  durationMillis: 450,
  eventCount: 2,
  promptTokens: 20,
  completionTokens: 10,
  totalTokens: 30,
};
const persona = {
  id: 'persona-1',
  workspaceId: 'platform',
  name: '冷静可靠',
  description: '',
  tone: '',
  boundaries: [],
  systemPromptTemplate: '耐心回答。',
  exampleDialogs: [],
  enabled: true,
  agentNames: [],
  createdAt: 0,
  updatedAt: 0,
};
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
await page.route('**/health', (route) =>
  route.fulfill({
    json: {
      status: 'UP',
      components: {},
      diagnostics: {},
      timestamp: Date.now(),
      uptimeMillis: 50000,
    },
  }),
);
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();
  const body = () => route.request().postDataJSON();
  let data;
  if (path === '/api/config/v3' && method === 'GET')
    data = {
      document: saved,
      revision: `r${revision}`,
      sourcePath: '/fixtures/config.json',
      diagnostics: [],
    };
  else if (path === '/api/config/v3/preview')
    data = { success: true, diagnostics: [], pendingRestartPaths: [] };
  else if (path === '/api/config/v3' && method === 'PUT') {
    assert.equal(body().expectedRevision, `r${revision}`);
    saved = JSON.parse(body().content);
    revision++;
    data = { success: true, diagnostics: [], pendingRestartPaths: [] };
  } else if (
    path === '/api/platforms' ||
    path === '/api/providers' ||
    path === '/api/conversations'
  )
    data = [];
  else if (path === '/api/plugins') data = { plugins: [], extensions: [] };
  else if (path === '/api/tools')
    data = [
      {
        name: 'web_search',
        description: '搜索网页',
        parameters: { properties: {}, required: [] },
        source: 'BUILTIN',
        riskLevel: 'EXTERNAL_READ',
        requiredCapabilities: [],
        defaultEnabled: true,
        effectiveEnabled: true,
        auditLog: false,
      },
    ];
  else if (path === '/api/personas' && method === 'GET') {
    assert.equal(url.searchParams.get('workspaceId'), 'platform');
    data = { personas: [persona] };
  } else if (path === '/api/personas' && method === 'POST') {
    personaWrites++;
    assert.equal(body().workspaceId, 'platform');
    data = { ...persona, ...body(), id: 'new-persona' };
  } else if (path.endsWith('/route-test')) {
    routeTests++;
    assert.equal(body().mentionsAny, true);
    data = {
      matched: true,
      routeId: 'group-command',
      action: 'COMMAND',
      agentId: null,
      normalizedText: '#help',
      permissionGroup: 'OPERATOR',
    };
  } else if (path.includes('/skills/document'))
    data = {
      name: 'hello',
      content: '# Hello\n\nRespond politely.',
      path: '/skills/hello/SKILL.md',
    };
  else if (path.endsWith('/skills') && method === 'GET')
    data = {
      items: [
        {
          name: 'hello',
          description: '基础问候',
          source: 'PLATFORM',
          libraryId: 'shared',
          path: '/skills/hello/SKILL.md',
          permissionGroup: 'OPERATOR',
          enabled: true,
        },
      ],
      diagnostics: [],
    };
  else if (path.endsWith('/skills') && method === 'PUT') {
    skillWrites++;
    assert.ok(body().content);
    data = { name: body().name, content: body().content, path: '/skills/hello/SKILL.md' };
  } else if (path.endsWith('/memories') && method === 'GET') data = { memories: memoryRecords };
  else if (path.endsWith('/memories') && method === 'POST') {
    memoryWrites++;
    const item = { ...body(), id: 'memory-1', workspaceId: 'platform', libraryId: 'shared' };
    memoryRecords.push(item);
    data = item;
  } else if (path === '/api/executions')
    data = { items: [execution], total: 1, limit: 30, offset: 0 };
  else if (path === '/api/executions/exec-1')
    data = {
      execution,
      events: [
        {
          executionId: 'exec-1',
          seq: 1,
          category: 'LLM',
          type: 'llm.response',
          timestamp: Date.now(),
          durationMillis: 200,
          data: { content: '模型输出', usage: { totalTokens: 30 } },
          truncated: false,
        },
      ],
      nextSeq: 1,
      hasMore: false,
    };
  else {
    errors.push(`Unhandled API ${method} ${path}`);
    return route.fulfill({ status: 404, json: { error: 'Unmocked API' } });
  }
  await route.fulfill({ json: data });
});
try {
  await page.goto(`${base}/agents`);
  await page.getByRole('tab', { name: '基础配置', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).waitFor();
  await page.getByLabel('显示名称', { exact: true }).fill('测试助手');
  await page.getByRole('button', { name: '预览校验', exact: true }).click();
  await page.getByRole('button', { name: '应用修订', exact: true }).click();
  await page.getByText('修订已保存并生效。', { exact: true }).waitFor();
  assert.equal(saved.agents[0].displayName, '测试助手');
  await page.getByLabel('Temperature', { exact: true }).fill('4');
  assert.equal(
    await page.getByRole('button', { name: '预览校验', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('Temperature', { exact: true }).fill('0.7');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: process.env.DASHBOARD_SCREENSHOT || '/tmp/priestess-v3-agent-dashboard.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByRole('tab', { name: '基础配置', exact: true }).click();
  await page.getByLabel('Agent ID', { exact: true }).fill('assistant');
  assert.equal(
    await page.getByLabel('Agent ID', { exact: true }).getAttribute('readonly'),
    null,
    'new duplicate IDs remain editable',
  );
  await page.getByLabel('Agent ID', { exact: true }).fill('agent-smoke');
  await page.getByLabel('模型', { exact: true }).fill('test-model');
  await page.getByRole('button', { name: '预览校验', exact: true }).click();
  await page.getByRole('button', { name: '应用修订', exact: true }).click();
  await page.getByText('修订已保存并生效。', { exact: true }).waitFor();
  assert.equal(saved.agents.length, 2);
  await page.getByRole('link', { name: 'IM 与路由', exact: true }).click();
  await page.getByRole('tab', { name: '消息路由', exact: true }).click();
  await page.getByRole('button', { name: '运行路由测试', exact: true }).click();
  await page.getByText('命中 group-command', { exact: true }).waitFor();
  assert.equal(routeTests, 1);
  await page.getByRole('tab', { name: '连接', exact: true }).click();
  await page.getByLabel('HTTP 端口', { exact: true }).fill('3002');
  await page.getByRole('tab', { name: '消息路由', exact: true }).click();
  await page.getByRole('button', { name: '下移第 1 条路由', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '运行路由测试', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: '预览校验', exact: true }).click();
  await page.getByRole('button', { name: '应用修订', exact: true }).click();
  await page.getByText('修订已保存并生效。', { exact: true }).waitFor();
  assert.equal(saved.ims[0].routes[0].action.type, 'AGENT');
  assert.equal(saved.ims[0].settings.port, '3002', 'string-valued adapter settings stay strings');
  await page.goto(`${base}/resources/skills`);
  await page.getByRole('button', { name: '读取技能', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('SKILL.md', { exact: true }).fill('# Hello\nUpdated');
  await page.getByRole('button', { name: '保存文档', exact: true }).click();
  await page.getByText('技能文档已保存。').waitFor();
  assert.equal(skillWrites, 1);
  await page.goto(`${base}/resources/memories`);
  await page.getByRole('button', { name: '新增记录', exact: true }).click();
  await page.getByLabel('内容', { exact: true }).fill('偏好简洁回复');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByText('偏好简洁回复', { exact: true }).waitFor();
  assert.equal(memoryWrites, 1);
  await page.goto(`${base}/resources/personas`);
  await page.locator('.persona-page-header').getByRole('button', { name: '新建人格', exact: true }).click();
  await page.getByLabel('人格名称', { exact: true }).fill('测试人格');
  await page.getByRole('button', { name: '保存人格', exact: true }).click();
  await page.getByText('人格已保存。', { exact: true }).waitFor();
  assert.equal(personaWrites, 1);
  await page.goto(`${base}/logs/executions`);
  await page.getByRole('button', { name: '查看链路', exact: true }).click();
  await page.getByText('1 · LLM · llm.response', { exact: true }).waitFor();
  const responseEvent = page.locator('.v3-event').filter({ hasText: '1 · LLM · llm.response' });
  const responseDisclosure = responseEvent.locator('details.event-disclosure');
  assert.equal(await responseDisclosure.getAttribute('open'), null, 'event payloads start collapsed');
  await responseDisclosure.locator(':scope > summary').click();
  await responseEvent.locator('.event-content > pre.v3-event-data').waitFor({ state: 'visible' });
  assert.equal(await responseEvent.locator('.event-content > pre.v3-event-data').innerText(), '模型输出');
  await page.getByRole('button', { name: '读取最新事件', exact: true }).click();
  assert.equal(await page.getByText('1 · LLM · llm.response', { exact: true }).count(), 1);
  await page.goto(`${base}/config`);
  await page.getByLabel('平台资源目录', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.shell-sidebar').getBoundingClientRect().right <= 0,
  );
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.shell-sidebar').getBoundingClientRect().right <= 0,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'mobile page must not overflow horizontally',
  );
  await page.screenshot({ path: '/tmp/priestess-v3-system-mobile.png', fullPage: true });
  await page.goto(`${base}/agents`);
  await page.getByRole('tab', { name: '技能与工具', exact: true }).click();
  await page.getByRole('button', { name: '读取技能', exact: true }).click();
  await page.getByText('hello', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'populated Skill records must remain within the mobile viewport');
  assert.deepEqual(errors, []);
  console.log(
    'V3 browser smoke passed: Agent save/validation, ordered route preview, Skill edit, memory/persona create, execution detail, mobile layout.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
