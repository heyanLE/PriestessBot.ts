import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSnapshotSchema, RunsResponseSchema } from '../../typescript/packages/contracts/src/index.ts';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.TS_TEST_BASE || 'http://127.0.0.1:8081';
const token=process.env.TS_TEST_TOKEN;
if(!token)throw new Error('TS_TEST_TOKEN is required; use a dedicated isolated test server.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=ConfigSnapshotSchema.parse(await fetch(`${base}/api/ts/config`,{headers:{Authorization:`Bearer ${token}`}}).then(response=>response.json()));
const initialRuns=RunsResponseSchema.parse(await fetch(`${base}/api/ts/runs`,{headers:{Authorization:`Bearer ${token}`}}).then(response=>response.json())).runs;
assert.equal(initialRuns.filter(run=>['running','queued','paused'].includes(run.status)).length,0,'The dedicated live-test server must have no active or awaiting-approval runs before publishing fixture configuration.');
const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_EXECUTABLE?{executablePath:process.env.TEST_BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];const failures=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes('/api/ts/')&&response.status()>=400)failures.push(`${response.status()} ${response.url()}`);});
const marker=`UI-${Date.now()}`;let published=false;

const paths = { '概览':'/', 'Agent':'/agents', '模型服务':'/providers', '人格库':'/personas', '会话管理':'/sessions', '消息路由':'/flow', '知识库':'/knowledge-base', '扩展':'/extensions', '权限管理':'/permissions', '系统设置':'/settings', '长期记忆':'/memories', '对话':'/chat', '执行记录':'/runs', '执行环境':'/execution', '机器人':'/platforms' };
function navigationLink(label) { return page.getByRole('navigation',{name:'功能搜索结果'}).getByRole('link',{name:new RegExp(`^${label}`)}); }
async function assertActiveNavigation() { await page.locator('.shell-topbar h1').waitFor();assert.ok((await page.locator('.shell-topbar h1').innerText()).trim());assert.equal(await page.locator('.ts-primary-navigation [aria-current="page"]').count(),1); }
async function publishLiveConfiguration() {
  await page.getByRole('button',{name:'发布运行配置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'发布运行配置',exact:true});await dialog.waitFor();
  await dialog.getByText('当前有 0 个运行或排队任务，0 个待审批任务。发布会中断运行中和排队任务。旧审批会失效。服务端会重新配置运行服务。',{exact:true}).waitFor();
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/ts/config'&&value.request().method()==='PUT');
  await dialog.getByRole('button',{name:'确认发布',exact:true}).click();assert.equal((await response).ok(),true);published=true;
  await dialog.waitFor({state:'hidden'});await page.getByText('运行配置已发布并应用。',{exact:true}).waitFor();
}
async function withExpectedDialog(action, messagePattern, accept = true) {
  const handled = page.waitForEvent('dialog', { timeout: 5000 }).then(async dialog => {
    try { assert.equal(dialog.type(), 'confirm'); assert.match(dialog.message(), messagePattern); }
    catch (error) { await dialog.dismiss(); throw error; }
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
  await Promise.all([handled, action()]);
}

async function navigate(label) {
  const path=paths[label];assert.ok(path,`Unknown navigation label ${label}`);
  const menu=page.getByRole('button',{name:'打开导航',exact:true});if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
  await page.getByRole('searchbox',{name:'查找功能',exact:true}).fill(label);
  const link=navigationLink(label);assert.equal(await link.getAttribute('href'),path);await link.click();
  await page.waitForURL(url=>url.pathname===path);
  if(label==='Agent')await page.locator('.agent-workbench').waitFor();else await page.getByRole('heading',{name:label==='执行环境'?'后台进程':label,exact:true,level:1}).waitFor();
}
async function openDetails(label) {
  const summary = page.locator('summary').filter({ hasText: label });
  if (!await summary.locator('..').evaluate(element => element.open)) await summary.click();
}

async function agentNameField() {
  await openDetails('基本信息');
  return page.getByLabel('Agent 名称',{exact:true});
}

try{
await page.goto(base);await page.getByLabel('管理令牌',{exact:true}).fill(token);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'欢迎回来',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'欢迎回来',exact:true}).waitFor();assert.equal(await page.getByLabel('管理令牌',{exact:true}).count(),0);assert.deepEqual((await page.getByRole('navigation',{name:'运行控制台导航'}).getByRole('link').allTextContents()).map(value=>value.trim()),['工作台','Agent','机器人','资源库','设置']);assert.equal(await page.getByRole('navigation',{name:'页面分区'}).getByRole('link',{name:'会话',exact:true}).getAttribute('href'),'/sessions');assert.equal(await page.getByRole('navigation',{name:'页面分区'}).getByRole('link',{name:'任务与审批',exact:true}).getAttribute('href'),'/runs');await navigate('Agent');
const firstAgent=snapshot.config.agents[0];assert.ok(firstAgent);assert.equal(await (await agentNameField()).inputValue(),firstAgent.displayName);
await page.getByRole('navigation',{name:'Agent 设置'}).getByRole('button',{name:'工具与资料',exact:true}).waitFor();
await page.getByRole('navigation',{name:'Agent 设置'}).getByRole('button',{name:'执行与审批',exact:true}).click();
await openDetails('查看三种运行态的固定权限');
assert.equal(await page.getByRole('region',{name:'固定运行态权限',exact:true}).getByRole('checkbox').count(),0);
assert.equal(await page.getByRole('heading',{name:'Agent 能力上限',exact:true}).count(),0);
await navigate('人格库');assert.equal(await page.getByRole('navigation',{name:'文件夹',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'人格分配',exact:true}).count(),0);
await navigate('消息路由');await page.getByRole('heading',{name:'消息处理流程'}).waitFor();
await page.getByRole('button',{name:'07 Agent 执行'}).click();await page.getByLabel('执行超时（毫秒）').fill(String(snapshot.config.flow.execution.timeoutMs+1));await navigate('系统设置');await page.getByRole('button',{name:'检查配置',exact:true}).click();await page.getByText('配置校验通过，可以发布。').waitFor();await publishLiveConfiguration();await navigate('消息路由');
await openDetails('模拟消息路由');await page.getByRole('button',{name:'模拟草稿',exact:true}).click();await page.locator('.ts-simulation-result').waitFor();assert.ok(await page.locator('.ts-simulation-result li').count()>=6);await page.getByLabel('会话类型',{exact:false}).selectOption('group');await openDetails('模拟消息路由');await page.getByRole('button',{name:'模拟草稿',exact:true}).click();await page.locator('.ts-simulation-result').filter({hasText:'ignored'}).waitFor();await page.getByLabel('提及机器人').check();await openDetails('模拟消息路由');await page.getByRole('button',{name:'模拟草稿',exact:true}).click();await page.locator('.ts-simulation-result').filter({hasText:'agent · assistant'}).waitFor();await page.getByLabel('会话类型',{exact:false}).selectOption('private');
await navigate('长期记忆');await page.getByLabel('新增记忆').fill(`Live memory ${marker}`);await page.getByRole('button',{name:'保存记忆',exact:true}).click();await page.getByText(`Live memory ${marker}`,{exact:true}).waitFor();const memoryCard=page.locator('article').filter({hasText:`Live memory ${marker}`});await memoryCard.getByRole('button',{name:'编辑记忆',exact:true}).click();await page.getByLabel('编辑记忆内容').fill(`Updated live memory ${marker}`);await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByText(`Updated live memory ${marker}`,{exact:true}).waitFor();await page.getByLabel('新增记忆').fill(`Updated live memory ${marker}`);await page.getByRole('button',{name:'保存记忆',exact:true}).click();await page.getByText(`Updated live memory ${marker}`,{exact:true}).nth(1).waitFor();await withExpectedDialog(()=>page.getByRole('button',{name:'整理当前作用域',exact:true}).click(),/^整理 Agent assistant 在 dashboard \/ 私聊 dashboard \/ 发送者 local 的记忆？将合并相同内容并清理过期记录。其他范围不受影响。$/);await page.getByText('当前作用域记忆已整理。',{exact:true}).waitFor();assert.equal(await page.getByText(`Updated live memory ${marker}`,{exact:true}).count(),1);
await navigate('知识库');await page.getByLabel('导入文件（最大 10 MiB）').setInputFiles({name:`${marker}.md`,mimeType:'text/markdown',buffer:Buffer.from(`# ${marker}\n路由可视化以 Agent 为最终执行目标。`)});await page.getByText(`${marker}.md`,{exact:true}).waitFor();await page.getByLabel('检索问题').fill(marker);await page.getByRole('button',{name:'检索',exact:true}).click();await page.locator('article').filter({hasText:marker}).filter({hasText:'路由可视化以 Agent 为最终执行目标。'}).waitFor();
await page.getByRole('region',{name:'后台资源任务'}).getByRole('button',{name:'刷新任务',exact:true}).click();await page.getByRole('region',{name:'后台资源任务'}).locator('tbody tr').first().waitFor();
await navigate('对话');await page.getByRole('button',{name:'新会话',exact:true}).click();await page.getByLabel('附件',{exact:true}).setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8s8AAAAASUVORK5CYII=','base64')});await page.getByText('pixel.png',{exact:false}).waitFor();await page.getByLabel('消息',{exact:true}).fill('/help');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('log',{name:'聊天记录'}).locator('.assistant').getByText('/help',{exact:false}).first().waitFor();await page.reload();await page.getByRole('log',{name:'聊天记录'}).locator('.assistant').getByText('/help',{exact:false}).first().waitFor();await page.getByRole('button',{name:'查看执行详情',exact:true}).click();await page.waitForURL(url=>url.pathname==='/runs');const helpRunId=new URL(page.url()).searchParams.get('run');assert.ok(helpRunId);await navigate('对话');await page.getByRole('log',{name:'聊天记录'}).locator('.assistant').getByText('/help',{exact:false}).first().waitFor();
await mkdir(resolve(root,'.build/ts-ui'),{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await assertActiveNavigation();await page.mouse.move((page.viewportSize()?.width ?? 1440)-5,5);await page.screenshot({animations:'disabled',path:resolve(root,'.build/ts-ui/live-chat-desktop.png'),fullPage:true});
await navigate('执行环境');await page.getByLabel('所属运行',{exact:true}).selectOption(helpRunId);await page.getByRole('heading',{name:'执行环境能力',exact:true}).waitFor();await page.getByText('该运行暂无后台进程',{exact:true}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));await assertActiveNavigation();await page.mouse.move((page.viewportSize()?.width ?? 1440)-5,5);await page.screenshot({animations:'disabled',path:resolve(root,'.build/ts-ui/live-execution-desktop.png'),fullPage:true});
await navigate('机器人');await page.getByRole('region',{name:'机器人工作空间'}).getByRole('button',{name:'刷新状态',exact:true}).click();if(snapshot.config.platforms.length===0)await page.getByRole('heading',{name:'连接你的第一个机器人',exact:true}).waitFor();else assert.equal(await page.getByRole('complementary',{name:'机器人实例'}).getByRole('button').count(),snapshot.config.platforms.length);
await navigate('消息路由');await openDetails('模拟消息路由');await page.getByRole('button',{name:'模拟草稿',exact:true}).click();await page.locator('.ts-simulation-result').filter({hasText:'dashboard/private'}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));await assertActiveNavigation();await page.mouse.move((page.viewportSize()?.width ?? 1440)-5,5);await page.screenshot({animations:'disabled',path:resolve(root,'.build/ts-ui/live-route-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await assertActiveNavigation();await page.mouse.move((page.viewportSize()?.width ?? 1440)-5,5);await page.screenshot({animations:'disabled',path:resolve(root,'.build/ts-ui/live-route-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS: real API config validate/publish, flow, memory edit/consolidate, knowledge import/search/jobs, artifact image, /help run/events, environment/process lists, platforms, desktop/mobile');
}catch(error){console.error('Visible errors:',await page.locator('[role="alert"]').allTextContents());throw error;}finally{
await browser.close();
if(published){const current=ConfigSnapshotSchema.parse(await fetch(`${base}/api/ts/config`,{headers:{Authorization:`Bearer ${token}`}}).then(response=>response.json()));if(current.revision===snapshot.revision+1){const restored=await fetch(`${base}/api/ts/config/rollback`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({revision:snapshot.revision,expectedRevision:current.revision})});assert.equal(restored.ok,true);console.log('Restored starting configuration as a new revision.');}else console.log('Configuration changed elsewhere; did not overwrite concurrent changes.');}
}
