declare const lucide: { createIcons(options: { attrs: { width: number; height: number } }): void } | undefined;

(() => {
  type Page = 'agent' | 'bots' | 'resources' | 'settings' | 'workbench';
  type Tab = 'persona' | 'tools' | 'context' | 'permissions';
  type OperatorState = 'normal' | 'senior' | 'elite';
  type Platform = 'NapCat' | 'Telegram' | '微信';
  interface Example { user: string; assistant: string }
  interface AgentDraft {
    personaName: string; persona: string; examples: Example[]; model: string; extra: string;
    search: boolean; command: boolean; files: boolean; knowledge: boolean;
    memory: boolean; compress: boolean; turns: number; state: OperatorState; approval: boolean;
  }
  interface Message { role: 'user' | 'assistant'; content: string; trace?: string[] }
  interface Robot { name: string; platform: Platform; trigger: string; scope: string; state: string; enabled: boolean }
  interface Wizard { step: number; platform: Platform; name: string; address: string; checked: boolean; trigger: string; scope: string; state: OperatorState }
  const root = document.getElementById('priestess-prototype');
  if (!(root instanceof HTMLElement)) throw new Error('Prototype root missing');
  const app = root;
  function get(selector: string): HTMLElement {
    const result = app.querySelector(selector);
    if (!(result instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
    return result;
  }
  function inputValue(selector: string): string {
    const element = get(selector);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
    throw new Error(`Not an input: ${selector}`);
  }
  function escape(text: string | number): string { return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
  function icon(name: string): string { return `<i data-lucide="${name}" aria-hidden="true"></i>`; }
  function icons(): void { if (typeof lucide !== 'undefined') lucide.createIcons({ attrs: { width: 19, height: 19 } }); }
  const logo = app.querySelector('.px-brand img');
  const logoUrl = logo instanceof HTMLImageElement ? logo.src : '';
  const initial: AgentDraft = {
    personaName: '普瑞赛斯', persona: '你是普瑞赛斯，一位冷静、可靠的助手。\n回答直接清楚，必要时主动查证。\n执行任务后，根据实际结果说明完成情况。',
    examples: [{ user: '帮我查一下这个型号的显示器。', assistant: '可以。把型号或图片发给我，我会核对参数和价格。' }],
    model: 'DeepSeek Chat', extra: '', search: true, command: false, files: true, knowledge: false,
    memory: true, compress: true, turns: 20, state: 'normal', approval: true,
  };
  let draft = structuredClone(initial);
  let published = structuredClone(initial);
  let page: Page = 'agent';
  let tab: Tab = 'persona';
  let revision = 1;
  let attachment = '';
  let chatBusy = false;
  let chatGeneration = 0;
  const models = ['DeepSeek Chat', 'GPT-4.1', '本地模型（示例）'];
  const stateLabels: Record<OperatorState, string> = { normal: '普通干员', senior: '资深干员', elite: '高级资深干员' };
  let messages: Message[] = [
    { role: 'user', content: '帮我搜一下这款显示器' },
    { role: 'assistant', content: '请发来型号或图片，我会先确认具体款式，再核对参数。', trace: ['示例消息 → 普瑞赛斯', '人格：普瑞赛斯；模型：DeepSeek Chat', '当前信息不足，先确认型号', '这是预设模拟回复，未调用模型或搜索服务'] },
  ];
  const robots: Robot[] = [{ name: 'QQ 日常助手', platform: 'NapCat', trigger: '提及或回复机器人', scope: '示例群 10001', state: '普通干员', enabled: true }];
  let wizard: Wizard | null = null;
  let connectionTestGeneration = 0;
  let connectionTestBusy = false;
  function isDirty(): boolean { return JSON.stringify(draft) !== JSON.stringify(published); }
  function notice(text: string, error = false): void {
    const box = get('#px-notice'); box.textContent = text; box.dataset['error'] = String(error); box.hidden = false;
  }
  function syncDraftStatus(): void {
    const dirty = isDirty();
    const status = get('#px-draft-status'); status.textContent = dirty ? '有未发布修改' : `当前已发布 · v${revision}`; status.dataset['dirty'] = String(dirty);
    for (const id of ['#px-publish', '#px-discard']) { const button = get(id); if (button instanceof HTMLButtonElement) button.disabled = !dirty; }
    get('#px-test-config').textContent = `${draft.model} · ${stateLabels[draft.state]} · ${draft.search ? '可搜索' : '搜索未启用'} · 仅模拟`;
  }
  function fieldsChanged(): string[] {
    const changes: string[] = [];
    if (draft.persona !== published.persona || draft.personaName !== published.personaName) changes.push(`人格设定：${draft.personaName}`);
    if (JSON.stringify(draft.examples) !== JSON.stringify(published.examples)) changes.push(`示例对话：${draft.examples.length} 组`);
    if (draft.model !== published.model) changes.push(`模型：${published.model} → ${draft.model}`);
    if (draft.extra !== published.extra) changes.push('高级补充指令');
    if (['search', 'command', 'files', 'knowledge'].some(key => {
      switch (key) { case 'search': return draft.search !== published.search; case 'command': return draft.command !== published.command; case 'files': return draft.files !== published.files; default: return draft.knowledge !== published.knowledge; }
    })) changes.push('工具与知识库绑定');
    if (draft.memory !== published.memory || draft.compress !== published.compress || draft.turns !== published.turns) changes.push('上下文与记忆策略');
    if (draft.state !== published.state || draft.approval !== published.approval) changes.push(`权限与审批：${stateLabels[draft.state]}`);
    return changes;
  }
  function checkbox(name: string, label: string, description: string, checked: boolean): string {
    return `<label class="px-tool-row"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span><strong>${label}</strong><small>${description}</small></span></label>`;
  }
  function option(value: string, selected: string, label = value): string { return `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`; }
  function renderEditor(): void {
    get('#px-editor').innerHTML = tab === 'persona' ? `
      <h2>人格</h2>
      <div class="px-field-row"><label for="px-persona-choice">当前人格</label><button id="px-persona-choice" type="button" data-action="personas">${escape(draft.personaName)} · 当前 Agent 专用 ${icon('chevron-down')}</button><button class="px-text-button" type="button" data-action="personas">从人格库选择</button></div>
      <label>角色设定<textarea name="persona" rows="5" maxlength="4000">${escape(draft.persona)}</textarea></label>
      <div class="px-form-section"><div class="px-section-heading"><h3>示例对话</h3><button type="button" class="px-text-button px-push-right" data-action="add-example">${icon('plus')}添加示例</button></div>
      ${draft.examples.length ? draft.examples.map((example, index) => `<div class="px-example"><div class="px-example-fields"><label>用户<textarea rows="1" name="example-user" data-index="${index}" aria-label="示例 ${index + 1} 用户" maxlength="1000">${escape(example.user)}</textarea></label><label>助手<textarea rows="2" name="example-assistant" data-index="${index}" aria-label="示例 ${index + 1} 助手" maxlength="1500">${escape(example.assistant)}</textarea></label></div><div class="px-example-footer"><button type="button" class="px-quiet" data-action="remove-example" data-index="${index}">删除这组</button></div></div>`).join('') : '<p class="px-muted">还没有示例。添加一组对话，说明你希望的回复方式。</p>'}</div>
      <div class="px-form-section"><h3>模型</h3><div class="px-field-row"><label for="px-model">选择模型</label><select id="px-model" name="model">${models.map(model => option(model, draft.model)).join('')}</select><button type="button" class="px-text-button" data-action="models">管理连接</button></div><p class="px-muted">用于回复与工具调用。</p></div>
      <details><summary>高级补充指令</summary><label><span class="px-muted">在角色设定之外，补充任务与执行要求。</span><textarea name="extra" rows="3" maxlength="1500" placeholder="例如：任务结束时说明实际完成情况。">${escape(draft.extra)}</textarea></label></details>
    ` : tab === 'tools' ? `
      <div class="px-section-heading"><h2>能力与资料</h2></div><p class="px-muted">选择这个 Agent 可以使用的工具。实际调用仍受当前发送者权限限制。</p>
      ${checkbox('search', '网络搜索', '检索网页与读取正文 · 使用示例搜索连接', draft.search)}
      ${checkbox('files', '文件与群文件', '读取获准目录，处理引用图片与群文件', draft.files)}
      ${checkbox('command', '执行命令', '在 Docker 沙箱内运行任务 · 需要资深干员及以上', draft.command)}
      ${checkbox('knowledge', '项目资料库', '检索已绑定知识库中的文档', draft.knowledge)}
      <div class="px-hint">${draft.command ? (draft.state === 'normal' ? '命令工具已装配，但当前普通干员测试身份没有执行权限。' : '命令工具可用。需要审批时，会先展示审批操作。') : '命令工具尚未装配。启用后可以到右侧测试“执行一个命令”。'}</div>
      <button type="button" data-tab="permissions">查看当前权限 ${icon('arrow-right')}</button>
      <div class="px-form-section"><h3>更多资源</h3><div class="px-list-row"><div>Skills 与 MCP<small>使用同一资源选择方式装配能力。</small></div><button type="button" data-page="resources">浏览资源库</button></div></div>
    ` : tab === 'context' ? `
      <h2>上下文与记忆</h2><p class="px-muted" style="margin-top:10px">把短期对话和长期记忆分开设置。</p>
      <div class="px-form-section"><label>保留最近多少轮对话<input type="number" name="turns" min="1" max="100" value="${draft.turns}"></label></div>
      ${checkbox('compress', '自动压缩历史', '接近上下文上限时整理较早的对话', draft.compress)}
      ${checkbox('memory', '启用长期记忆', '按发送者和会话范围检索，不自动共享不同群聊的记忆', draft.memory)}
      <div class="px-hint">当前策略：最近 ${draft.turns} 轮 · ${draft.compress ? '自动压缩' : '不自动压缩'} · ${draft.memory ? '召回长期记忆' : '不召回长期记忆'}。此处只模拟设置与发布。</div>
      <button type="button" data-action="memory">查看示例记忆</button>
    ` : `
      <h2>权限与执行</h2><p class="px-muted" style="margin-top:10px">以一个明确身份检查“为什么能用或不能用”。</p>
      <div class="px-form-section"><label>测试身份的运行态<select name="state">${Object.entries(stateLabels).map(([key, label]) => option(key, draft.state, label)).join('')}</select></label></div>
      <div class="px-hint"><strong>当前生效：${stateLabels[draft.state]}</strong><br>网络搜索：${draft.search ? '允许' : '未装配'}<br>执行命令：${!draft.command ? '未装配工具' : draft.state === 'normal' ? '禁止，限制来自发送者运行态' : '允许，受沙箱与审批限制'}</div>
      ${checkbox('approval', '命令执行前需要审批', '在实际执行之前，由管理者确认本次操作', draft.approval)}
      <p class="px-muted" style="margin-top:20px">运行态、Agent 能力、资源范围共同决定权限。这是模拟身份，不会修改真实群成员授权。</p>
    `;
    for (const button of app.querySelectorAll<HTMLButtonElement>('.px-tabs button')) {
      if (button.dataset['tab'] === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    icons(); syncDraftStatus();
  }
  function renderChat(): void {
    get('#px-chat').innerHTML = messages.length ? messages.map(message => message.role === 'user'
      ? `<div class="px-message px-message-user"><p class="px-bubble">${escape(message.content)}</p></div>`
      : `<div class="px-message"><img src="${logoUrl}" alt="普瑞赛斯"><div class="px-message-body"><p class="px-bubble">${escape(message.content)}</p>${message.trace ? `<details><summary>查看执行过程（模拟）</summary><ol>${message.trace.map(line => `<li>${escape(line)}</li>`).join('')}</ol></details>` : ''}</div></div>`).join('') : '<p class="px-muted">可以试试“搜索显示器”，或先关闭网络搜索，观察结果变化。</p>';
    if (chatBusy) get('#px-chat').insertAdjacentHTML('beforeend', '<p class="px-muted" role="status">正在模拟处理…</p>');
    const send = get('#px-send'); if (send instanceof HTMLButtonElement) send.disabled = chatBusy;
  }
  function simulateReply(text: string, config: AgentDraft, file: string): Message {
    const trace = [`读取当前草稿：${config.personaName} / ${config.model}`, `以${stateLabels[config.state]}进行权限检查`, '预设规则模拟，未调用真实模型或工具'];
    let content: string;
    if (/执行|命令|脚本|下载/.test(text)) {
      if (!config.command) { content = '模拟结果：执行命令工具尚未装配。请在“能力与资料”中启用后再测试。'; trace.push('停止原因：Agent 未装配命令工具'); }
      else if (config.state === 'normal') { content = '模拟结果：当前是普通干员，无法执行命令。工具已经装配，限制来自发送者运行态。'; trace.push('授权拒绝：需要资深干员及以上'); }
      else if (config.approval) { content = '模拟结果：权限检查通过，接下来需要管理员审批。本原型不会执行任何真实命令。'; trace.push('等待管理员审批 → 审批后才允许执行'); }
      else { content = '模拟结果：命令工具、运行态与沙箱范围检查通过。正式运行时将进入隔离环境执行。'; trace.push('命令执行（模拟）→ 汇总结果'); }
    } else if (/搜|查|显示器|价格/.test(text)) {
      if (!config.search) { content = '模拟结果：网络搜索未启用。请在“能力与资料”中开启网络搜索，再发一次消息。'; trace.push('停止原因：Agent 未装配网络搜索'); }
      else { content = file ? `模拟结果：已选择附件“${file}”。正式流程会识别型号，再查询参数与价格；本原型只显示文件名，不读取文件内容。` : '模拟结果：网络搜索可用。正式流程会先确认具体型号，再搜索参数和价格，并附上来源。'; trace.push('搜索工具可用 → 确认型号 → 检索与核对 → 附上来源'); }
    } else if (/记忆|记住/.test(text)) {
      content = config.memory ? '模拟结果：长期记忆已启用。这条内容将按发送者或会话范围处理，避免跨群共享。' : '模拟结果：长期记忆已关闭，这条消息只进入当前测试对话。'; trace.push(config.memory ? '使用当前会话范围的记忆策略' : '跳过长期记忆');
    } else {
      content = `模拟结果：正在使用“${config.personaName}”与 ${config.model}。\n角色设定：${config.persona.slice(0, 90)}${config.persona.length > 90 ? '…' : ''}\n示例对话：${config.examples.length} 组。正式版本将在这里返回模型回复。`;
    }
    return { role: 'assistant', content, trace };
  }
  function openDialog(title: string, html: string): void {
    get('#px-dialog-title').textContent = title; get('#px-dialog-content').innerHTML = html;
    const dialog = get('#px-dialog'); if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal(); icons();
  }
  function closeDialog(): void { const dialog = get('#px-dialog'); if (dialog instanceof HTMLDialogElement) dialog.close(); }
  function personasDialog(): void {
    openDialog('选择人格', '<p class="px-muted">选择后复制到当前 Agent 草稿，可继续修改；不会改动共享人格。</p>' +
      `<button class="px-dialog-choice" type="button" data-persona="priestess"><strong>普瑞赛斯</strong><small>冷静、可靠；回答直接；根据实际结果汇报。</small></button><button class="px-dialog-choice" type="button" data-persona="research"><strong>研究助手</strong><small>先核对证据，再给结论；清楚标注来源与不确定性。</small></button><button class="px-dialog-choice" type="button" data-persona="companion"><strong>日常伙伴</strong><small>自然、简洁；先理解需求，再协助完成。</small></button>`);
  }
  function modelDialog(): void {
    openDialog('模型连接', `<p class="px-muted">选择一个示例连接，也可以模拟添加新连接。</p>${models.map((model, index) => `<button class="px-dialog-choice" type="button" data-model="${index}"><strong>${escape(model)}</strong><small>${model === draft.model ? '当前 Agent 已选择' : '选择后加入当前草稿'}</small></button>`).join('')}<details><summary>添加示例连接</summary><form id="px-model-form" class="px-stack" style="margin-top:16px"><label>连接名称<input id="px-new-model" required maxlength="60" placeholder="例如：我的备用模型"></label><p class="px-muted">演示不需要 API Key，不会进行网络请求。</p><button class="px-primary" type="button" data-action="add-model">添加并选择</button></form></details>`);
  }
  function renderBots(): string {
    if (!wizard) return `<div class="px-section-heading"><h2>已接入的机器人</h2><button class="px-primary px-push-right" type="button" data-action="new-bot">${icon('plus')}接入机器人</button></div><p class="px-muted">示例连接。点击接入，可以完整走一遍配置流程。</p>${robots.map((robot, index) => `<div class="px-list-row"><div><strong>${escape(robot.name)}</strong><small>${robot.platform} · 普瑞赛斯 · ${escape(robot.scope)}</small><small>${escape(robot.trigger)} · ${robot.state}</small></div><span class="px-tag">${robot.enabled ? '模拟已连接' : '模拟已停用'}</span><button type="button" data-robot="${index}">${robot.enabled ? '停用' : '启用'}</button><button type="button" data-bot-detail="${index}">处理规则</button></div>`).join('')}<div class="px-form-section"><h3>一套全局消息路由</h3><p class="px-muted">平台消息 → 触发检查 → 权限检查 → Agent → 回复投递</p><button type="button" data-action="route" style="margin-top:15px">模拟一条群消息</button></div>`;
    const w = wizard;
    let content = '';
    if (w.step === 1) content = `<h2>选择接入平台</h2><p class="px-muted" style="margin-top:10px">三种平台沿用同一套“连接 → 处理规则 → 确认”流程。</p><div class="px-choice-grid">${(['NapCat', 'Telegram', '微信']).map(platform => `<button type="button" data-platform="${platform}" aria-pressed="${platform === w.platform}"><strong>${platform}</strong><small>${platform === 'NapCat' ? 'QQ / OneBot' : platform === 'Telegram' ? 'Bot API' : '微信机器人'}</small></button>`).join('')}</div><label>机器人名称<input name="robotName" value="${escape(w.name)}" maxlength="60" placeholder="例如：我的 QQ 助手"></label>`;
    else if (w.step === 2) content = `<h2>连接 ${w.platform}</h2><p class="px-muted" style="margin:10px 0 24px">此步骤模拟连通性检查，不保存凭据、不访问服务。</p><label>${w.platform === 'NapCat' ? 'WebSocket 地址' : w.platform === 'Telegram' ? 'Token 引用名称（示例）' : '登录连接名称（示例）'}<input name="robotAddress" value="${escape(w.address)}" placeholder="${w.platform === 'NapCat' ? 'ws://127.0.0.1:3001' : 'demo-connection'}"></label><div class="px-actions" style="margin-top:20px"><button type="button" data-action="check-bot" ${connectionTestBusy ? 'disabled' : ''}>${connectionTestBusy ? '正在模拟检查…' : '模拟检查连接'}</button><span role="status" class="px-muted">${w.checked ? '模拟检查通过，可以继续' : '完成检查后继续'}</span></div>`;
    else if (w.step === 3) content = `<h2>决定如何处理消息</h2><div class="px-stack" style="margin-top:24px"><div class="px-list-row"><div>目标 Agent<small>本次演示使用当前 Agent。</small></div><strong>普瑞赛斯</strong></div><label>群聊触发方式<select name="robotTrigger">${['提及或回复机器人', '所有群消息', '仅私聊'].map(value => option(value, w.trigger)).join('')}</select></label><label>允许的会话范围<input name="robotScope" value="${escape(w.scope)}" maxlength="120" placeholder="例如：测试群 10001"></label><label>默认运行态<select name="robotState">${Object.entries(stateLabels).map(([value, label]) => option(value, w.state, label)).join('')}</select></label></div>`;
    else content = `<h2>确认接入</h2><div class="px-list-row"><div>机器人</div><strong>${escape(w.name)} · ${w.platform}</strong></div><div class="px-list-row"><div>Agent</div><strong>普瑞赛斯</strong></div><div class="px-list-row"><div>触发方式</div><span>${escape(w.trigger)}</span></div><div class="px-list-row"><div>会话范围</div><span>${escape(w.scope)}</span></div><div class="px-list-row"><div>运行态</div><span>${stateLabels[w.state]}</span></div><p class="px-hint">完成后加入原型的机器人列表；真实 QQ、Telegram、微信配置均不受影响。</p>`;
    return `<div class="px-wizard"><ol class="px-step-list">${['选择平台', '检查连接', '处理规则', '确认接入'].map((label, index) => `<li ${w.step === index + 1 ? 'aria-current="step"' : ''}>${index + 1} · ${label}</li>`).join('')}</ol>${content}<div class="px-wizard-footer"><button type="button" data-action="${w.step === 1 ? 'cancel-wizard' : 'wizard-back'}">${w.step === 1 ? '取消' : '上一步'}</button><button class="px-primary" type="button" data-action="wizard-next" ${w.step === 2 && !w.checked ? 'disabled' : ''}>${w.step === 4 ? '完成接入（模拟）' : '下一步'}</button></div></div>`;
  }
  function renderOther(): void {
    const target = get('#px-other-page');
    if (page === 'bots') target.innerHTML = renderBots();
    else if (page === 'resources') target.innerHTML = `<h2>可复用的资源</h2><p class="px-muted" style="margin-top:10px">资源在这里集中管理，在 Agent 内直接选择。</p><div class="px-list-row"><div><strong>人格库</strong><small>普瑞赛斯、研究助手、日常伙伴 · 3 个示例</small></div><button type="button" data-action="personas">选择人格</button></div><div class="px-list-row"><div><strong>知识库</strong><small>项目资料库 · 文档与检索结果示例</small></div><button type="button" data-action="knowledge">查看资料</button></div><div class="px-list-row"><div><strong>长期记忆</strong><small>按会话和发送者隔离</small></div><button type="button" data-action="memory">查看记忆</button></div><div class="px-list-row"><div><strong>工具与插件</strong><small>网络搜索、群文件、命令执行；MCP 与 Skills 统一选择</small></div><button type="button" data-action="agent-tools">为 Agent 装配</button></div>`;
    else if (page === 'settings') target.innerHTML = `<h2>服务与系统</h2><p class="px-muted" style="margin-top:10px">配置底层连接。常用选择也可以在 Agent 编辑过程中直接完成。</p><div class="px-list-row"><div><strong>模型连接</strong><small>${models.length} 个示例连接</small></div><button type="button" data-action="models">管理连接</button></div><div class="px-list-row"><div><strong>凭据</strong><small>原型不读取、不保存真实 Token 或 API Key</small></div><button type="button" data-action="credentials">查看使用方式</button></div><div class="px-list-row"><div><strong>执行环境</strong><small>Docker Sandbox · 示例环境</small></div><button type="button" data-action="environment">查看环境</button></div><div class="px-list-row"><div><strong>配置版本</strong><small>当前模拟版本 v${revision}</small></div><button type="button" data-action="version">查看已发布配置</button></div>`;
    else target.innerHTML = `<div class="px-section-heading"><h2>会话与任务</h2><button type="button" class="px-primary px-push-right" data-action="test-agent">测试 Agent</button></div><p class="px-muted">示例会话。直接从消息定位对应任务、工具和产物。</p><div class="px-list-row"><div><strong>搜一下这个型号的显示器</strong><small>QQ 群聊 · 普瑞赛斯 · 示例消息</small></div><span class="px-tag">示例已完成</span><button type="button" data-action="sample-success">查看过程</button></div><div class="px-list-row"><div><strong>下载清单中的文件</strong><small>QQ 群聊 · 普瑞赛斯 · 示例消息</small></div><span class="px-danger">示例失败</span><button type="button" data-action="sample-failure">查看原因</button></div><div class="px-form-section"><h3>从这里开始体验</h3><div class="px-list-row"><div>改人格并测试<small>不离开 Agent 页面就能看到效果。</small></div><button type="button" data-action="test-agent">进入 Agent</button></div><div class="px-list-row"><div>接入 NapCat<small>按四个步骤完成模拟配置。</small></div><button type="button" data-action="new-bot">开始接入</button></div></div>`;
    icons();
  }
  function navigate(next: Page): void {
    page = next;
    const names: Record<Page, string> = { agent: '普瑞赛斯', workbench: '工作台', bots: '机器人', resources: '资源库', settings: '设置' };
    get('#px-title').textContent = names[page];
    get('#px-breadcrumb').textContent = page === 'agent' ? 'Agent / 普瑞赛斯' : `普瑞赛斯 / ${names[page]}`;
    get('#px-subtitle').textContent = page === 'agent' ? '日常助手' : '';
    get('#px-agent-page').hidden = page !== 'agent'; get('#px-other-page').hidden = page === 'agent'; get('#px-header-actions').hidden = page !== 'agent';
    for (const button of app.querySelectorAll<HTMLButtonElement>('.px-sidebar [data-page]')) {
      if (button.dataset['page'] === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    get('#px-notice').hidden = true;
    if (page === 'agent') { renderEditor(); renderChat(); } else renderOther();
  }
  function chooseTab(next: Tab): void { tab = next; if (page !== 'agent') navigate('agent'); else renderEditor(); }
  function newBot(): void { wizard = { step: 1, platform: 'NapCat', name: '我的 QQ 助手', address: 'ws://127.0.0.1:3001', checked: false, trigger: '提及或回复机器人', scope: '测试群 10001', state: 'normal' }; navigate('bots'); }
  function publishDialog(): void {
    if (!draft.persona.trim()) { notice('角色设定不能为空，请补充后再发布。', true); chooseTab('persona'); return; }
    if (!Number.isInteger(draft.turns) || draft.turns < 1 || draft.turns > 100) { notice('保留对话轮数应为 1 到 100 的整数。', true); chooseTab('context'); return; }
    openDialog('发布当前 Agent', `<p>这次修改只属于 <strong>普瑞赛斯</strong>：</p><ul class="px-change-list">${fieldsChanged().map(change => `<li>${escape(change)}</li>`).join('')}</ul><p class="px-hint">这是原型中的模拟发布，不会保存到 NAS 或重启机器人。</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">继续编辑</button><button class="px-primary" type="button" data-action="confirm-publish">确认发布（模拟）</button></div>`);
  }
  async function checkBot(): Promise<void> {
    const w = wizard; if (!w || connectionTestBusy) return;
    if (!w.address.trim() || (w.platform === 'NapCat' && !(w.address.startsWith('ws://') || w.address.startsWith('wss://')))) { notice(w.platform === 'NapCat' ? '请填写 ws:// 或 wss:// 开头的 WebSocket 地址。' : '请填写示例连接名称。', true); return; }
    const generation = ++connectionTestGeneration; const address = w.address;
    connectionTestBusy = true; renderOther();
    await new Promise<void>(resolve => setTimeout(resolve, 650));
    if (generation !== connectionTestGeneration) return;
    connectionTestBusy = false;
    if (wizard === w) {
      if (w.address === address) { w.checked = true; if (page === 'bots') notice('模拟检查通过。没有发起任何实际网络连接。'); }
      if (page === 'bots') renderOther();
    }
  }
  function wizardNext(): void {
    const w = wizard; if (!w) return;
    if (!w.name.trim()) { notice('请先填写机器人名称。', true); return; }
    if (w.step === 2 && !w.checked) return;
    if (w.step === 3 && !w.scope.trim()) { notice('请指定允许的会话范围。', true); return; }
    if (w.step === 4) { robots.push({ name: w.name.trim(), platform: w.platform, trigger: w.trigger, scope: w.scope, state: stateLabels[w.state], enabled: true }); wizard = null; renderOther(); notice('模拟接入完成。新机器人已加入下方列表。'); }
    else { w.step++; get('#px-notice').hidden = true; renderOther(); }
  }
  app.addEventListener('input', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    const value = field.value; const checked = field instanceof HTMLInputElement && field.checked;
    switch (field.name) {
      case 'persona': draft.persona = value; break;
      case 'extra': draft.extra = value; break;
      case 'model': draft.model = value; break;
      case 'example-user': { const entry = draft.examples[Number(field.dataset['index'])]; if (entry) entry.user = value; break; }
      case 'example-assistant': { const entry = draft.examples[Number(field.dataset['index'])]; if (entry) entry.assistant = value; break; }
      case 'search': draft.search = checked; break;
      case 'files': draft.files = checked; break;
      case 'command': draft.command = checked; break;
      case 'knowledge': draft.knowledge = checked; break;
      case 'memory': draft.memory = checked; break;
      case 'compress': draft.compress = checked; break;
      case 'turns': draft.turns = Number(value); break;
      case 'approval': draft.approval = checked; break;
      case 'state': if (value === 'normal' || value === 'senior' || value === 'elite') draft.state = value; break;
      case 'robotName': if (wizard) wizard.name = value; break;
      case 'robotAddress': if (wizard) { wizard.address = value; wizard.checked = false; const button = app.querySelector<HTMLButtonElement>('[data-action="wizard-next"]'); if (button) button.disabled = true; } break;
      case 'robotTrigger': if (wizard) wizard.trigger = value; break;
      case 'robotScope': if (wizard) wizard.scope = value; break;
      case 'robotState': if (wizard && (value === 'normal' || value === 'senior' || value === 'elite')) wizard.state = value; break;
    }
    syncDraftStatus();
  });
  app.addEventListener('change', event => {
    const field = event.target;
    if (field instanceof HTMLInputElement && field.id === 'px-file') { attachment = field.files?.[0]?.name ?? ''; get('#px-attachment').textContent = attachment ? `已选择：${attachment}（只模拟，不上传）` : ''; }
    if (field instanceof HTMLSelectElement && field.name === 'state') renderEditor();
    if (field instanceof HTMLInputElement && ['command', 'memory', 'compress'].includes(field.name)) renderEditor();
  });
  app.addEventListener('click', event => {
    const target = event.target; if (!(target instanceof Element)) return;
    const button = target.closest('button'); if (!(button instanceof HTMLButtonElement) || !app.contains(button) || button.disabled) return;
    const nextPage = button.dataset['page'];
    if (nextPage === 'agent' || nextPage === 'bots' || nextPage === 'resources' || nextPage === 'settings' || nextPage === 'workbench') { navigate(nextPage); return; }
    const nextTab = button.dataset['tab'];
    if (nextTab === 'persona' || nextTab === 'tools' || nextTab === 'context' || nextTab === 'permissions') { chooseTab(nextTab); return; }
    const persona = button.dataset['persona'];
    if (persona) {
      if (persona === 'priestess') { draft.persona = initial.persona; draft.personaName = '普瑞赛斯'; }
      else if (persona === 'research') { draft.persona = '你是一位严谨的研究助手。\n先核对证据，再给出结论。\n清楚标注来源和不确定性，不编造工具结果。'; draft.personaName = '研究助手'; }
      else { draft.persona = '你是一位自然、可靠的日常伙伴。\n先理解需求，再帮助完成。\n回答简洁，表达温和，遇到复杂问题逐步解释。'; draft.personaName = '日常伙伴'; }
      closeDialog(); chooseTab('persona'); notice('人格已复制到当前 Agent 草稿，可以继续修改或直接测试。'); return;
    }
    const modelIndex = button.dataset['model'];
    if (modelIndex !== undefined) { const model = models[Number(modelIndex)]; if (model) draft.model = model; closeDialog(); if (page === 'agent') renderEditor(); syncDraftStatus(); notice('模型选择已加入 Agent 草稿。'); return; }
    const platform = button.dataset['platform'];
    if (wizard && (platform === 'NapCat' || platform === 'Telegram' || platform === '微信')) { wizard.platform = platform; wizard.name = platform === 'NapCat' ? '我的 QQ 助手' : `我的 ${platform} 助手`; wizard.address = platform === 'NapCat' ? 'ws://127.0.0.1:3001' : 'demo-connection'; wizard.checked = false; renderOther(); return; }
    const robotIndex = button.dataset['robot'];
    if (robotIndex !== undefined) { const robot = robots[Number(robotIndex)]; if (robot) { robot.enabled = !robot.enabled; renderOther(); notice(`${robot.name} 已${robot.enabled ? '启用' : '停用'}（模拟）。`); } return; }
    const botDetail = button.dataset['botDetail'];
    if (botDetail !== undefined) { const robot = robots[Number(botDetail)]; if (robot) openDialog(`${robot.name} · 处理规则`, `<div class="px-stack"><p>触发：${escape(robot.trigger)}</p><p>范围：${escape(robot.scope)}</p><p>Agent：普瑞赛斯</p><p>运行态：${robot.state}</p><p class="px-muted">这里展示当前机器人的规则视图，底层仍然只有一套全局消息路由。</p><button type="button" data-action="route">模拟消息路由</button></div>`); return; }
    switch (button.dataset['action']) {
      case 'send': sendTest(); break;
      case 'add-model': addModel(); break;
      case 'close-dialog': closeDialog(); break;
      case 'personas': personasDialog(); break;
      case 'models': modelDialog(); break;
      case 'add-example': if (draft.examples.length >= 5) { notice('此原型最多展示 5 组示例。'); break; } draft.examples.push({ user: '', assistant: '' }); renderEditor(); break;
      case 'remove-example': draft.examples.splice(Number(button.dataset['index']), 1); renderEditor(); break;
      case 'publish': publishDialog(); break;
      case 'confirm-publish': published = structuredClone(draft); revision++; closeDialog(); syncDraftStatus(); notice(`模拟发布成功 · v${revision}。真实机器人配置没有变化。`); break;
      case 'discard': openDialog('放弃未发布修改？', '<p>当前 Agent 恢复为最近一次模拟发布的内容。测试对话会保留。</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">继续编辑</button><button type="button" class="px-danger" data-action="confirm-discard">放弃修改</button></div>'); break;
      case 'confirm-discard': draft = structuredClone(published); closeDialog(); renderEditor(); notice('已恢复到最近一次模拟发布的配置。'); break;
      case 'clear-chat': chatGeneration++; chatBusy = false; messages = []; renderChat(); break;
      case 'new-bot': newBot(); break;
      case 'check-bot': void checkBot(); break;
      case 'wizard-next': wizardNext(); break;
      case 'wizard-back': if (wizard) { wizard.step = Math.max(1, wizard.step - 1); renderOther(); } break;
      case 'cancel-wizard': wizard = null; connectionTestGeneration++; connectionTestBusy = false; renderOther(); break;
      case 'test-agent': chooseTab('persona'); get('#px-message').focus(); break;
      case 'agent-tools': closeDialog(); chooseTab('tools'); break;
      case 'knowledge': openDialog('项目资料库', '<div class="px-list-row"><div><strong>项目说明.md</strong><small>示例文档 · 已索引</small></div></div><div class="px-list-row"><div><strong>产品参数.pdf</strong><small>示例文档 · 已索引</small></div></div><p class="px-hint">在 Agent 的“能力与资料”中勾选项目资料库，即可模拟绑定。</p><button type="button" data-action="agent-tools">去绑定知识库</button>'); break;
      case 'memory': openDialog('长期记忆 · 示例', '<div class="px-list-row"><div><strong>回复时先给结论，再展开说明。</strong><small>范围：当前发送者 · 来源：示例对话</small></div></div><div class="px-list-row"><div><strong>测试群关注显示器参数与价格。</strong><small>范围：测试群 10001 · 不共享给其他会话</small></div></div><p class="px-muted">这里展示记忆的内容、来源和作用域。</p>'); break;
      case 'route': openDialog('模拟群消息路由', '<p>测试群 10001：@机器人 帮我搜索这款显示器</p><ol class="px-change-list"><li>消息接入：NapCat 群聊</li><li>触发检查：已提及机器人</li><li>权限检查：普通干员，可搜索</li><li>目标 Agent：普瑞赛斯</li><li>生成回复 → 群聊投递（仅示意）</li></ol><p class="px-muted">固定流程，各节点可分别编辑；本原型没有发送任何消息。</p>'); break;
      case 'sample-success': openDialog('显示器查询 · 示例执行', '<ol class="px-change-list"><li>群消息及引用图片进入会话</li><li>识别型号与产品信息</li><li>检索与交叉核对参数</li><li>返回结果并附上来源</li></ol><p class="px-muted">这是交互演示数据，不是 NAS 上的真实任务记录。</p><div class="px-dialog-footer"><button type="button" data-action="agent-tools">查看 Agent 能力</button></div>'); break;
      case 'sample-failure': openDialog('下载失败 · 示例诊断', '<p><strong>失败节点：权限检查</strong></p><p class="px-hint">工具已经装配，但发送者只有普通干员权限，未获得命令执行能力。</p><p class="px-muted">此处用于演示失败定位，不代表你之前那次下载任务的真实原因。</p><div class="px-dialog-footer"><button type="button" data-action="fix-permission">查看权限配置</button></div>'); break;
      case 'fix-permission': closeDialog(); chooseTab('permissions'); break;
      case 'credentials': openDialog('凭据使用方式', '<p>正式产品在这里管理凭据，在模型、机器人、搜索配置中引用。</p><p class="px-hint">交互原型不需要真实密钥。请使用示例连接名称体验操作。</p>'); break;
      case 'environment': openDialog('执行环境 · 示例', '<div class="px-stack"><p>环境：Docker Sandbox</p><p>文件范围：Agent 已授权工作目录</p><p>执行权限：需要工具装配与发送者授权</p><p class="px-muted">原型不会创建容器、读取目录或运行命令。</p><button type="button" data-action="agent-tools">查看 Agent 工具</button></div>'); break;
      case 'version': openDialog(`已发布配置 · v${revision}`, `<div class="px-stack"><p>人格：${escape(published.personaName)}</p><p>模型：${escape(published.model)}</p><p>示例对话：${published.examples.length} 组</p><p>网络搜索：${published.search ? '启用' : '关闭'}</p><p>运行态：${stateLabels[published.state]}</p><p class="px-muted">这是本次页面内的模拟版本，刷新后重置。</p></div>`); break;
      case 'reset': openDialog('重置演示？', '<p>清除这次原型里的草稿、测试消息和新增机器人，恢复初始示例。</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">保留当前操作</button><button type="button" class="px-danger" data-action="confirm-reset">重置演示</button></div>'); break;
      case 'confirm-reset': draft = structuredClone(initial); published = structuredClone(initial); revision = 1; models.splice(3); robots.splice(1); if (robots[0]) robots[0].enabled = true; wizard = null; chatGeneration++; connectionTestGeneration++; connectionTestBusy = false; chatBusy = false; messages = []; attachment = ''; get('#px-attachment').textContent = ''; { const message = get('#px-message'); if (message instanceof HTMLTextAreaElement) message.value = ''; const file = get('#px-file'); if (file instanceof HTMLInputElement) file.value = ''; } closeDialog(); tab = 'persona'; navigate('agent'); notice('演示已重置。'); break;
    }
  });
  function addModel(): void {
      const form = get('#px-model-form'); if (form instanceof HTMLFormElement && !form.reportValidity()) return;
      const name = inputValue('#px-new-model').trim(); if (!name) return;
      if (!models.includes(name)) models.push(name); draft.model = name;
      closeDialog(); if (page === 'agent') renderEditor(); else renderOther(); syncDraftStatus(); notice('示例模型连接已添加，并选入 Agent 草稿。'); return;
  }
  function sendTest(): void {
    if (chatBusy) return;
    const text = inputValue('#px-message').trim();
    if (!text && !attachment) { get('#px-message').focus(); return; }
    const file = attachment; const config = structuredClone(draft); const generation = ++chatGeneration;
    messages.push({ role: 'user', content: `${text}${file ? `\n附件：${file}` : ''}` });
    const field = get('#px-message'); if (field instanceof HTMLTextAreaElement) field.value = '';
    const fileField = get('#px-file'); if (fileField instanceof HTMLInputElement) fileField.value = '';
    attachment = ''; get('#px-attachment').textContent = ''; chatBusy = true; renderChat();
    setTimeout(() => { if (generation !== chatGeneration) return; messages.push(simulateReply(text, config, file)); chatBusy = false; renderChat(); }, 600);
  }
  app.addEventListener('submit', event => {
    const form = event.target; if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.id === 'px-model-form') addModel();
    else if (form.id === 'px-chat-form') sendTest();
  });
  app.addEventListener('keydown', event => {
    const target = event.target;
    if (event.key === 'Enter' && target instanceof HTMLTextAreaElement && target.id === 'px-message' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendTest(); }
    if (event.key === 'Enter' && target instanceof HTMLInputElement && target.id === 'px-new-model') { event.preventDefault(); addModel(); }
  });
  renderEditor(); renderChat(); icons();
})();
