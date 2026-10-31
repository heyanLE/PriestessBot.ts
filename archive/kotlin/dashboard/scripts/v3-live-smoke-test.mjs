import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Intentionally restricted to the disposable local integration fixture.
const base = process.env.QA_BACKEND_URL || 'http://127.0.0.1:18080';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.TEST_BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
let step = 'read fixture';
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
const initial = await (await context.request.get(`${base}/api/config/v3`)).json();
assert.equal(
  await realpath(initial.sourcePath),
  '/private/tmp/astrbot-v3-qa/config.json',
  'live mutation test only supports the disposable QA configuration',
);
assert.equal(
  initial.document.ims.filter((im) => im.enabled).length,
  0,
  'do not run this fixture with active IM connections',
);
// Serve only current production frontend files. All /api and /health requests reach the real backend.
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/health' ||
    url.pathname.startsWith('/ws/')
  )
    return route.continue();
  const name =
    url.pathname.startsWith('/assets/') && !url.pathname.includes('..')
      ? url.pathname.slice(1)
      : 'index.html';
  const contentType = name.endsWith('.js')
    ? 'application/javascript'
    : name.endsWith('.css')
      ? 'text/css'
      : name.endsWith('.jpg')
        ? 'image/jpeg'
        : name.endsWith('.png')
          ? 'image/png'
          : 'text/html';
  try {
    await route.fulfill({ body: await readFile(resolve(root, 'dist', name)), contentType });
  } catch {
    await route.fulfill({ status: 404 });
  }
});
const snapshot = async () =>
  (await (await context.request.get(`${base}/api/config/v3`)).json()).document;
async function saveConfiguration() {
  const preview = page.waitForResponse((response) =>
    response.url().endsWith('/api/config/v3/preview'),
  );
  await page.getByRole('button', { name: '预览校验', exact: true }).click();
  const previewBody = await (await preview).json();
  assert.equal(previewBody.success, true, JSON.stringify(previewBody.diagnostics));
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/config/v3') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '应用修订', exact: true }).click();
  const savedBody = await (await saved).json();
  assert.equal(savedBody.success, true, JSON.stringify(savedBody.diagnostics));
  await page.getByText(/^修订已保存/).waitFor();
}
async function createOrSelect(path, list, id, create) {
  await page.goto(`${base}${path}`);
  const doc = await snapshot();
  if (doc[list].some((item) => item.id === id)) {
    await page.locator('.v3-entity-list button').filter({ hasText: id }).click();
    return false;
  }
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await create();
  await saveConfiguration();
  return true;
}
try {
  step = 'canonical QA resource paths';
  if ((await snapshot()).platformDirectory.startsWith('/tmp/')) {
    await page.goto(`${base}/config`);
    await page
      .getByLabel('平台资源目录', { exact: true })
      .fill('/private/tmp/astrbot-v3-qa/platform');
    await saveConfiguration();
  }
  step = 'LLM connection';
  await createOrSelect('/llms', 'llms', 'qa-llm', async () => {
    await page.getByLabel('ID', { exact: true }).fill('qa-llm');
    await page.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:18081/v1');
  });
  step = 'Agent creation';
  await createOrSelect('/agents', 'agents', 'qa-agent', async () => {
    await page.getByRole('tab', { name: '基础配置', exact: true }).click();
    await page.getByLabel('Agent ID', { exact: true }).fill('qa-agent');
    await page.getByLabel('显示名称', { exact: true }).fill('qa-agent');
    await page.getByRole('tab', { name: '运行参数', exact: true }).click();
    await page
      .getByRole('textbox', { name: /^配置目录/ })
      .fill('/private/tmp/astrbot-v3-qa/agents/qa-agent/config');
    await page
      .getByRole('textbox', { name: /^临时目录/ })
      .fill('/private/tmp/astrbot-v3-qa/agents/qa-agent/temp');
    await page.getByRole('tab', { name: '基础配置', exact: true }).click();
    await page.getByRole('combobox', { name: /^LLM 连接/ }).selectOption('qa-llm');
    await page.getByLabel('模型', { exact: true }).fill('qa-model');
    await page.getByLabel('系统指令', { exact: true }).fill('You are the qa-agent. Reply briefly.');
    await page.getByRole('tab', { name: '技能与工具', exact: true }).click();
    for (const toggle of await page.getByRole('switch').all()) {
      if (await toggle.isEnabled()) await toggle.setChecked((await toggle.getAttribute('aria-label')) === 'health_check 开启');
    }
  });
  await page.getByRole('tab', { name: '运行参数', exact: true }).click();
  await page
    .getByRole('textbox', { name: /^配置目录/ })
    .fill('/private/tmp/astrbot-v3-qa/agents/qa-agent/config');
  await page
    .getByRole('textbox', { name: /^临时目录/ })
    .fill('/private/tmp/astrbot-v3-qa/agents/qa-agent/temp');
  if (await page.getByText('有未保存修改', { exact: true }).count()) await saveConfiguration();
  step = 'platform Skill library';
  await createOrSelect('/resources/skills', 'skillLibraries', 'qa-skills', async () => {
    await page.getByLabel('ID', { exact: true }).fill('qa-skills');
    await page.getByLabel('名称', { exact: true }).fill('qa-skills');
    await page.getByLabel('库目录', { exact: false }).fill('skills/qa-skills');
  });
  await page.getByRole('button', { name: '新建 Skill', exact: true }).click();
  await page.getByLabel('技能名称', { exact: true }).fill('qa-greeting');
  await page
    .getByLabel('SKILL.md', { exact: true })
    .fill('---\nname: qa-greeting\ndescription: QA greeting skill\n---\n\nSay hello briefly.');
  var skillResponse = page.waitForResponse(
    (response) => response.url().endsWith('/skills') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '保存文档', exact: true }).click();
  var skillResult = await skillResponse;
  assert.equal(skillResult.ok(), true, await skillResult.text());
  await page.getByText('技能文档已保存。', { exact: true }).waitFor();
  assert.ok(
    (
      await (await context.request.get(`${base}/api/skill-libraries/qa-skills/skills`)).json()
    ).items.some((item) => item.name === 'qa-greeting'),
  );
  step = 'memory library';
  await createOrSelect('/resources/memories', 'memoryLibraries', 'qa-memory', async () => {
    await page.getByLabel('ID', { exact: true }).fill('qa-memory');
    await page.getByLabel('名称', { exact: true }).fill('qa-memory');
  });
  await page.getByRole('button', { name: '新增记录', exact: true }).click();
  await page.getByLabel('内容', { exact: true }).fill('QA 用户偏好简洁回复。');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByText('QA 用户偏好简洁回复。', { exact: true }).first().waitFor();
  step = 'persona library';
  await page.goto(`${base}/resources/personas`);
  const personaList = (
    await (await context.request.get(`${base}/api/personas?workspaceId=platform`)).json()
  ).personas;
  if (!personaList.some((item) => item.name === 'qa-persona')) {
    await page.locator('.persona-page-header').getByRole('button', { name: '新建人格', exact: true }).click();
    await page.getByLabel('人格名称', { exact: true }).fill('qa-persona');
    await page.getByLabel('语气', { exact: true }).fill('简洁、友善');
    await page.getByLabel('系统提示词', { exact: true }).fill('QA persona: be concise.');
    await page.getByRole('button', { name: '添加对话', exact: true }).click();
    await page.getByLabel('用户', { exact: true }).fill('你好');
    await page.getByLabel('助手', { exact: true }).fill('你好，很高兴见到你。');
    await page.getByRole('button', { name: '保存人格', exact: true }).click();
    await page.getByText('人格已保存。').waitFor();
  }
  step = 'Agent resource assembly';
  await page.goto(`${base}/agents`);
  await page.locator('.v3-entity-list button').filter({ hasText: 'qa-agent' }).click();
  await page.getByRole('tab', { name: '技能与工具', exact: true }).click();
  await page
    .locator('.v3-toggle-row')
    .filter({ hasText: 'qa-skills' })
    .locator('input[type=checkbox]')
    .first()
    .check();
  await page.getByRole('tab', { name: '记忆与人格', exact: true }).click();
  await page.getByLabel('qa-memory', { exact: true }).check();
  await page.getByRole('combobox', { name: /^记忆写入库/ }).selectOption('qa-memory');
  await page.getByRole('combobox', { name: /^人格预设/ }).selectOption({ label: 'qa-persona' });
  if (await page.getByText('有未保存修改', { exact: true }).count()) await saveConfiguration();
  step = 'temporary Agent Skill';
  await page.getByRole('tab', { name: '技能与工具', exact: true }).click();
  await page.getByRole('button', { name: '新建 Skill', exact: true }).click();
  await page.getByLabel('技能名称', { exact: true }).fill('qa-temp');
  await page.getByRole('combobox', { name: /^来源/ }).selectOption('TEMPORARY');
  await page
    .getByLabel('SKILL.md', { exact: true })
    .fill(
      '---\nname: qa-temp\ndescription: QA temporary skill\n---\n\nUse for temporary QA checks.',
    );
  var skillResponse = page.waitForResponse(
    (response) => response.url().endsWith('/skills') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '保存文档', exact: true }).click();
  var skillResult = await skillResponse;
  assert.equal(skillResult.ok(), true, await skillResult.text());
  await page.getByText('技能文档已保存。').waitFor();
  const skills = (await (await context.request.get(`${base}/api/agents/qa-agent/skills`)).json())
    .items;
  assert.ok(skills.some((item) => item.name === 'qa-greeting' && item.source === 'PLATFORM'));
  assert.ok(skills.some((item) => item.name === 'qa-temp' && item.source === 'TEMPORARY'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/priestess-v3-live-agent.png', fullPage: true });
  step = 'disabled IM and routing';
  await createOrSelect('/ims', 'ims', 'qa-im', async () => {
    await page.getByRole('tab', { name: '连接', exact: true }).click();
    await page.getByLabel('ID', { exact: true }).first().fill('qa-im');
    await page.getByLabel('名称', { exact: true }).fill('qa-im');
    await page.getByLabel('启用连接', { exact: true }).uncheck();
  });
  await page.getByRole('tab', { name: '消息路由', exact: true }).click();
  const routePreview = page.waitForResponse((response) => response.url().endsWith('/route-test'));
  await page.getByRole('button', { name: '运行路由测试', exact: true }).click();
  const routeResult = await (await routePreview).json();
  assert.equal(routeResult.matched, true, JSON.stringify(routeResult));
  assert.equal(routeResult.action, 'COMMAND');
  await page
    .locator('.notice')
    .filter({ hasText: /命中|未命中/ })
    .waitFor();
  console.log(
    'Route result:',
    await page
      .locator('.notice')
      .filter({ hasText: /命中|未命中/ })
      .innerText(),
  );
  step = 'real Agent call and persisted execution';
  const chatResponse = await context.request.post(`${base}/api/agent/chat`, {
    data: {
      message: 'trace-tool QA 用户偏好简洁回复',
      agentId: 'qa-agent',
      sessionId: `qa-ui-execution-${Date.now()}`,
      userId: 'qa-user',
    },
    timeout: 60000,
  });
  const chat = await chatResponse.json();
  assert.equal(chatResponse.ok(), true, JSON.stringify(chat));
  assert.equal(chat.status, 'FINAL', JSON.stringify(chat));
  await page.goto(`${base}/logs/executions`);
  await page.getByLabel('Agent', { exact: true }).fill('qa-agent');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '查看链路', exact: true }).first().click();
  await page.getByRole('heading', { name: '执行详情', exact: true }).waitFor();
  await page.locator('.v3-event').first().waitFor();
  const eventText = await page.locator('.v3-event').allTextContents();
  assert.ok(eventText.some((text) => text.includes('LLM')));
  assert.ok(eventText.some((text) => text.includes('TOOL')));
  for (const category of ['LLM', 'TOOL']) {
    const event = page.locator('.v3-event').filter({
      has: page.locator('.event-type').filter({ hasText: new RegExp(` · ${category} · `) }),
    }).first();
    const disclosure = event.locator('details.event-disclosure');
    assert.equal(await disclosure.getAttribute('open'), null, `${category} payload starts collapsed`);
    await disclosure.locator(':scope > summary').click();
    await event.locator('.event-content').waitFor({ state: 'visible' });
    const firstMessage = event.locator('details.message-disclosure').first();
    if (await firstMessage.count()) {
      await firstMessage.locator(':scope > summary').click();
      await firstMessage.locator('pre.v3-event-data').first().waitFor({ state: 'visible' });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/priestess-v3-live-executions.png', fullPage: true });
  const saved = await snapshot();
  assert.equal(saved.ims.find((im) => im.id === 'qa-im').enabled, false);
  const agent = saved.agents.find((item) => item.id === 'qa-agent');
  assert.deepEqual(agent.memory.libraryIds, ['qa-memory']);
  assert.ok(agent.personaId);
  assert.deepEqual(errors, []);
  console.log(
    'Real backend UI smoke passed: revisioned LLM/Agent/resource CRUD, Skill documents, memory/persona assembly, disabled IM preview, actual mock-model tool execution and persisted trace UI.',
  );
} catch (error) {
  console.error('Failed step:', step);
  console.error('Form labels:', await page.locator('label').allTextContents());
  console.error('Visible notices:', await page.locator('.notice').allTextContents());
  await page
    .screenshot({ path: '/tmp/priestess-v3-live-failure.png', fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
