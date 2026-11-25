const state = {
  screen: 'workbench',
  token: '',
  revision: 0,
  config: null,
  platforms: [],
  runs: [],
  capabilities: [],
  workspace: null,
  personas: null,
  environments: [],
  selectedAgent: null,
  capFilter: 'all',
  capSource: 'all',
  capabilityTab: 'catalog',
  capQuery: '',
  searchEditing: false,
  resType: 'all',
  resZone: 'all',
  resourceTab: 'workspace',
  personaEditing: '',
  platformEditing: '',
  imTab: 'channels',
  wechatPlatform: '',
  wechatQr: null,
  modelEditing: '',
  secrets: [],
  audit: [],
  capabilityPlugin: null,
  capabilityRecord: null,
  capabilityStatus: [],
  capabilityQr: null,
  capabilityNotice: '',
  capabilitySubscriptions: [],
  extensions: [],
  plugins: [],
  agentTestResult: null,
  agentTestError: '',
  search: null,
  flowSimulation: null,
  chatConversations: [],
  chatDetail: null,
  chatBusy: false,
  runProcesses: [],
  fileEnvironments: [],
  fileEnvironment: '',
  filesPath: '',
  fileEntries: [],
  filePreview: null,
  conversations: [],
  conversationDetail: null,
  conversationSearch: '',
  knowledgeLibrary: '',
  knowledgeDocs: [],
  knowledgeHits: [],
  knowledgeQuery: '',
  memories: [],
  memoryLibrary: '',
  memoryEditing: '',
  busy: false,
  error: '',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const label = (value) => ({ queued:'排队中', running:'执行中', paused:'等待审批', completed:'已完成', failed:'失败', cancelled:'已取消', interrupted:'已中断', disabled:'已停用', starting:'连接中', connected:'已连接', error:'连接失败', stopped:'已停止' }[value] ?? value);
const statusClass = (value) => value === 'connected' || value === 'completed' ? 'ok' : value === 'failed' || value === 'error' || value === 'cancelled' || value === 'interrupted' ? 'bad' : value === 'paused' || value === 'starting' || value === 'queued' ? 'warn' : '';
const time = (value) => { if (!value) return '—'; const date = new Date(Number(value)); return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString('zh-CN', { hour12:false }); };
const ago = (value) => { if (!value) return '—'; const diff = Math.max(0, Date.now() - Number(value)); if (diff < 60_000) return '刚刚'; if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`; return `${Math.floor(diff / 86_400_000)} 天前`; };
const chip = (text, kind = '') => `<span class="chip ${kind}">${esc(text)}</span>`;
const statusChip = (value) => `<span class="chip ${statusClass(value)}"><span class="dot ${statusClass(value)}"></span>${esc(label(value))}</span>`;

async function api(path, { method = 'GET', body, token = state.token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try { response = await fetch(`/api/ts/${path}`, { method, credentials: 'same-origin', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new Error('无法连接管理服务'); }
  if (!response.ok) {
    let detail = '';
    try { const parsed = await response.json(); detail = typeof parsed?.error === 'string' ? parsed.error : ''; } catch { /* empty */ }
    const error = new Error(detail || `请求失败（HTTP ${response.status}）`); error.status = response.status; throw error;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function showError(message) { state.error = message || ''; const node = $('#global-error'); node.textContent = state.error; node.hidden = !state.error; }
function toast(message) { const node = $('#toast'); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 2600); }
function showLogin(message = '') { $('#login').hidden = false; $('#login-error').hidden = !message; $('#login-error').textContent = message; $('#conn-text').textContent = '未连接'; $('#conn-dot').className = 'dot'; }
function hideLogin() { $('#login').hidden = true; }

function pageHead(eyebrow, title, lede, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="lede">${esc(lede)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
function empty(text) { return `<p class="empty-line">${esc(text)}</p>`; }
function stat(labelText, value, note = '', iconName = '') {
  return `<article class="stat"><div class="stat-label">${iconName ? icon(iconName) : ''}${esc(labelText)}</div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></article>`;
}
function zoneCard(zone) {
  const title = zone.zone === 'global' ? '全局' : zone.zone === 'agent' ? `Agent · ${zone.agentId ?? ''}` : `会话 · ${zone.conversation?.platform ?? ''}/${zone.conversation?.sessionType ?? ''}/${zone.conversation?.sessionId ?? ''}`;
  return `<article class="zone-card"><div class="zone-card-head"><strong>${esc(title)}</strong>${chip(`${zone.skills.length} Skill · ${zone.mcp.length} MCP`, 'violet')}</div><div class="zone-areas"><span><b>${zone.areas.skill}</b>skill</span><span><b>${zone.areas.mcp}</b>mcp</span><span><b>${zone.areas.cache}</b>cache</span><span><b>${zone.areas.file}</b>file</span></div>${zone.zone === 'conversation' ? '<small class="muted">会话不支持 MCP</small>' : ''}</article>`;
}
function recordRow(record) {
  return `<button class="record-row" type="button" data-run-id="${esc(record.id)}"><div class="record-title"><strong>${esc(record.summary || record.id)}</strong><small>${esc(record.agentId)} · ${esc(record.sessionKey ?? '')}</small></div><div class="record-meta">${esc(time(record.createdAt))}</div>${statusChip(record.status)}<span class="record-meta">${record.durationMs ? `${Math.round(record.durationMs)} ms` : '—'}</span></button>`;
}
function sourceLabel(source) { return ({ builtin:'内置', search:'网络搜索', plugin:'平台能力', mcp:'MCP', skills:'Skills', native_extension:'原生扩展', platform:'平台提供' }[source] ?? source); }
function kindLabel(kind) { return ({ tool:'Tool', command:'指令', resource:'资源', platform_status:'平台说明' }[kind] ?? kind); }

function renderWorkbench() {
  const agents = state.config?.agents ?? [];
  const platforms = state.config?.platforms ?? [];
  const connected = state.platforms.filter(item => item.status === 'connected').length;
  const zones = state.workspace?.zones ?? [];
  const skills = zones.reduce((sum, zone) => sum + zone.skills.length, 0);
  const mcp = zones.reduce((sum, zone) => sum + zone.mcp.length, 0);
  const attention = [
    ...platforms.filter(platform => platform.enabled !== false && !state.platforms.some(item => item.id === platform.id && item.status === 'connected')).map(platform => `IM ${platform.displayName || platform.id} 未连接`),
    ...agents.filter(agent => !agent.enabled).map(agent => `${agent.displayName || agent.id} 已停用`),
    ...(state.workspace && !state.workspace.workspace?.sandbox ? ['Workspace sandbox 已关闭'] : []),
  ];
  return `${pageHead('WORKBENCH', '工作台', `${agents.filter(agent => agent.enabled).length} 个智能体在岗，${connected} / ${platforms.length} 条 IM 在线。`, `<button class="btn" data-chat-console>${icon('im')}控制台对话</button><button class="btn" data-files>${icon('folder')}文件</button><button class="btn" data-conversations>${icon('im')}会话</button><button class="btn" data-go="resources">${icon('folder')}任务文件</button><button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}
  <div class="stat-grid">${stat('智能体', `${agents.filter(agent => agent.enabled).length} / ${agents.length}`, '已启用 / 全部')}${stat('IM 通道', `${connected} / ${platforms.length}`, '已连接 / 已配置', 'server')}${stat('Skill / MCP', `${skills} / ${mcp}`, '工作区资源', 'tool')}${stat('最近运行', String(state.runs.length), '来自 Agent 记录', 'workbench')}</div>
  <div class="grid-2 section-gap">
    <section class="card"><div class="card-title"><div><h2>最近运行</h2><p>来自 Agent 运行记录，只读。</p></div><button class="btn btn-ghost btn-sm" data-refresh>刷新</button></div>${state.runs.length ? `<div class="record-list">${state.runs.slice(0, 8).map(recordRow).join('')}</div>` : empty('暂无运行记录。')}</section>
    <section class="card"><div class="card-title"><div><h2>需要关注</h2><p>未连接、停用或环境异常。</p></div></div>${attention.length ? `<ul class="list-reset stack">${attention.map(item => `<li class="capability-row" style="padding:9px 0"><div><strong>${esc(item)}</strong><p>在对应页面检查状态。</p></div>${icon('alert')}</li>`).join('')}</ul>` : empty('目前没有需要处理的事项。')}<div class="card-foot"><span class="muted">配置 revision ${state.revision}</span><button class="btn btn-sm" data-go="system">查看系统</button></div></section>
  </div>
  <section class="card section-gap"><div class="card-title"><div><h2>工作区</h2><p>全局 / Agent / 会话三区。会话区没有 MCP。</p></div><button class="btn btn-ghost btn-sm" data-go="resources">查看资源</button></div>${zones.length ? `<div class="grid-3">${zones.slice(0, 6).map(zoneCard).join('')}</div>` : empty('尚未启用 workspace v2。')}</section>`;
}

function renderAgents() {
  const agents = state.config?.agents ?? [];
  if (!state.selectedAgent || !agents.some(agent => agent.id === state.selectedAgent)) state.selectedAgent = state.config?.flow?.routing?.defaultAgentId ?? agents[0]?.id ?? null;
  const selected = agents.find(agent => agent.id === state.selectedAgent) ?? agents[0];
  const list = agents.map(agent => `<button class="agent-list-button ${agent.id === selected?.id ? 'active' : ''}" type="button" data-agent="${esc(agent.id)}"><span class="agent-avatar">${esc((agent.displayName || agent.id).slice(0, 1))}</span><span><strong>${esc(agent.displayName || agent.id)}</strong><small>${esc(agent.model || '未设置模型')} · ${agent.enabled ? '已启用' : '已停用'}</small></span>${agent.enabled ? '<span class="dot ok"></span>' : '<span class="dot"></span>'}</button>`).join('');
  if (!selected) return `${pageHead('AGENTS', '智能体', '还没有 Agent。', `<button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}<div class="agent-layout"><aside class="card"><div class="agent-list">${empty('暂无 Agent')}</div></aside><section class="card">${empty('暂无 Agent')}</section></div>`;
  const capName = (entry) => entry.kind === 'tool' || entry.kind === 'command' ? entry.toolName : entry.bindingName;
  const bindable = state.capabilities.filter(entry => typeof capName(entry) === 'string');
  const tools = new Set(selected.resources?.tools ?? []);
  const knownNames = new Set(bindable.map(capName));
  const unknownTools = [...tools].filter(name => !knownNames.has(name)).join('\n');
  const resourceChecks = (name, label, items, selectedIds) => `<section class="binding-group"><h4>${esc(label)}</h4>${items.length ? items.map(item => `<label class="check-line"><input type="checkbox" name="${name}" value="${esc(item.id)}" ${selectedIds.includes(item.id) ? 'checked' : ''}>${esc(item.label || item.id)}</label>`).join('') : '<small class="muted">没有可绑定项</small>'}</section>`;
  const toolRows = bindable.map(entry => {
    const name = capName(entry);
    const disabled = entry.availability === 'not_implemented';
    return `<label class="tool-option ${tools.has(name) ? 'mounted' : ''}" title="${esc(entry.description)}"><input type="checkbox" name="tools" value="${esc(name)}" ${tools.has(name) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="tool-option-main"><strong>${esc(entry.label)}</strong><small>${esc(sourceLabel(entry.source))} · ${esc(name)}${entry.availability !== 'registered' ? ` · ${esc(entry.availability)}` : ''}</small><p>${esc(entry.description)}</p></span></label>`;
  }).join('');
  return `${pageHead('AGENTS', '智能体', '配置 Agent 的身份、能力和运行参数。', `<button class="btn btn-primary" type="button" data-agent-new>${icon('plus')}新建 Agent</button><button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}<div class="agent-layout"><aside class="card"><div class="card-title"><div><h2>Agent</h2><p>${agents.length} 个</p></div></div><div class="agent-list">${list}</div></aside>
  <form id="agent-form" class="card agent-detail">
    <div class="detail-head"><div><div class="eyebrow">AGENT / ${esc(selected.id)}</div><h2>${esc(selected.displayName || selected.id)}</h2><p>${esc(selected.model || '未设置模型')} · ${esc(selected.connectionId || '未绑定连接')}</p></div><div class="meta-list">${chip(selected.enabled ? '已启用' : '已停用', selected.enabled ? 'ok' : 'warn')}${chip(`${tools.size} tools`)}${chip(`${selected.resources?.skills?.length ?? 0} Skill 库`)}<button class="btn btn-sm" type="button" data-agent-test="${esc(selected.id)}">测试模型</button></div></div>
    <div class="form-grid"><label>显示名称<input name="displayName" value="${esc(selected.displayName)}" required></label><label>模型<input name="model" value="${esc(selected.model)}" required></label><label>模型服务<select name="connectionId">${(state.config.connections ?? []).map(connection => `<option value="${esc(connection.id)}" ${connection.id === selected.connectionId ? 'selected' : ''}>${esc(connection.id)}</option>`).join('')}</select></label><label>人格<select name="personaId"><option value="">不使用人格</option>${(state.personas?.personas ?? []).map(persona => `<option value="${esc(persona.id)}" ${(state.personas?.bindings ?? []).find(binding => binding.agentId === selected.id)?.personaId === persona.id ? 'selected' : ''}>${esc(persona.name || persona.displayName || persona.id)}</option>`).join('')}</select></label><label class="check-line wide"><input name="enabled" type="checkbox" ${selected.enabled ? 'checked' : ''}>启用此 Agent</label><label class="wide">系统提示词<textarea name="instructions">${esc(selected.instructions)}</textarea></label><label class="wide">示例对话 JSON（user/assistant 交替）<textarea name="exampleDialogs" rows="4">${esc(JSON.stringify(selected.exampleDialogs ?? [], null, 2))}</textarea></label><label>技能 allowlist（逗号分隔，空为不限制）<input name="skillAllowlist" value="${esc((selected.skillAllowlist ?? []).join(', '))}"></label><label>语音提示<textarea name="voicePrompt" rows="2">${esc(selected.voicePrompt ?? '')}</textarea></label><label class="wide">自定义错误回复<textarea name="customErrorMessage" rows="2">${esc(selected.customErrorMessage ?? '')}</textarea></label></div>
    <section class="agent-section"><div class="card-title"><div><h2>能力开关</h2><p>勾选即装配工具/指令；未知工具可在下方补录。</p></div><span class="chip">${tools.size} 已装配</span></div><div class="tool-picker">${toolRows || empty('能力目录为空，请刷新。')}</div><label class="wide">其他工具名（每行一个，保留未登记绑定）<textarea name="extraTools" rows="2">${esc(unknownTools)}</textarea></label></section>
    <section class="agent-section"><div class="card-title"><div><h2>资源绑定</h2><p>保存后 Agent 才能使用这些资源。</p></div></div><div class="binding-grid">${resourceChecks('skills', 'Skill 库', state.config.skillLibraries ?? [], selected.resources?.skills ?? [])}${resourceChecks('mcpServers', 'MCP 服务', state.config.mcpServers ?? [], selected.resources?.mcpServers ?? [])}${resourceChecks('knowledgeLibraries', '知识库', state.config.knowledgeLibraries ?? [], selected.resources?.knowledgeLibraries ?? [])}${resourceChecks('memoryLibraries', '记忆库', state.config.memoryLibraries ?? [], selected.resources?.memoryLibraries ?? [])}</div></section>
    <section class="agent-section"><div class="card-title"><div><h2>上下文与委派</h2><p>压缩策略、委派目标和记忆提取。</p></div></div><div class="form-grid"><label>压缩策略<select name="contextStrategy">${['semantic','extractive','truncate_by_turns'].map(value => `<option value="${value}" ${(selected.contextPolicy?.strategy ?? 'semantic') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>上下文窗口<input name="contextWindowTokens" type="number" min="2048" value="${esc(selected.contextPolicy?.contextWindowTokens ?? 128000)}"></label><label>压缩阈值<input name="compactAtTokens" type="number" min="1024" value="${esc(selected.contextPolicy?.compactAtTokens ?? 32768)}"></label><label>保留目标<input name="targetTokens" type="number" min="512" value="${esc(selected.contextPolicy?.targetTokens ?? 16384)}"></label><label>摘要模型<input name="summaryModel" value="${esc(selected.contextPolicy?.summaryModel ?? '')}"></label><label>摘要连接<select name="summaryConnectionId"><option value="">不单独指定</option>${(state.config.connections ?? []).map(connection => `<option value="${esc(connection.id)}" ${selected.contextPolicy?.summaryConnectionId === connection.id ? 'selected' : ''}>${esc(connection.id)}</option>`).join('')}</select></label><section class="binding-group wide"><h4>委派目标</h4>${(state.config.agents ?? []).filter(agent => agent.id !== selected.id).map(agent => `<label class="check-line"><input type="checkbox" name="delegationTargets" value="${esc(agent.id)}" ${(selected.delegationTargets ?? []).includes(agent.id) ? 'checked' : ''}>${esc(agent.displayName || agent.id)}</label>`).join('') || '<small class="muted">没有其他 Agent</small>'}</section><label class="check-line wide"><input name="memoryExtractionEnabled" type="checkbox" ${selected.memoryExtraction?.enabled ? 'checked' : ''}>自动提取长期记忆</label><label>提取到记忆库<select name="memoryExtractionLibrary"><option value="">未选择</option>${(state.config.memoryLibraries ?? []).map(library => `<option value="${esc(library.id)}" ${selected.memoryExtraction?.libraryId === library.id ? 'selected' : ''}>${esc(library.displayName || library.id)}</option>`).join('')}</select></label></div></section>
    <section class="agent-section"><div class="card-title"><div><h2>运行与审批</h2><p>执行环境、审批和预算限制。</p></div></div><div class="form-grid"><label>执行环境<select name="executionEnvironment"><option value="none" ${(selected.resources?.executionEnvironment ?? 'none') === 'none' ? 'selected' : ''}>不使用</option>${(state.config.executionEnvironments ?? []).map(env => `<option value="${esc(env.id)}" ${env.id === selected.resources?.executionEnvironment ? 'selected' : ''}>${esc(env.id)} · ${esc(env.type)}</option>`).join('')}</select></label><label>最大模型轮数<input name="maxTurns" type="number" min="1" max="100" value="${esc(selected.budget?.maxTurns ?? 30)}"></label><label>超时（毫秒）<input name="timeoutMs" type="number" min="100" max="3600000" value="${esc(selected.budget?.timeoutMs ?? 300000)}"></label><label>Token 上限<input name="maxTokens" type="number" min="1" max="1000000" value="${esc(selected.budget?.maxTokens ?? 100000)}"></label><label class="wide">需要逐次审批的工具（每行一个）<textarea name="approvalTools" rows="2">${esc((selected.approvalTools ?? []).join('\n'))}</textarea></label><label class="wide">权限不足时的回复<textarea name="permissionDenied" rows="2">${esc(selected.permissionDenied ?? '')}</textarea></label><label class="wide">允许访问的目录（每行一个）<textarea name="directories" rows="2">${esc((selected.resources?.directories ?? []).join('\n'))}</textarea></label></div></section>
    <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')}保存 Agent</button><button class="btn" type="button" data-agent-delete>删除 Agent</button><span class="muted">保存会创建新 revision；工作区配置不会改变。</span></div>
  </form></div>`;
}

function renderImChannels() {
  const platforms = state.config?.platforms ?? [];
  const statusOf = (id) => state.platforms.find(item => item.id === id)?.status ?? 'stopped';
  const editing = state.platformEditing === 'new' ? null : platforms.find(platform => platform.id === state.platformEditing);
  const current = editing ?? { id: '', type: 'telegram', displayName: 'Telegram', enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN', apiBase: 'https://api.telegram.org', pollingTimeoutSeconds: 30 };
  const type = current.type ?? 'telegram';
  const field = (name, value) => esc(value ?? '');
  const fields = `<div data-platform-fields="telegram" ${type === 'telegram' ? '' : 'hidden'}><div class="form-grid"><label>Token 环境变量<input name="tokenEnv" value="${field('tokenEnv', type === 'telegram' ? current.tokenEnv : 'TELEGRAM_BOT_TOKEN')}"></label><label>API 地址<input name="telegramApiBase" value="${field('telegramApiBase', type === 'telegram' ? current.apiBase : 'https://api.telegram.org')}"></label><label>轮询超时（秒）<input name="pollingTimeoutSeconds" type="number" min="1" max="60" value="${field('pollingTimeoutSeconds', type === 'telegram' ? current.pollingTimeoutSeconds : 30)}"></label></div></div>
    <div data-platform-fields="napcat" ${type === 'napcat' ? '' : 'hidden'}><div class="form-grid"><label>WebSocket 地址<input name="websocketUrl" value="${field('websocketUrl', type === 'napcat' ? current.websocketUrl : 'ws://127.0.0.1:3001')}"></label><label>Access Token 环境变量<input name="accessTokenEnv" value="${field('accessTokenEnv', type === 'napcat' ? current.accessTokenEnv : 'NAPCAT_TOKEN')}"></label><label>API 地址（可选）<input name="napcatApiBase" value="${field('napcatApiBase', type === 'napcat' ? current.apiBase : '')}"></label><label>合并转发阈值<input name="forwardThreshold" type="number" min="0" max="200000" value="${field('forwardThreshold', type === 'napcat' ? current.forwardThreshold : 1500)}"></label></div></div>
    <div data-platform-fields="weixin" ${type === 'weixin' ? '' : 'hidden'}><div class="form-grid"><label>Token 环境变量<input name="weixinTokenEnv" value="${field('weixinTokenEnv', type === 'weixin' ? current.tokenEnv : 'WEIXIN_TOKEN')}"></label><label>API 地址<input name="weixinApiBase" value="${field('weixinApiBase', type === 'weixin' ? current.apiBase : 'https://ilinkai.weixin.qq.com')}"></label><label>账号 ID<input name="accountId" value="${field('accountId', type === 'weixin' ? current.accountId : '')}"></label><label>状态文件<input name="stateFile" value="${field('stateFile', type === 'weixin' ? current.stateFile : 'weixin-state.json')}"></label></div></div>`;
  const form = state.platformEditing ? `<form id="platform-form" class="platform-form"><div class="card-title" style="margin:0"><div><h2>${editing ? '编辑 IM 通道' : '新增 IM 通道'}</h2><p>密钥只写环境变量名，不把明文放进配置。</p></div><button class="btn btn-sm" type="button" data-platform-cancel>取消</button></div><div class="form-grid"><label>类型<select name="type" data-platform-type><option value="telegram" ${type === 'telegram' ? 'selected' : ''}>Telegram</option><option value="napcat" ${type === 'napcat' ? 'selected' : ''}>QQ / NapCat</option><option value="weixin" ${type === 'weixin' ? 'selected' : ''}>微信 iLink</option></select></label><label>ID<input name="id" value="${esc(current.id)}" ${editing ? 'readonly' : ''} required placeholder="例如 telegram-main"></label><label>显示名称<input name="displayName" value="${esc(current.displayName)}" required></label><label class="check-line wide"><input name="enabled" type="checkbox" ${current.enabled ? 'checked' : ''}>创建后启用</label></div>${fields}<div class="platform-form-actions"><button class="btn btn-primary" type="submit">${icon('check')}保存 IM 通道</button>${editing ? `<button class="btn" type="button" data-platform-delete="${esc(editing.id)}">删除通道</button>` : ''}</div></form>` : '';
  return `${form}<div class="grid-2">${platforms.map(platform => `<article class="platform-card"><div class="platform-card-head"><div><strong>${esc(platform.displayName || platform.id)}</strong><small>${esc(platform.type)} · ${esc(platform.id)}</small></div>${statusChip(statusOf(platform.id))}</div><div class="meta-list">${chip(platform.enabled === false ? '已停用' : '已启用', platform.enabled === false ? 'warn' : 'ok')}${chip(`${state.config.flow?.routing?.rules?.length ?? 0} 条路由`)}</div><label class="check-line"><input type="checkbox" data-platform-toggle="${esc(platform.id)}" ${platform.enabled !== false ? 'checked' : ''}>启用通道</label><div class="platform-card-actions"><button class="btn btn-sm" type="button" data-platform-edit="${esc(platform.id)}">编辑</button>${platform.type === 'weixin' ? `<button class="btn btn-sm" type="button" data-wechat-qr="${esc(platform.id)}">微信扫码</button>` : ''}</div></article>`).join('') || empty('还没有 IM 通道。')}</div>${state.wechatPlatform ? `<section class="card section-gap"><div class="card-title"><div><h2>微信扫码登录</h2><p>${esc(state.wechatPlatform)} · ${esc(state.wechatQr?.status ?? '等待生成')}</p></div><button class="btn btn-sm" type="button" data-wechat-close>关闭</button></div>${state.wechatQr ? `<div class="wechat-login"><div class="qr-code" id="wechat-qr"></div><div class="filters"><button class="btn btn-sm" type="button" data-wechat-poll>检查扫码状态</button><a class="btn btn-sm" href="${esc(state.wechatQr.qrUrl)}" target="_blank" rel="noopener">打开登录链接</a></div></div>` : empty('正在生成登录二维码…')}</section>` : ''}<section class="card section-gap"><div class="card-title"><div><h2>路由</h2><p>默认 Agent 与消息规则。</p></div></div><div class="grid-3">${stat('默认 Agent', state.config.flow?.routing?.defaultAgentId || '未设置', '未匹配消息使用')}${stat('路由规则', String(state.config.flow?.routing?.rules?.length ?? 0), '已保存')}${stat('工作区', state.workspace?.workspace?.sandbox ? 'Sandbox' : 'Host', state.workspace?.workspace?.root ?? '未配置')}</div></section>`;
}

function renderIm() {
  const tabs = [['channels','通道'],['routing','消息路由'],['grants','发送者授权']];
  const body = state.imTab === 'routing' ? renderImRouting() : state.imTab === 'grants' ? renderImGrants() : renderImChannels();
  return `${pageHead('IM', 'IM', '管理 IM 通道、消息路由和发送者权限。', `<button class="btn btn-primary" type="button" data-platform-new>${icon('plus')}新增 IM</button><button class="btn" data-refresh>${icon('refresh')}刷新状态</button>`)}<div class="ts-tabs filters" style="margin-bottom:14px">${tabs.map(([id,text]) => `<button type="button" class="${state.imTab === id ? 'active' : ''}" data-im-tab="${id}">${text}</button>`).join('')}</div>${body}`;
}
function renderImRouting() {
  const routing = state.config?.flow?.routing ?? { defaultAgentId: '', rules: [] };
  const agents = state.config?.agents ?? [];
  const rules = routing.rules ?? [];
  return `<section class="card"><div class="card-title"><div><h2>消息路由</h2><p>默认 Agent 与按平台/会话/发送者的规则。</p></div></div><div class="form-grid"><label>默认 Agent<select id="routing-default">${agents.map(agent => `<option value="${esc(agent.id)}" ${agent.id === routing.defaultAgentId ? 'selected' : ''}>${esc(agent.displayName || agent.id)}</option>`).join('')}</select></label></div><div class="table-wrap section-gap"><table class="table"><thead><tr><th>ID</th><th>平台</th><th>会话</th><th>发送者</th><th>包含文本</th><th>Agent</th><th></th></tr></thead><tbody>${rules.map((rule, index) => `<tr><td>${esc(rule.id)}</td><td>${esc(rule.platform ?? '全部')}</td><td>${esc(rule.sessionType ?? '')} ${esc(rule.sessionId ?? '')}</td><td>${esc(rule.senderId ?? '')}</td><td>${esc(rule.textIncludes ?? '')}</td><td>${esc(rule.agentId)}</td><td><button class="btn btn-sm" type="button" data-rule-remove="${index}">删除</button></td></tr>`).join('')}</tbody></table>${rules.length ? '' : empty('没有路由规则，所有消息使用默认 Agent。')}</div><details class="library-admin section-gap"><summary>模拟消息路由</summary><form id="simulate-form" class="form-grid"><label>平台<input name="platform" value="${esc(state.config.platforms?.[0]?.id ?? 'dashboard')}"></label><label>会话类型<select name="sessionType"><option value="private">私聊</option><option value="group">群聊</option></select></label><label>会话 ID<input name="sessionId" value="dashboard"></label><label>发送者 ID<input name="senderId" value="local"></label><label class="wide">消息<textarea name="text" rows="2" required>你好</textarea></label><button class="btn btn-primary btn-sm" type="submit">模拟</button></form>${state.flowSimulation ? `<div class="run-summary" style="margin:12px 0"><div class="meta-list">${chip(state.flowSimulation.outcome)}${state.flowSimulation.agentId ? chip(state.flowSimulation.agentId) : ''}${state.flowSimulation.reason ? chip(state.flowSimulation.reason) : ''}</div><ol>${(state.flowSimulation.path ?? []).map(step => `<li>${esc(step.nodeId)} · ${esc(step.summary)}</li>`).join('')}</ol></div>` : ''}</details><form id="rule-form" class="form-grid section-gap"><label>平台<input name="platform" placeholder="留空为全部"></label><label>会话类型<select name="sessionType"><option value="">全部</option><option value="private">私聊</option><option value="group">群聊</option></select></label><label>会话 ID<input name="sessionId"></label><label>发送者 ID<input name="senderId"></label><label>包含文本<input name="textIncludes"></label><label>Agent<select name="agentId">${agents.map(agent => `<option value="${esc(agent.id)}">${esc(agent.displayName || agent.id)}</option>`).join('')}</select></label><button class="btn btn-primary btn-sm" type="submit">添加规则</button></form></section>`;
}
function renderImGrants() {
  const grants = state.config?.grants ?? [];
  const platforms = state.config?.platforms ?? [];
  return `<section class="card"><div class="card-title"><div><h2>发送者授权</h2><p>固定运行态决定命令、文件和外部操作权限。</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>平台</th><th>发送者</th><th>会话范围</th><th>运行态</th><th></th></tr></thead><tbody>${grants.map((grant, index) => `<tr><td>${esc(grant.platform)}</td><td>${esc((grant.senderIds ?? []).join('、'))}</td><td>${esc(grant.sessionType ?? '')} ${esc(grant.sessionId ?? '')}</td><td>${esc(grant.state)}</td><td><button class="btn btn-sm" type="button" data-grant-remove="${index}">删除</button></td></tr>`).join('')}</tbody></table>${grants.length ? '' : empty('还没有发送者授权。')}</div><form id="grant-form" class="form-grid section-gap"><label>平台<input name="platform" value="${esc(platforms[0]?.id ?? '')}" required></label><label>发送者 ID（逗号分隔）<input name="senderIds" required></label><label>运行态<select name="state"><option value="operator">普通干员</option><option value="senior_operator">资深干员</option><option value="elite_operator">高级资深干员</option></select></label><label>会话类型<select name="sessionType"><option value="">全部</option><option value="private">私聊</option><option value="group">群聊</option></select></label><label>会话 ID<input name="sessionId"></label><button class="btn btn-primary btn-sm" type="submit">添加授权</button></form></section>`;
}

function capabilityRowHtml(entry) {
  const config = entry.source === 'plugin' ? `<button class="btn btn-sm" type="button" data-capability-config="${esc(entry.sourceId)}">${icon('tool')}配置</button>` : '';
  return `<div class="capability-row"><div><strong>${esc(entry.label)}</strong><p>${esc(entry.description)}</p><div class="meta-list">${chip(capabilitySourceLabel(entry.source), 'violet')}${chip(kindLabel(entry.kind))}${entry.scope === 'platform' ? chip(entry.platforms.join(' / ')) : ''}${entry.availability && entry.availability !== 'registered' ? chip(entry.availability, 'warn') : ''}</div></div><div class="filters">${config}<button class="btn btn-sm" type="button" data-go="agents">${icon('agents')}装配</button></div></div>`;
}
function capabilitySourceLabel(source) { return ({ plugin:'平台服务', builtin:'内置工具', search:'搜索工具', mcp:'MCP', skills:'Skills', native_extension:'扩展' }[source] ?? source); }
function renderCapabilityCatalog() {
  const sources = [['plugin','平台服务'],['builtin','内置工具'],['search','搜索工具'],['mcp','MCP'],['skills','Skills'],['native_extension','扩展']];
  const entries = (state.capabilities ?? []).filter(entry => entry.kind !== 'platform_status' && (!state.capQuery || `${entry.label} ${entry.description} ${entry.sourceId}`.toLocaleLowerCase().includes(state.capQuery.toLocaleLowerCase()))).filter(entry => state.capSource === 'all' || entry.source === state.capSource);
  const filters = [['all','全部'], ...sources];
  const filterHtml = filters.map(pair => `<button class="filter-btn ${state.capSource === pair[0] ? 'active' : ''}" type="button" data-cap-source="${pair[0]}">${pair[1]}</button>`).join('');
  const groups = sources.map(pair => ({ id: pair[0], text: pair[1], items: entries.filter(entry => entry.source === pair[0]) })).filter(group => group.items.length);
  const groupHtml = groups.map(group => `<section class="card section-gap"><div class="card-title"><div><h2>${esc(group.text)}</h2><p>${group.items.length} 项</p></div></div>${group.items.map(capabilityRowHtml).join('')}</section>`).join('');
  return `<div class="filters" style="margin-bottom:14px"><input type="search" id="capability-query" placeholder="搜索能力名称、说明或来源" value="${esc(state.capQuery)}"><button class="btn btn-sm" type="button" data-cap-search>搜索</button>${filterHtml}<span class="filter-label">${entries.length} 项</span></div>${groupHtml || '<section class="card">' + empty('没有匹配的能力。') + '</section>'}`;
}
function renderSearchConfigForm() {
  return `${state.search ? `<form id="search-form" class="form-grid"><label class="check-line wide"><input name="enabled" type="checkbox" ${state.search.settings.enabled ? 'checked' : ''}>启用网络搜索</label><label>服务<select name="provider">${['deepseek','tavily','brave'].map(provider => `<option value="${provider}" ${state.search.settings.provider === provider ? 'selected' : ''}>${provider}</option>`).join('')}</select></label><label>API 地址<input name="apiBase" value="${esc(state.search.settings.apiBase)}"></label><label>密钥引用<input name="apiKeyEnv" value="${esc(state.search.settings.apiKeyEnv)}"></label><label>默认结果数<input name="defaultCount" type="number" min="1" max="50" value="${esc(state.search.settings.defaultCount)}"></label><label>最大结果数<input name="maxCount" type="number" min="1" max="50" value="${esc(state.search.settings.maxCount)}"></label><label>正文上限<input name="maxContentChars" type="number" min="100" max="50000" value="${esc(state.search.settings.maxContentChars)}"></label><div class="filters wide"><button class="btn btn-primary btn-sm" type="submit">保存搜索配置</button><button class="btn btn-sm" type="button" data-search-cancel>取消</button></div></form>` : empty('无法读取搜索配置。')}`;
}
function renderCapabilityServices() {
  const plugins = state.plugins ?? [];
  return `<section class="card"><div class="card-title"><div><h2>平台服务</h2><p>QQ 群文件、B 站、Bangumi、Markdown、本地回忆、回答剧本。</p></div></div><div class="grid-2">${plugins.map(plugin => `<article class="resource-card"><div class="zone-card-head"><h4>${esc(plugin.name)}</h4>${chip(plugin.status)}</div><p>${esc(plugin.description)}</p><div class="filters"><button class="btn btn-sm" type="button" data-plugin-config="${esc(plugin.id)}">配置</button></div></article>`).join('') || empty('没有平台服务。')}</div></section><section class="card section-gap"><div class="card-title"><div><h2>搜索服务</h2><p>${state.search ? (state.search.credentialConfigured ? '密钥已配置' : '密钥未配置') : '未读取'} · 为 web_search / web_fetch 提供后端。</p></div><button class="btn btn-sm" type="button" data-search-edit>${icon('tool')}配置搜索</button></div>${state.searchEditing ? renderSearchConfigForm() : `<div class="meta-list">${state.search ? `<span>${esc(state.search.settings.provider)}</span><span>${esc(state.search.settings.apiBase)}</span><span>${state.search.settings.enabled ? '已启用' : '未启用'}</span>` : ''}</div>`}</section>`;
}
function renderCapabilityExtensions() {
  return `<section class="card"><div class="card-title"><div><h2>原生扩展</h2><p>安装和启停状态；扩展配置可在能力配置中查看。</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>${(state.extensions ?? []).map(extension => `<tr><td>${esc(extension.manifest.name)}<br><small>${esc(extension.manifest.id)}</small></td><td>${esc(extension.manifest.version)}</td><td>${esc(extension.status)}</td><td><button class="btn btn-sm" type="button" data-extension-toggle="${esc(extension.manifest.id)}" data-extension-enabled="${!extension.enabled}" data-extension-revision="${extension.revision}">${extension.enabled ? '停用' : '启用'}</button></td></tr>`).join('')}</tbody></table>${(state.extensions ?? []).length ? '' : empty('没有原生扩展。')}</div><details class="library-admin section-gap"><summary>安装原生扩展</summary><div class="form-grid"><label>模块路径（NAS 上的绝对路径）<input id="extension-module" placeholder="/home/heyanhub/.../extension.js"></label><label class="check-line wide"><input id="extension-trusted" type="checkbox">我确认这是受信任的主机扩展</label><label class="wide">Manifest JSON<textarea id="extension-manifest" rows="6" placeholder='{"id":"example","name":"Example","version":"1.0.0","description":"...","tools":[],"commands":[]}'></textarea></label><button class="btn btn-sm" type="button" data-extension-install>安装扩展</button></div></details></section>`;
}
function renderCapabilitySearch() {
  return `<section class="card"><div class="card-title"><div><h2>网络搜索</h2><p>${state.search ? (state.search.credentialConfigured ? '密钥已配置' : '密钥未配置') : '未读取'}</p></div><button class="btn btn-sm" data-refresh>${icon('refresh')}刷新</button></div>${state.search ? `<form id="search-form" class="form-grid"><label class="check-line wide"><input name="enabled" type="checkbox" ${state.search.settings.enabled ? 'checked' : ''}>启用网络搜索</label><label>服务<select name="provider">${['deepseek','tavily','brave'].map(provider => `<option value="${provider}" ${state.search.settings.provider === provider ? 'selected' : ''}>${provider}</option>`).join('')}</select></label><label>API 地址<input name="apiBase" value="${esc(state.search.settings.apiBase)}"></label><label>密钥引用<input name="apiKeyEnv" value="${esc(state.search.settings.apiKeyEnv)}"></label><label>默认结果数<input name="defaultCount" type="number" min="1" max="50" value="${esc(state.search.settings.defaultCount)}"></label><label>最大结果数<input name="maxCount" type="number" min="1" max="50" value="${esc(state.search.settings.maxCount)}"></label><label>正文上限<input name="maxContentChars" type="number" min="100" max="50000" value="${esc(state.search.settings.maxContentChars)}"></label><button class="btn btn-primary btn-sm" type="submit">保存搜索配置</button></form>` : empty('无法读取搜索配置。')}</section>`;
}
function renderCapabilities() {
  const tabs = [['catalog','能力目录'],['services','服务配置'],['extensions','原生扩展']];
  if (state.capabilityTab === 'search') state.capabilityTab = 'catalog';
  if (state.capabilityTab === 'platforms') state.capabilityTab = 'services';
  const body = state.capabilityTab === 'services' ? renderCapabilityServices() : state.capabilityTab === 'extensions' ? renderCapabilityExtensions() : null;
  return `${pageHead('CAPABILITIES', '能力', '查看和管理 Agent 可用的工具与服务。', `<button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}<div class="ts-tabs filters" style="margin-bottom:14px">${tabs.map(([id,text]) => `<button type="button" class="${state.capabilityTab === id ? 'active' : ''}" data-capability-tab="${id}">${text}</button>`).join('')}</div>${body ?? renderCapabilityCatalog()}`;
}
function renderWorkspaceTab() {
  const zones = state.workspace?.zones ?? [];
  const zoneMatch = (zone) => state.resZone === 'all' || zone.zone === state.resZone;
  const filteredZones = zones.filter(zoneMatch);
  const skills = state.resType === 'mcp' ? [] : filteredZones.flatMap(zone => zone.skills);
  const mcp = state.resType === 'skill' ? [] : filteredZones.flatMap(zone => zone.mcp);
  const zoneTitle = (zone) => !zone ? '' : zone.zone === 'global' ? '全局' : zone.zone === 'agent' ? `Agent · ${zone.agentId}` : `会话 · ${zone.conversation?.platform}/${zone.conversation?.sessionType}/${zone.conversation?.sessionId}`;
  const skillZone = (skill) => zones.find(zone => zone.zone === skill.zone && (zone.zone !== 'agent' || zone.agentId === skill.agentId) && (zone.zone !== 'conversation' || (zone.conversation?.platform === skill.conversation?.platform && zone.conversation?.sessionType === skill.conversation?.sessionType && zone.conversation?.sessionId === skill.conversation?.sessionId)));
  return `<div class="workspace-meta card" style="display:flex;gap:9px;flex-wrap:wrap;align-items:center;padding:12px 14px;margin-bottom:14px"><span class="filter-label">WORKSPACE</span><code>${esc(state.workspace?.workspace?.root ?? '未配置')}</code>${chip(state.workspace?.workspace?.sandbox ? 'sandbox 开启' : 'sandbox 关闭', state.workspace?.workspace?.sandbox ? 'ok' : 'warn')}${chip(`${zones.reduce((n,z)=>n+z.skills.length,0)} Skill`)}${chip(`${zones.reduce((n,z)=>n+z.mcp.length,0)} MCP`)}</div>
  <div class="filters" style="margin-bottom:14px"><span class="filter-label">类型</span>${[['all','全部'],['skill','Skill'],['mcp','MCP']].map(([id,text]) => `<button class="filter-btn ${state.resType === id ? 'active' : ''}" type="button" data-res-type="${id}">${text}</button>`).join('')}<span class="filter-label" style="margin-left:12px">区域</span>${[['all','全部'],['global','全局'],['agent','Agent'],['conversation','会话']].map(([id,text]) => `<button class="filter-btn ${state.resZone === id ? 'active' : ''}" type="button" data-res-zone="${id}">${text}</button>`).join('')}</div>
  <div class="grid-3">${filteredZones.map(zoneCard).join('') || empty('没有匹配的区域。')}</div>
  <div class="grid-2 section-gap"><section class="card"><div class="card-title"><div><h2>Skill</h2><p>${skills.length} 项</p></div></div>${skills.map(skill => `<article class="resource-card" style="margin-bottom:9px"><div class="zone-card-head"><h4>${esc(skill.name)}</h4>${chip(zoneTitle(skillZone(skill)))}</div><p>${esc(skill.description)}</p><code>${esc(skill.path)}</code></article>`).join('') || empty(state.resType === 'mcp' ? '当前类型没有 Skill。' : '当前筛选没有 Skill。')}</section><section class="card"><div class="card-title"><div><h2>MCP</h2><p>${mcp.length} 项</p></div></div>${mcp.map(server => `<article class="resource-card" style="margin-bottom:9px"><div class="zone-card-head"><h4>${esc(server.id)}</h4>${chip(esc(server.zone))}</div><p>MCP 服务 · ${esc(server.transport)}</p><code>${esc(server.path)}</code></article>`).join('') || empty(state.resZone === 'conversation' ? '会话区不支持 MCP。' : '当前筛选没有 MCP。')}</section></div>`;
}

function renderPersonasTab() {
  const personas = state.personas?.personas ?? [];
  const bindings = state.personas?.bindings ?? [];
  const editing = state.personaEditing === 'new' ? null : personas.find(persona => persona.id === state.personaEditing);
  const form = state.personaEditing ? `<form id="persona-form" class="card resource-card" style="margin-top:12px"><div class="card-title"><div><h2>${editing ? '编辑人格' : '新建人格'}</h2><p>${editing ? esc(editing.id) : '保存后可在 Agent 中绑定。'}</p></div><button class="btn btn-sm" type="button" data-persona-cancel>取消</button></div><div class="form-grid"><label>名称<input name="name" value="${esc(editing?.name ?? '')}" required maxlength="120"></label><label class="wide">人格正文<textarea name="instructions" rows="8">${esc(editing?.instructions ?? '')}</textarea></label><label class="wide">权限不足时的回复<textarea name="customErrorMessage" rows="2">${esc(editing?.customErrorMessage ?? '')}</textarea></label><label class="wide">语音提示<textarea name="voicePrompt" rows="2">${esc(editing?.voicePrompt ?? '')}</textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')}保存人格</button>${editing ? `<button class="btn" type="button" data-persona-delete="${esc(editing.id)}">删除</button>` : ''}</div></form>` : '';
  return `<section class="card"><div class="card-title"><div><h2>人格</h2><p>${personas.length} 个人格；绑定在 Agent 中保存。</p></div><div class="filters"><button class="btn btn-sm" type="button" data-persona-new>${icon('plus')}新建人格</button><button class="btn btn-sm" data-refresh>${icon('refresh')}刷新</button></div></div><div class="grid-2">${personas.map(persona => `<article class="resource-card"><div class="zone-card-head"><h4>${esc(persona.displayName || persona.name || persona.id)}</h4>${chip(persona.id)}</div><p>${esc(persona.description || '没有人格说明')}</p><small>${bindings.filter(binding => binding.personaId === persona.id).map(binding => esc(binding.agentId)).join('、') || '未绑定 Agent'}</small><div class="filters"><button class="btn btn-sm" type="button" data-persona-edit="${esc(persona.id)}">编辑</button></div></article>`).join('') || empty('还没有人格。')}</div>${form}</section>`;
}

function renderModelsTab() {
  const connections = state.config?.connections ?? [];
  const editing = state.modelEditing === 'new' ? null : connections.find(item => item.id === state.modelEditing);
  const current = editing ?? { id: '', baseUrl: '', apiKeyEnv: 'OPENAI_API_KEY', protocol: 'responses' };
  const form = state.modelEditing ? `<form id="model-form" class="card resource-card" style="margin-top:12px"><div class="card-title"><div><h2>${editing ? '编辑模型服务' : '新增模型服务'}</h2><p>密钥只保存环境变量名或托管密钥名。</p></div><button class="btn btn-sm" type="button" data-model-cancel>取消</button></div><div class="form-grid"><label>ID<input name="id" value="${esc(current.id)}" ${editing ? 'readonly' : ''} required></label><label>API 地址<input name="baseUrl" value="${esc(current.baseUrl ?? '')}" placeholder="https://api.example.com/v1"></label><label>密钥环境变量或托管密钥名<input name="apiKeyEnv" value="${esc(current.apiKeyEnv ?? 'OPENAI_API_KEY')}" required></label><label>协议<select name="protocol"><option value="responses" ${current.protocol === 'responses' ? 'selected' : ''}>Responses</option><option value="chat_completions" ${current.protocol === 'chat_completions' ? 'selected' : ''}>Chat Completions</option></select></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')}保存模型服务</button>${editing ? `<button class="btn" type="button" data-model-delete="${esc(editing.id)}">删除</button>` : ''}</div></form>` : '';
  return `<section class="card"><div class="card-title"><div><h2>模型服务</h2><p>${connections.length} 个连接；Agent 只保存连接 ID。</p></div><div class="filters"><button class="btn btn-sm" type="button" data-model-new>${icon('plus')}新增模型服务</button><button class="btn btn-sm" data-refresh>${icon('refresh')}刷新</button></div></div><div class="grid-2">${connections.map(connection => `<article class="resource-card"><div class="zone-card-head"><h4>${esc(connection.id)}</h4>${chip(connection.protocol === 'responses' ? 'Responses' : 'Chat Completions')}</div><p>${esc(connection.baseUrl || '使用默认 API 地址')}</p><code>密钥 · ${esc(connection.apiKeyEnv)}</code><div class="filters"><button class="btn btn-sm" type="button" data-model-edit="${esc(connection.id)}">编辑</button></div></article>`).join('') || empty('还没有模型服务。')}</div>${form}</section>`;
}

function renderKnowledgeTab() {
  const libraries = state.config?.knowledgeLibraries ?? [];
  const docs = state.knowledgeDocs ?? [];
  return `<section class="card"><div class="card-title"><div><h2>知识库</h2><p>导入文本、Markdown 或 PDF；索引完成后可检索。</p></div><button class="btn btn-sm" type="button" data-knowledge-refresh>${icon('refresh')}刷新</button></div><details class="library-admin"><summary>管理知识库（${libraries.length}）</summary><div class="filters">${libraries.map(library => `<span class="chip">${esc(library.displayName || library.id)} <button class="chip-remove" type="button" data-library-remove="knowledgeLibraries" data-library-id="${esc(library.id)}">×</button></span>`).join('') || '<span class="muted">暂无知识库</span>'}</div><form id="knowledge-library-form" class="form-grid"><label>库 ID<input name="id" required placeholder="例如 handbook"></label><label>显示名称<input name="displayName" required placeholder="例如 工作手册"></label><button class="btn btn-sm" type="submit">新建知识库</button></form></details><div class="form-grid"><label>知识库<select data-knowledge-library><option value="">选择知识库</option>${libraries.map(library => `<option value="${esc(library.id)}" ${library.id === state.knowledgeLibrary ? 'selected' : ''}>${esc(library.displayName || library.id)}</option>`).join('')}</select></label><label>导入文件（最大 10 MiB）<input type="file" accept=".txt,.md,.pdf" data-knowledge-import></label></div>
  <div class="table-wrap section-gap"><table class="table"><thead><tr><th>文档</th><th>状态</th><th>版本 / 分块</th><th>操作</th></tr></thead><tbody>${docs.map(document => `<tr><td>${esc(document.name)}${document.error ? `<p class="app-error">${esc(document.error)}</p>` : ''}</td><td>${esc(label(document.status))}</td><td>v${document.version} / ${document.chunkCount}</td><td><div class="filters"><button class="btn btn-sm" type="button" data-knowledge-reindex="${esc(document.id)}">重建索引</button><button class="btn btn-sm" type="button" data-knowledge-delete="${esc(document.id)}">删除</button></div></td></tr>`).join('')}</tbody></table>${docs.length ? '' : empty(state.knowledgeLibrary ? '这个知识库还没有文档。' : '先选择一个知识库。')}</div>
  <form class="filters section-gap" data-knowledge-search><input id="knowledge-query" type="search" placeholder="输入检索问题" value="${esc(state.knowledgeQuery ?? '')}" required><button class="btn btn-sm" type="submit">检索</button></form>
  <div class="section-gap">${(state.knowledgeHits ?? []).map(hit => `<article class="resource-card" style="margin-bottom:9px"><strong>${esc(hit.documentName)} · v${hit.version}</strong><p>${esc(hit.text)}</p><small>得分 ${Number(hit.score).toFixed(3)}</small></article>`).join('') || (state.knowledgeQuery ? empty('没有检索结果。') : '')}</div></section>`;
}

function renderMemoriesTab() {
  const libraries = state.config?.memoryLibraries ?? [];
  const agents = state.config?.agents ?? [];
  const memories = state.memories ?? [];
  return `<section class="card"><div class="card-title"><div><h2>长期记忆</h2><p>按库查看；新增和编辑立即生效。</p></div><button class="btn btn-sm" type="button" data-memory-refresh>${icon('refresh')}刷新</button></div><details class="library-admin"><summary>管理记忆库（${libraries.length}）</summary><div class="filters">${libraries.map(library => `<span class="chip">${esc(library.displayName || library.id)} <button class="chip-remove" type="button" data-library-remove="memoryLibraries" data-library-id="${esc(library.id)}">×</button></span>`).join('') || '<span class="muted">暂无记忆库</span>'}</div><form id="memory-library-form" class="form-grid"><label>库 ID<input name="id" required placeholder="例如 personal"></label><label>显示名称<input name="displayName" required placeholder="例如 个人记忆"></label><button class="btn btn-sm" type="submit">新建记忆库</button></form></details><div class="form-grid"><label>记忆库<select data-memory-library><option value="">选择记忆库</option>${libraries.map(library => `<option value="${esc(library.id)}" ${library.id === state.memoryLibrary ? 'selected' : ''}>${esc(library.displayName || library.id)}</option>`).join('')}</select></label><label>Agent<select id="memory-agent">${agents.map(agent => `<option value="${esc(agent.id)}">${esc(agent.displayName || agent.id)}</option>`).join('')}</select></label><label>作用域<select id="memory-scope"><option value="sender">发送者</option><option value="session">会话</option><option value="agent">Agent</option></select></label><label>平台<input id="memory-platform" value="dashboard"></label><label>发送者<input id="memory-sender" value="local"></label><label>会话 ID<input id="memory-session" value="dashboard"></label></div><label class="wide">新记忆<textarea id="memory-text" rows="2" placeholder="一条可验证的长期事实"></textarea></label><div class="filters"><button class="btn btn-primary btn-sm" type="button" data-memory-add>保存记忆</button></div>
  <div class="section-gap">${memories.map(memory => `<article class="resource-card" style="margin-bottom:9px">${state.memoryEditing === memory.id ? `<textarea id="memory-edit-text" rows="3">${esc(memory.text)}</textarea><div class="filters"><button class="btn btn-sm" type="button" data-memory-save="${esc(memory.id)}">保存修改</button><button class="btn btn-sm" type="button" data-memory-cancel>取消</button></div>` : `<p>${esc(memory.text)}</p><small>${esc(memory.agentId)} · ${esc(memory.scope)} · ${esc(memory.principal?.platform)} / ${esc(memory.principal?.sessionType ?? '')} ${esc(memory.principal?.sessionId)} · ${esc(memory.principal?.senderId)}</small><div class="filters"><button class="btn btn-sm" type="button" data-memory-edit="${esc(memory.id)}">编辑</button><button class="btn btn-sm" type="button" data-memory-delete="${esc(memory.id)}">删除</button></div>`}</article>`).join('') || empty(state.memoryLibrary ? '这个记忆库为空。' : '先选择一个记忆库。')}</div></section></section>`;
}

function renderResources() {
  const tabs = [['workspace','Skill / MCP'],['personas','人格'],['knowledge','知识库'],['memories','长期记忆'],['models','模型服务']];
  const body = state.resourceTab === 'personas' ? renderPersonasTab() : state.resourceTab === 'knowledge' ? renderKnowledgeTab() : state.resourceTab === 'memories' ? renderMemoriesTab() : state.resourceTab === 'models' ? renderModelsTab() : renderWorkspaceTab();
  return `${pageHead('RESOURCES', '资源', '管理 Skill、MCP、人格、知识库和记忆。', `<button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}<div class="ts-tabs filters" style="margin-bottom:14px">${tabs.map(([id,text]) => `<button type="button" class="${state.resourceTab === id ? 'active' : ''}" data-resource-tab="${id}">${text}</button>`).join('')}</div>${body}`;
}

function renderSystem() {
  const workspace = state.workspace?.workspace;
  return `${pageHead('SYSTEM', '系统', '工作区、配置版本、密钥和审计。', `<button class="btn" data-refresh>${icon('refresh')}刷新</button>`)}<div class="grid-2"><section class="card"><div class="card-title"><div><h2>工作区</h2><p>单 workspace；sandbox 只影响工具运行位置。</p></div></div><div class="stack"><div class="meta-list">${chip(workspace?.sandbox ? 'sandbox 开启' : 'sandbox 关闭', workspace?.sandbox ? 'ok' : 'warn')}${chip(`revision ${state.revision}`)}</div><label class="filter-label">ROOT</label><code style="font-size:11px;overflow-wrap:anywhere">${esc(workspace?.root ?? '未配置')}</code><div class="meta-list">${(state.environments ?? []).map(env => chip(`${env.id} · ${env.type} · ${env.available ? '可用' : '不可用'}`, env.available ? 'ok' : 'warn')).join('')}</div></div></section><section class="card"><div class="card-title"><div><h2>管理服务</h2><p>当前登录的管理会话。</p></div></div><div class="stack"><div class="meta-list">${chip(`Agent ${state.config?.agents?.length ?? 0}`)}${chip(`IM ${state.config?.platforms?.length ?? 0}`)}${chip(`连接 ${state.config?.connections?.length ?? 0}`)}</div><div class="filters"><button class="btn btn-sm" type="button" data-export>${icon('folder')}导出配置</button><button class="btn btn-sm" type="button" data-logout>退出登录</button></div><small class="muted">配置保存会创建新 revision。</small></div></section></div>
  <section class="card section-gap"><div class="card-title"><div><h2>配置版本</h2><p>恢复历史修订会创建新 revision；导入配置会进入当前 revision。</p></div></div><div class="form-grid"><label>恢复到修订<input id="rollback-revision" type="number" min="0" value="${Math.max(0, state.revision - 1)}"></label><label>导入配置（JSON）<input id="config-import" type="file" accept="application/json,.json"></label><button class="btn btn-sm" type="button" data-rollback>恢复历史修订</button></div></section>
  <section class="card section-gap"><div class="card-title"><div><h2>服务端密钥</h2><p>用于模型、IM 和插件；值不回显、不导出。</p></div><button class="btn btn-sm" data-refresh>${icon('refresh')}刷新</button></div><div class="form-grid"><label>密钥名称<input id="secret-name" placeholder="DEEPSEEK_API_KEY"></label><label>密钥值<input id="secret-value" type="password" autocomplete="new-password"></label><button class="btn btn-primary btn-sm" type="button" data-secret-save>保存密钥</button></div><div class="table-wrap section-gap"><table class="table"><thead><tr><th>名称</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${(state.secrets ?? []).map(secret => `<tr><td>${esc(secret.name)}</td><td>${esc(time(secret.updatedAt))}</td><td><button class="btn btn-sm" type="button" data-secret-delete="${esc(secret.name)}">删除</button></td></tr>`).join('')}</tbody></table>${(state.secrets ?? []).length ? '' : empty('暂无托管密钥；可使用环境变量。')}</div></section>
  <section class="card section-gap"><div class="card-title"><div><h2>管理审计</h2><p>最近 2000 条，不记录请求正文和密钥值。</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>操作</th><th>目标</th><th>结果</th></tr></thead><tbody>${(state.audit ?? []).slice(0, 30).map(record => `<tr><td>${esc(time(record.timestamp))}</td><td>${esc(record.action)}</td><td>${esc(record.target)}</td><td>${record.outcome === 'success' ? '成功' : '失败'}</td></tr>`).join('')}</tbody></table>${(state.audit ?? []).length ? '' : empty('暂无审计记录。')}</div></section>`;
}

function renderRun() {
  const data = state.runDetail;
  if (!data) { $('#run-body').innerHTML = state.runError ? `<p class="app-error">${esc(state.runError)}</p>` : '<p class="empty-line">正在读取运行…</p>'; return; }
  const record = data.record;
  const approval = record.status === 'paused' ? [...(data.events ?? [])].reverse().find(event => event.type === 'paused') : undefined;
  const active = ['running', 'queued', 'paused'].includes(record.status);
  const events = (data.events ?? []).filter(event => !['message_delta', 'message_snapshot'].includes(event.type)).slice(-80);
  const artifactRows = (data.artifacts ?? []).map(item => `<button class="btn btn-sm" type="button" data-artifact="${esc(item.id)}" data-artifact-name="${esc(item.name)}">${icon('folder')}${esc(item.name)}</button>`).join('');
  const eventHtml = events.map(event => {
    if (event.type === 'tool') return `<div class="run-event"><span class="chip ${event.status === 'failed' ? 'bad' : event.status === 'completed' ? 'ok' : 'warn'}">Tool · ${esc(event.status)}</span><div><strong>${esc(event.name)}</strong><p>${esc(event.summary)}</p>${event.inputPreview?.text ? `<code>${esc(event.inputPreview.text.slice(0, 260))}</code>` : ''}</div></div>`;
    if (event.type === 'model_call') return `<div class="run-event"><span class="chip">模型</span><div><strong>${esc(event.model)} · ${esc(event.status)}</strong><p>${event.durationMs ? `${Math.round(event.durationMs)} ms` : ''}${event.inputTokens !== undefined ? ` · in ${event.inputTokens} / out ${event.outputTokens ?? 0}` : ''}</p></div></div>`;
    if (event.type === 'paused') return `<div class="run-event"><span class="chip warn">审批</span><div><strong>等待工具审批</strong><p>${esc((event.tools ?? []).join('、'))}</p></div></div>`;
    if (event.type === 'failed') return `<div class="run-event"><span class="chip bad">失败</span><div><strong>运行失败</strong><p>${esc(event.error?.message ?? '')}</p></div></div>`;
    if (event.type === 'cancelled') return `<div class="run-event"><span class="chip">停止</span><div><strong>已取消</strong><p>${esc(event.reason)}</p></div></div>`;
    if (event.type === 'completed') return `<div class="run-event"><span class="chip ok">完成</span><div><strong>最终回复</strong><p>${esc(event.text.slice(0, 600))}</p></div></div>`;
    if (event.type === 'node') return `<div class="run-event"><span class="chip">路由</span><div><strong>${esc(event.nodeId)} · ${esc(event.status)}</strong><p>${esc(event.summary)}</p></div></div>`;
    return '';
  }).join('');
  $('#run-title').textContent = `${agentName(record.agentId)} · ${label(record.status)}`;
  $('#run-subtitle').textContent = `${time(record.createdAt)} · ${record.id}`;
  $('#run-body').innerHTML = `<div class="run-actions">${active ? '<button class="btn btn-sm" type="button" data-run-cancel>停止运行</button>' : ''}<button class="btn btn-sm" type="button" data-run-export>导出记录</button><button class="btn btn-sm" type="button" data-run-close>关闭</button></div>
    ${approval ? `<section class="run-approval"><h3>等待工具审批</h3><p>待执行：${esc((approval.tools ?? []).join('、'))}。批准不会提升权限。</p><div class="filters"><button class="btn btn-primary btn-sm" type="button" data-run-approve="yes">批准本次</button><button class="btn btn-sm" type="button" data-run-approve="no">拒绝本次</button></div></section>` : ''}
    <div class="run-summary"><div class="meta-list">${statusChip(record.status)}${chip(record.agentId)}${chip(record.model ?? '模型未记录')}${record.runtimeState ? chip(record.runtimeState) : ''}${record.durationMs ? chip(`${Math.round(record.durationMs)} ms`) : ''}</div><p>${esc(record.summary || '')}</p>${data.inputPreview?.text ? `<details><summary>输入预览</summary><code>${esc(data.inputPreview.text)}</code></details>` : ''}</div>
    <section class="run-section"><div class="card-title"><h3>执行轨迹</h3><span class="chip">${events.length}</span></div><div class="run-events">${eventHtml || empty('没有可显示的轨迹事件。')}</div></section>
    <section class="run-section"><div class="card-title"><h3>进程</h3><span class="chip">${(state.runProcesses ?? []).length}</span></div>${(state.runProcesses ?? []).length ? `<div class="run-events">${state.runProcesses.map(process => `<div class="run-event"><span class="chip ${process.status === 'running' ? 'warn' : process.status === 'failed' ? 'bad' : 'ok'}">${esc(process.status)}</span><div><strong>${esc(process.id)}</strong><p>${esc((process.output ?? '').slice(0, 180))}</p><button class="btn btn-sm" type="button" data-process-kill="${esc(process.id)}" ${process.status === 'running' ? '' : 'disabled'}>终止进程</button></div></div>`).join('')}</div>` : empty('本次运行没有独立进程。')}</section>
    ${artifactRows ? `<section class="run-section"><div class="card-title"><h3>产物</h3></div><div class="filters">${artifactRows}</div></section>` : ''}
    <section class="run-section"><div class="card-title"><h3>审计</h3></div><p class="helper">保留事件 ${data.audit?.retainedEvents ?? 0}${data.audit?.eventsTruncated ? ' · 已截断' : ''} · ${esc((data.audit?.limitations ?? []).join('；'))}</p></section>`;
  bindRun();
}
function agentName(id) { return (state.config?.agents ?? []).find(agent => agent.id === id)?.displayName ?? id; }
async function openRun(id) {
  $('#run-modal').hidden = false; state.runDetail = null; state.runError = ''; renderRun();
  try { state.runDetail = await api(`agent-records/${encodeURIComponent(id)}`); state.runProcesses = ['running', 'queued', 'paused'].includes(state.runDetail.record.status) ? ((await api(`processes?runId=${encodeURIComponent(id)}`).catch(() => ({ processes: [] }))).processes ?? []) : []; }
  catch (error) { state.runError = error.message; }
  renderRun();
}
function closeRun() { $('#run-modal').hidden = true; state.runDetail = null; state.runError = ''; }
async function runAction(path, body, message) {
  try { await api(path, { method: 'POST', body }); toast(message); await openRun(state.runDetail?.record.id ?? ''); await loadAll(); }
  catch (error) { showError(error.message); }
}
function bindRun() {
  $('#run-close')?.addEventListener('click', closeRun);
  $$('[data-run-close]').forEach(button => button.addEventListener('click', closeRun));
  $('[data-run-cancel]')?.addEventListener('click', () => { const id = state.runDetail?.record.id; if (id) void runAction(`runs/${encodeURIComponent(id)}/cancel`, {}, '停止请求已提交'); });
  $('[data-run-export]')?.addEventListener('click', async () => { const id = state.runDetail?.record.id; if (!id) return; try { const data = await api(`agent-records/${encodeURIComponent(id)}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `agent-run-${id.slice(0, 12)}.json`; link.click(); URL.revokeObjectURL(url); } catch (error) { showError(error.message); } });
  $$('[data-run-approve]').forEach(button => button.addEventListener('click', () => { const id = state.runDetail?.record.id; const approval = state.runDetail?.events ? [...state.runDetail.events].reverse().find(event => event.type === 'paused') : undefined; if (id && approval) void runAction(`runs/${encodeURIComponent(id)}/approval`, { approvalId: approval.approvalId, approved: button.dataset.runApprove === 'yes' }, '审批已提交'); }));
  $$('[data-process-kill]').forEach(button => button.addEventListener('click', async () => { const runId = state.runDetail?.record.id; if (!runId) return; try { await api(`processes/${encodeURIComponent(button.dataset.processKill)}/kill`, { method: 'POST', body: { runId } }); toast('进程终止已提交'); await openRun(runId); } catch (error) { showError(error.message); } }));
  $$('[data-artifact]').forEach(button => button.addEventListener('click', async () => { try { const response = await fetch(`/api/ts/artifacts/${encodeURIComponent(button.dataset.artifact)}`, { credentials: 'same-origin' }); if (!response.ok) throw new Error('产物下载失败'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = button.dataset.artifactName || 'artifact'; link.click(); URL.revokeObjectURL(url); } catch (error) { showError(error.message); } }));
}

async function openConversations() {
  $('#conversations-modal').hidden = false; state.conversationDetail = null; state.conversationSearch = '';
  await loadConversations();
}
async function loadConversations() {
  try { const query = state.conversationSearch ? `&search=${encodeURIComponent(state.conversationSearch)}` : ''; state.conversations = (await api(`conversations?archived=all${query}`)).conversations ?? []; }
  catch (error) { showError(error.message); }
  renderConversations();
}
function renderConversations() {
  const list = state.conversations ?? [];
  const detail = state.conversationDetail;
  const rows = list.map(item => `<button class="conversation-row ${detail?.conversation?.id === item.id ? 'active' : ''}" type="button" data-conversation="${esc(item.id)}"><strong>${esc(item.title)}</strong><small>${esc(item.platform)} / ${esc(item.sessionType)} · ${esc(item.agentId)} · ${item.archived ? '已归档' : '活动'}</small><span>${esc(time(item.updatedAt))}</span></button>`).join('');
  const entries = detail?.entries ?? [];
  $('#conversations-body').innerHTML = `<div class="conversation-toolbar"><form class="filters" data-conversation-search><input type="search" placeholder="搜索会话标题" value="${esc(state.conversationSearch)}"><button class="btn btn-sm" type="submit">搜索</button></form><span class="chip">${list.length} 个</span></div><div class="conversation-layout"><aside class="conversation-list">${rows || empty('没有会话。')}</aside><section class="conversation-detail">${detail ? `<div class="detail-head"><div><h2>${esc(detail.conversation.title)}</h2><p>${esc(detail.conversation.platform)} / ${esc(detail.conversation.sessionType)} · ${esc(detail.conversation.agentId)} · ${detail.conversation.archived ? '已归档' : '活动'}</p></div><div class="filters"><button class="btn btn-sm" type="button" data-conversation-archive>${detail.conversation.archived ? '取消归档' : '归档'}</button><button class="btn btn-sm" type="button" data-conversation-delete>删除</button></div></div><div class="conversation-entries">${entries.map(entry => `<article class="conversation-entry ${entry.role === 'user' ? 'user' : 'assistant'}"><div class="meta-list">${chip(entry.role === 'user' ? '用户' : '助手')}<small>${esc(entry.senderName || entry.senderId)} · ${esc(time(entry.timestamp))}</small></div><p>${esc((entry.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'))}</p></article>`).join('') || empty('这个会话还没有消息。')}</div><button class="btn btn-sm" type="button" data-conversation-export>导出会话</button>` : empty('选择一个会话查看内容。')}</section></div>`;
  bindConversations();
}
async function openConversation(id) {
  try { state.conversationDetail = await api(`conversations/${encodeURIComponent(id)}`); renderConversations(); }
  catch (error) { showError(error.message); }
}
async function archiveConversation() {
  const detail = state.conversationDetail; if (!detail) return;
  const conversation = detail.conversation;
  try { await api(`conversations/${encodeURIComponent(conversation.id)}`, { method: 'PUT', body: { title: conversation.title, folderId: conversation.folderId ?? null, archived: !conversation.archived, expectedRevision: conversation.revision } }); await openConversation(conversation.id); await loadConversations(); }
  catch (error) { showError(error.message); }
}
async function deleteConversation() {
  const detail = state.conversationDetail; if (!detail) return;
  if (!window.confirm('删除这个会话及其记录？无法恢复。')) return;
  try { await api(`conversations/${encodeURIComponent(detail.conversation.id)}`, { method: 'DELETE', body: { expectedRevision: detail.conversation.revision } }); state.conversationDetail = null; await loadConversations(); }
  catch (error) { showError(error.message); }
}
function bindConversations() {
  $('#conversations-close')?.addEventListener('click', () => { $('#conversations-modal').hidden = true; });
  $$('[data-conversation]').forEach(button => button.addEventListener('click', () => { void openConversation(button.dataset.conversation); }));
  $('[data-conversation-search]')?.addEventListener('submit', event => { event.preventDefault(); state.conversationSearch = event.target.querySelector('input')?.value ?? ''; void loadConversations(); });
  $('[data-conversation-archive]')?.addEventListener('click', () => { void archiveConversation(); });
  $('[data-conversation-delete]')?.addEventListener('click', () => { void deleteConversation(); });
  $('[data-conversation-export]')?.addEventListener('click', async () => { const detail = state.conversationDetail; if (!detail) return; try { const data = await api(`conversations/${encodeURIComponent(detail.conversation.id)}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `conversation-${detail.conversation.id.slice(0, 12)}.json`; link.click(); URL.revokeObjectURL(url); } catch (error) { showError(error.message); } });
}

async function openCapabilityConfig(id) {
  $('#capability-modal').hidden = false; state.capabilityPlugin = id; state.capabilityRecord = null; state.capabilityQr = null; state.capabilityNotice = ''; $('#capability-body').innerHTML = '<p class="empty-line">正在读取配置…</p>';
  try {
    const catalogue = await api('plugins');
    const plugin = (catalogue.plugins ?? []).find(item => item.id === id);
    state.capabilityPlugin = plugin?.id ?? id;
    state.capabilityRecord = plugin?.record ?? await api(`plugins/${encodeURIComponent(id)}`);
    state.capabilityStatus = (await api(`plugins/${encodeURIComponent(id)}/status`)).details ?? [];
    state.capabilitySubscriptions = ['bili_video','bangumi'].includes(id) ? (await api(`plugins/${encodeURIComponent(id)}/subscriptions`).catch(() => ({ subscriptions: [] }))).subscriptions ?? [] : [];
  } catch (error) { state.capabilityNotice = error.message; }
  renderCapabilityConfig();
}
function pluginSpecificForm(plugin, settings) {
  const check = (name, value, label) => `<label class="check-line"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${label}</label>`;
  if (plugin === 'response_scenes') return `<div class="form-grid">${check('enabled', settings.enabled, '启用回答剧本')}<label class="wide">应用 Agent（逗号分隔，空为全部）<input name="agentIds" value="${esc((settings.agentIds ?? []).join(', '))}"></label><button class="btn btn-primary btn-sm" type="submit">保存回答剧本设置</button></div>`;
  if (plugin === 'qq_file') return `<div class="form-grid">${check('enabled', settings.enabled, '启用 QQ 群文件能力')}<label>访问模式<select name="access_mode">${['all','allowlist','denylist'].map(value => `<option value="${value}" ${settings.access_mode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>群 ID（逗号分隔）<input name="group_list" value="${esc((settings.group_list ?? []).join(', '))}"></label><label>文件列表上限<input name="max_file_list_limit" type="number" min="1" max="100" value="${esc(settings.max_file_list_limit ?? 50)}"></label><label>搜索文件夹上限<input name="max_search_folders" type="number" min="1" max="200" value="${esc(settings.max_search_folders ?? 30)}"></label><label class="check-line wide"><input type="checkbox" name="upload_auto_process" ${settings.upload_auto_process ? 'checked' : ''}>上传后自动处理</label><button class="btn btn-primary btn-sm" type="submit">保存 QQ 群文件设置</button></div>`;
  if (plugin === 'markdown_killer') return `<div class="form-grid">${check('enabled', settings.enabled, '启用 Markdown 整理')}${check('globalCleanup', settings.globalCleanup, '全局清理')}${check('tableRender', settings.tableRender, '渲染表格')}${check('formulaRender', settings.formulaRender, '渲染公式')}<label>换行模式<select name="newlineMode">${['segment_boundary','global','preserve'].map(value => `<option value="${value}" ${settings.newlineMode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>表格降级<select name="tableFallback">${['text','raw','remove'].map(value => `<option value="${value}" ${settings.tableFallback === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>公式降级<select name="formulaFallback">${['text','raw','remove'].map(value => `<option value="${value}" ${settings.formulaFallback === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>最大渲染字符<input name="maxRenderChars" type="number" min="100" max="100000" value="${esc(settings.maxRenderChars ?? 20000)}"></label><label>超时（毫秒）<input name="timeoutMs" type="number" min="1000" max="60000" value="${esc(settings.timeoutMs ?? 15000)}"></label><label>最大图片数<input name="maxImages" type="number" min="1" max="12" value="${esc(settings.maxImages ?? 6)}"></label><button class="btn btn-primary btn-sm" type="submit">保存 Markdown 设置</button></div>`;
  if (plugin === 'bangumi') return `<div class="form-grid">${check('enabled', settings.enabled, '启用 Bangumi')}${check('autoPush', settings.autoPush, '订阅推送')}${check('outputImage', settings.outputImage, '输出图片')}<label>Token 密钥名<input name="tokenSecret" value="${esc(settings.tokenSecret ?? 'BANGUMI_TOKEN')}"></label><label>代理 URL 密钥名<input name="proxyUrlSecret" value="${esc(settings.proxyUrlSecret ?? '')}"></label><label>检查间隔（分钟）<input name="pollMinutes" type="number" min="5" max="1440" value="${esc(settings.pollMinutes ?? 60)}"></label><label>最大订阅数<input name="maxSubscriptions" type="number" min="1" max="100" value="${esc(settings.maxSubscriptions ?? 20)}"></label><label>时区<input name="timezone" value="${esc(settings.timezone ?? 'Asia/Shanghai')}"></label><label>模板<select name="template">${['classic','minimal','cinematic_poster'].map(value => `<option value="${value}" ${settings.template === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><button class="btn btn-primary btn-sm" type="submit">保存 Bangumi 设置</button></div>`;
  if (plugin === 'local_reminiscence') { const embedding = settings.embedding ?? {}; return `<div class="form-grid">${check('enabled', settings.enabled, '启用本地回忆')}${check('realtimeRecording', settings.realtimeRecording, '实时记录')}${check('autoRecall', settings.autoRecall, '自动召回')}${check('autoSummary', settings.autoSummary, '自动总结')}<label>时区<input name="timezone" value="${esc(settings.timezone ?? 'Asia/Shanghai')}"></label><label>日期边界小时<input name="dayBoundaryHour" type="number" min="0" max="23" value="${esc(settings.dayBoundaryHour ?? 4)}"></label><label>日期边界分钟<input name="dayBoundaryMinute" type="number" min="0" max="59" value="${esc(settings.dayBoundaryMinute ?? 0)}"></label><label>目标会话（逗号分隔）<input name="targetSessions" value="${esc((settings.targetSessions ?? []).join(', '))}"></label><label>召回条数<input name="topResults" type="number" min="1" max="20" value="${esc(settings.topResults ?? 5)}"></label><label>上下文上限<input name="maxContextChars" type="number" min="500" max="16000" value="${esc(settings.maxContextChars ?? 5000)}"></label><label>摘要上限<input name="maxSummaryChars" type="number" min="2000" max="100000" value="${esc(settings.maxSummaryChars ?? 40000)}"></label><label>保留天数<input name="retentionDays" type="number" min="1" max="3650" value="${esc(settings.retentionDays ?? 365)}"></label><label>单范围记录上限<input name="maxRecordsPerScope" type="number" min="50" max="20000" value="${esc(settings.maxRecordsPerScope ?? 5000)}"></label><label>最小相似度<input name="minSimilarity" type="number" min="0" max="1" step="0.01" value="${esc(settings.minSimilarity ?? 0.05)}"></label><label>检索模式<select name="embeddingMode">${['lexical','local_endpoint'].map(value => `<option value="${value}" ${embedding.mode === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>Embedding 地址<input name="embeddingEndpoint" value="${esc(embedding.endpoint ?? 'http://127.0.0.1:11434/v1/embeddings')}"></label><label>Embedding 模型<input name="embeddingModel" value="${esc(embedding.model ?? 'all-minilm')}"></label><label>Embedding 超时<input name="embeddingTimeoutMs" type="number" min="1000" max="60000" value="${esc(embedding.timeoutMs ?? 15000)}"></label><button class="btn btn-primary btn-sm" type="submit">保存回忆设置</button></div>`; }
  return '';
}

function renderCapabilityConfig() {
  const record = state.capabilityRecord;
  const plugin = state.capabilityPlugin;
  $('#capability-title').textContent = plugin ?? '平台能力配置';
  $('#capability-subtitle').textContent = record ? `revision ${record.revision}` : '';
  if (!record) { $('#capability-body').innerHTML = `<p class="app-error">${esc(state.capabilityNotice || '配置读取失败')}</p>`; bindCapabilityConfig(); return; }
  const qr = state.capabilityQr;
  const statusRows = state.capabilityStatus.map(item => `<span class="chip">${esc(item.label)} · ${esc(item.value)}</span>`).join('');
  $('#capability-body').innerHTML = `<div class="run-summary"><div class="meta-list">${statusRows || chip('暂无状态')}</div>${state.capabilityNotice ? `<p class="app-error">${esc(state.capabilityNotice)}</p>` : ''}<p class="helper">配置由平台能力自身管理；保存会创建插件配置 revision。B 站登录凭据不会显示在此页。</p></div>
    ${plugin === 'bili_video' ? `<section class="run-section"><div class="card-title"><h3>B 站扫码登录</h3></div>${qr ? `<div class="qr-login"><div class="qr-code" id="plugin-qr"></div><p>使用哔哩哔哩 App 扫码；也可以在手机上打开链接：</p><a class="btn btn-primary btn-sm" href="${esc(qr.url)}" target="_blank" rel="noopener">打开扫码链接</a><div class="filters"><button class="btn btn-sm" type="button" data-plugin-poll>检查扫码状态</button><button class="btn btn-sm" type="button" data-plugin-cancel-qr>取消</button></div><code>${esc(qr.url)}</code></div>` : `<div class="filters"><button class="btn btn-primary btn-sm" type="button" data-plugin-login>${icon('im')}生成扫码登录链接</button><button class="btn btn-sm" type="button" data-plugin-logout>清除登录凭据</button></div>`}</section>` : ''}
    ${['bili_video','bangumi'].includes(plugin) ? `<section class="run-section"><div class="card-title"><h3>订阅</h3><span class="chip">${(state.capabilitySubscriptions ?? []).length}</span></div>${(state.capabilitySubscriptions ?? []).map(sub => `<div class="run-event"><span class="chip">${esc(sub.platform)}</span><div><strong>${esc(sub.target)}</strong><p>${esc(sub.sessionId)} · 下次 ${esc(time(sub.nextAt))}${sub.error ? ` · ${esc(sub.error)}` : ''}</p><button class="btn btn-sm" type="button" data-plugin-subscription-remove="${esc(sub.id)}">取消订阅</button></div></div>`).join('') || empty('没有订阅。')}</section>` : ''}
    ${plugin === 'bili_video' ? `<section class="run-section"><div class="card-title"><h3>B 站设置</h3></div><form id="bili-settings-form" class="form-grid"><label class="check-line wide"><input name="enabled" type="checkbox" ${record.settings.enabled ? 'checked' : ''}>启用 B 站能力</label><label class="check-line"><input name="autoDetect" type="checkbox" ${record.settings.autoDetect ? 'checked' : ''}>自动识别链接</label><label class="check-line"><input name="autoSummary" type="checkbox" ${record.settings.autoSummary ? 'checked' : ''}>自动总结视频</label><label class="check-line"><input name="autoPush" type="checkbox" ${record.settings.autoPush ? 'checked' : ''}>开启订阅推送</label><label>访问模式<select name="accessMode"><option value="blacklist" ${record.settings.accessMode === 'blacklist' ? 'selected' : ''}>黑名单</option><option value="whitelist" ${record.settings.accessMode === 'whitelist' ? 'selected' : ''}>白名单</option></select></label><label>群 ID（逗号分隔）<input name="groupIds" value="${esc((record.settings.groupIds ?? []).join(', '))}"></label><label>检查间隔（分钟）<input name="pollMinutes" type="number" min="5" max="1440" value="${esc(record.settings.pollMinutes ?? 600)}"></label><label>最大订阅数<input name="maxSubscriptions" type="number" min="1" max="100" value="${esc(record.settings.maxSubscriptions ?? 20)}"></label><label>摘要风格<select name="summaryStyle">${['concise','detailed','professional'].map(value => `<option value="${value}" ${record.settings.summaryStyle === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label>摘要最大字符<input name="maxSummaryChars" type="number" min="500" max="10000" value="${esc(record.settings.maxSummaryChars ?? 3000)}"></label><button class="btn btn-primary btn-sm" type="submit">保存 B 站设置</button></form></section>` : ''}
    ${plugin !== 'bili_video' && ['response_scenes','qq_file','markdown_killer','bangumi','local_reminiscence'].includes(plugin) ? `<section class="run-section"><div class="card-title"><h3>专用设置</h3></div><form id="plugin-settings-form" data-plugin-specific="${plugin}">${pluginSpecificForm(plugin, record.settings)}</form></section>` : ''}
    <section class="run-section"><div class="card-title"><h3>配置</h3><span class="chip">原始 settings</span></div><textarea id="plugin-settings" class="plugin-settings" rows="12">${esc(JSON.stringify(record.settings, null, 2))}</textarea><div class="filters"><button class="btn btn-primary btn-sm" type="button" data-plugin-save>保存配置</button><span class="muted">只改需要改的字段；保存会校验对应能力设置。</span></div></section>`;
  bindCapabilityConfig();
}
async function savePluginSpecific(form, plugin) {
  const data = new FormData(form); const record = state.capabilityRecord; if (!record) return;
  const settings = { ...record.settings };
  const bool = (name) => form.elements[name]?.checked ?? false;
  if (plugin === 'response_scenes') { settings.enabled = bool('enabled'); settings.agentIds = String(data.get('agentIds')).split(',').map(value => value.trim()).filter(Boolean); }
  if (plugin === 'qq_file') { settings.enabled = bool('enabled'); settings.access_mode = String(data.get('access_mode')); settings.group_list = String(data.get('group_list')).split(',').map(value => value.trim()).filter(Boolean); settings.max_file_list_limit = Number(data.get('max_file_list_limit')); settings.max_search_folders = Number(data.get('max_search_folders')); settings.upload_auto_process = bool('upload_auto_process'); }
  if (plugin === 'markdown_killer') { settings.enabled = bool('enabled'); settings.globalCleanup = bool('globalCleanup'); settings.tableRender = bool('tableRender'); settings.formulaRender = bool('formulaRender'); settings.newlineMode = String(data.get('newlineMode')); settings.tableFallback = String(data.get('tableFallback')); settings.formulaFallback = String(data.get('formulaFallback')); settings.maxRenderChars = Number(data.get('maxRenderChars')); settings.timeoutMs = Number(data.get('timeoutMs')); settings.maxImages = Number(data.get('maxImages')); }
  if (plugin === 'bangumi') { settings.enabled = bool('enabled'); settings.autoPush = bool('autoPush'); settings.outputImage = bool('outputImage'); settings.tokenSecret = String(data.get('tokenSecret')); settings.proxyUrlSecret = String(data.get('proxyUrlSecret')); settings.pollMinutes = Number(data.get('pollMinutes')); settings.maxSubscriptions = Number(data.get('maxSubscriptions')); settings.timezone = String(data.get('timezone')); settings.template = String(data.get('template')); }
  if (plugin === 'local_reminiscence') { settings.enabled = bool('enabled'); settings.realtimeRecording = bool('realtimeRecording'); settings.autoRecall = bool('autoRecall'); settings.autoSummary = bool('autoSummary'); settings.timezone = String(data.get('timezone')); settings.dayBoundaryHour = Number(data.get('dayBoundaryHour')); settings.dayBoundaryMinute = Number(data.get('dayBoundaryMinute')); settings.targetSessions = String(data.get('targetSessions')).split(',').map(value => value.trim()).filter(Boolean); settings.topResults = Number(data.get('topResults')); settings.maxContextChars = Number(data.get('maxContextChars')); settings.maxSummaryChars = Number(data.get('maxSummaryChars')); settings.retentionDays = Number(data.get('retentionDays')); settings.maxRecordsPerScope = Number(data.get('maxRecordsPerScope')); settings.minSimilarity = Number(data.get('minSimilarity')); settings.embedding = { ...(settings.embedding ?? {}), mode: String(data.get('embeddingMode')), endpoint: String(data.get('embeddingEndpoint')), model: String(data.get('embeddingModel')), timeoutMs: Number(data.get('embeddingTimeoutMs')) }; }
  try { state.capabilityRecord = await api(`plugins/${encodeURIComponent(plugin)}`, { method: 'PUT', body: { expectedRevision: record.revision, settings } }); state.capabilityNotice = '设置已保存'; await openCapabilityConfig(plugin); }
  catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
}

async function saveBiliSettings(form) {
  const data = new FormData(form); const record = state.capabilityRecord; if (!record) return;
  const settings = { ...record.settings, enabled: form.elements.enabled.checked, autoDetect: form.elements.autoDetect.checked, autoSummary: form.elements.autoSummary.checked, autoPush: form.elements.autoPush.checked, accessMode: String(data.get('accessMode')), groupIds: String(data.get('groupIds')).split(',').map(value => value.trim()).filter(Boolean), pollMinutes: Number(data.get('pollMinutes')), maxSubscriptions: Number(data.get('maxSubscriptions')), summaryStyle: String(data.get('summaryStyle')), maxSummaryChars: Number(data.get('maxSummaryChars')) };
  try { state.capabilityRecord = await api('plugins/bili_video', { method: 'PUT', body: { expectedRevision: record.revision, settings } }); state.capabilityNotice = 'B 站设置已保存'; await openCapabilityConfig('bili_video'); }
  catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
}

function bindCapabilityConfig() {
  $('#capability-close')?.addEventListener('click', () => { $('#capability-modal').hidden = true; });
  $('#bili-settings-form')?.addEventListener('submit', event => { event.preventDefault(); void saveBiliSettings(event.target); });
  $('#plugin-settings-form')?.addEventListener('submit', event => { event.preventDefault(); void savePluginSpecific(event.target, event.target.dataset.pluginSpecific); });
  $('[data-plugin-save]')?.addEventListener('click', async () => {
    try { const settings = JSON.parse($('#plugin-settings')?.value ?? '{}'); const saved = await api(`plugins/${encodeURIComponent(state.capabilityPlugin)}`, { method: 'PUT', body: { expectedRevision: state.capabilityRecord.revision, settings } }); state.capabilityRecord = saved; state.capabilityNotice = '已保存'; await openCapabilityConfig(state.capabilityPlugin); }
    catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
  });
  $('[data-plugin-login]')?.addEventListener('click', async () => {
    try { state.capabilityQr = await api('plugins/bili_video/login', { method: 'POST', body: {} }); state.capabilityNotice = '在手机上打开链接完成登录。'; renderCapabilityConfig(); }
    catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
  });
  $('[data-plugin-poll]')?.addEventListener('click', async () => {
    try { if (!state.capabilityQr) return; const result = await api('plugins/bili_video/login-poll', { method: 'POST', body: { id: state.capabilityQr.id } }); state.capabilityNotice = ({ waiting:'等待扫码', scanned:'已扫码，请在手机确认', success:'登录成功', expired:'二维码已过期' })[result.status] ?? result.status; if (result.status === 'success' || result.status === 'expired') state.capabilityQr = null; await openCapabilityConfig('bili_video'); }
    catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
  });
  $('[data-plugin-cancel-qr]')?.addEventListener('click', () => { state.capabilityQr = null; renderCapabilityConfig(); });
  $$('[data-plugin-subscription-remove]').forEach(button => button.addEventListener('click', async () => { if (!window.confirm('取消这个订阅？')) return; try { await api(`plugins/${encodeURIComponent(state.capabilityPlugin)}/subscriptions`, { method: 'DELETE', body: { id: button.dataset.pluginSubscriptionRemove } }); await openCapabilityConfig(state.capabilityPlugin); } catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); } }));
  $('[data-plugin-logout]')?.addEventListener('click', async () => {
    if (!window.confirm('清除 B 站扫码登录凭据？')) return;
    try { await api('plugins/bili_video/logout', { method: 'POST', body: {} }); state.capabilityNotice = '已清除登录凭据'; await openCapabilityConfig('bili_video'); }
    catch (error) { state.capabilityNotice = error.message; renderCapabilityConfig(); }
  });
  if (state.capabilityQr && globalThis.PriestessQRCode) {
    void globalThis.PriestessQRCode.toString(state.capabilityQr.url, { type: 'svg', margin: 1, width: 220 }).then(svg => { const node = $('#plugin-qr'); if (node) node.innerHTML = svg; }).catch(() => {});
  }
}

async function openFiles() {
  $('#files-modal').hidden = false; state.filesPath = ''; state.filePreview = null; $('#files-body').innerHTML = '<p class="empty-line">正在读取文件…</p>';
  try { const result = await api('files/environments'); state.fileEnvironments = result.environments ?? []; state.fileEnvironment = state.fileEnvironment || state.fileEnvironments[0]?.id || ''; $('#files-root').textContent = state.fileEnvironments.find(item => item.id === state.fileEnvironment)?.root ?? '工作区'; await loadFiles(''); }
  catch (error) { showError(error.message); $('#files-body').innerHTML = `<p class="app-error">${esc(error.message)}</p>`; }
}
async function loadFiles(path) {
  if (!state.fileEnvironment) { $('#files-body').innerHTML = empty('没有可用的执行环境。'); return; }
  state.filesPath = path;
  try { const result = await api(`files?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(path)}`); state.fileEntries = result.entries ?? []; state.filePreview = null; }
  catch (error) { showError(error.message); state.fileEntries = []; }
  renderFiles();
}
function renderFiles() {
  const path = state.filesPath;
  const parts = path ? path.split('/') : [];
  const crumbs = [`<button class="file-crumb" type="button" data-file-dir="">ROOT</button>`, ...parts.map((part, index) => `<span>/</span><button class="file-crumb" type="button" data-file-dir="${esc(parts.slice(0, index + 1).join('/'))}">${esc(part)}</button>`)].join('');
  const entries = state.fileEntries.map(entry => `<tr><td><button class="file-name" type="button" ${entry.kind === 'directory' ? `data-file-dir="${esc(entry.path)}"` : `data-file-read="${esc(entry.path)}"`}>${entry.kind === 'directory' ? '📁' : '📄'} ${esc(entry.name)}</button>${entry.kind === 'symlink' ? ' <span class="chip warn">symlink</span>' : ''}</td><td>${entry.kind === 'file' ? `${Math.round(Number(entry.size) / 1024 * 10) / 10} KB` : entry.kind}</td><td>${esc(time(entry.modifiedAt))}</td><td><div class="filters">${entry.kind === 'file' ? `<button class="btn btn-sm" type="button" data-file-read="${esc(entry.path)}">预览</button><button class="btn btn-sm" type="button" data-file-download="${esc(entry.path)}">下载</button><button class="btn btn-sm" type="button" data-file-move="${esc(entry.path)}">移动</button>` : ''}${entry.kind !== 'symlink' ? `<button class="btn btn-sm" type="button" data-file-delete="${esc(entry.path)}">删除</button>` : ''}</div></td></tr>`).join('');
  $('#files-body').innerHTML = `<div class="file-toolbar"><div class="file-crumbs">${crumbs}</div><div class="filters"><label class="btn btn-sm file-upload">上传<input type="file" data-file-upload hidden></label><button class="btn btn-sm" type="button" data-file-mkdir>新建文件夹</button><button class="btn btn-sm" type="button" data-file-refresh>刷新</button></div></div>${state.fileEnvironments.length > 1 ? `<div class="filters"><span class="filter-label">环境</span><select data-file-environment>${state.fileEnvironments.map(env => `<option value="${esc(env.id)}" ${env.id === state.fileEnvironment ? 'selected' : ''}>${esc(env.id)} · ${esc(env.type)}</option>`).join('')}</select></div>` : ''}<div class="table-wrap section-gap"><table class="table"><thead><tr><th>名称</th><th>类型 / 大小</th><th>修改时间</th><th>操作</th></tr></thead><tbody>${entries}</tbody></table>${state.fileEntries.length ? '' : empty('这个目录为空。')}</div>${state.filePreview ? `<section class="run-section"><div class="card-title"><h3>${esc(state.filePreview.path)}</h3><button class="btn btn-sm" type="button" data-file-preview-close>关闭预览</button></div><pre class="file-preview">${esc(state.filePreview.text)}</pre></section>` : ''}`;
  bindFiles();
}
function bindFiles() {
  $('#files-close')?.addEventListener('click', () => { $('#files-modal').hidden = true; });
  $$('[data-file-dir]').forEach(button => button.addEventListener('click', () => { void loadFiles(button.dataset.fileDir); }));
  $('[data-file-refresh]')?.addEventListener('click', () => { void loadFiles(state.filesPath); });
  $('[data-file-environment]')?.addEventListener('change', event => { state.fileEnvironment = event.target.value; void loadFiles(''); });
  $('[data-file-mkdir]')?.addEventListener('click', async () => { const name = window.prompt('文件夹名称'); if (!name) return; const target = state.filesPath ? `${state.filesPath}/${name}` : name; try { await api(`files/mkdir?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(target)}`, { method: 'POST', body: {} }); toast('文件夹已创建'); await loadFiles(state.filesPath); } catch (error) { showError(error.message); } });
  $('[data-file-upload]')?.addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 10_000_000) { showError('文件超过 10 MB'); return; } try { const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] ?? '') : reject(new Error('读取失败')); reader.onerror = () => reject(new Error('读取失败')); reader.readAsDataURL(file); }); const target = state.filesPath ? `${state.filesPath}/${file.name}` : file.name; await api(`files/upload?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(target)}`, { method: 'POST', body: { content } }); toast('文件已上传'); await loadFiles(state.filesPath); } catch (error) { showError(error.message); } });
  $$('[data-file-read]').forEach(button => button.addEventListener('click', async () => { try { state.filePreview = await api(`files/read?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(button.dataset.fileRead)}`); renderFiles(); } catch (error) { showError(error.message); } }));
  $$('[data-file-download]').forEach(button => button.addEventListener('click', async () => { try { const response = await fetch(`/api/ts/files/download?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(button.dataset.fileDownload)}`, { credentials: 'same-origin' }); if (!response.ok) throw new Error('下载失败'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = button.dataset.fileDownload.split('/').pop() || 'file'; link.click(); URL.revokeObjectURL(url); } catch (error) { showError(error.message); } }));
  $$('[data-file-delete]').forEach(button => button.addEventListener('click', async () => { if (!window.confirm('删除这个文件或空目录？')) return; try { await api(`files?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(button.dataset.fileDelete)}`, { method: 'DELETE' }); toast('已删除'); await loadFiles(state.filesPath); } catch (error) { showError(error.message); } }));
  $$('[data-file-move]').forEach(button => button.addEventListener('click', async () => { const to = window.prompt('目标路径（相对于工作区根目录）', button.dataset.fileMove); if (!to) return; try { await api(`files/move?environmentId=${encodeURIComponent(state.fileEnvironment)}&path=${encodeURIComponent(button.dataset.fileMove)}`, { method: 'POST', body: { to } }); toast('已移动'); await loadFiles(state.filesPath); } catch (error) { showError(error.message); } }));
  $('[data-file-preview-close]')?.addEventListener('click', () => { state.filePreview = null; renderFiles(); });
}

async function openChatConsole() {
  $('#chat-modal').hidden = false; $('#chat-body').innerHTML = '<p class="empty-line">正在读取会话…</p>';
  try { await loadChatList(); } catch (error) { showError(error.message); $('#chat-body').innerHTML = `<p class="app-error">${esc(error.message)}</p>`; }
}
async function loadChatList() {
  const result = await api('conversations?archived=false');
  state.chatConversations = (result.conversations ?? []).filter(item => item.platform === 'dashboard');
  if (!state.chatConversations.some(item => item.id === state.chatDetail?.conversation?.id)) state.chatDetail = null;
  if (!state.chatDetail && state.chatConversations[0]) state.chatDetail = await api(`conversations/${encodeURIComponent(state.chatConversations[0].id)}`);
  renderChat();
}
function renderChat() {
  const list = state.chatConversations ?? []; const detail = state.chatDetail;
  const agents = (state.config?.agents ?? []).filter(agent => agent.enabled);
  $('#chat-body').innerHTML = `<div class="conversation-toolbar"><div class="filters"><span class="filter-label">新建会话</span><select id="chat-agent">${agents.map(agent => `<option value="${esc(agent.id)}">${esc(agent.displayName || agent.id)}</option>`).join('')}</select><button class="btn btn-sm" type="button" data-chat-new>新建</button><button class="btn btn-sm" type="button" id="chat-close-2">关闭</button></div><span class="chip">${list.length}</span></div><div class="conversation-layout"><aside class="conversation-list">${list.map(item => `<button class="conversation-row ${detail?.conversation?.id === item.id ? 'active' : ''}" type="button" data-chat-conversation="${esc(item.id)}"><strong>${esc(item.title)}</strong><small>${esc(item.agentId)} · ${esc(time(item.updatedAt))}</small></button>`).join('') || empty('还没有控制台会话。')}</aside><section class="conversation-detail">${detail ? `<div class="detail-head"><div><h2>${esc(detail.conversation.title)}</h2><p>${esc(detail.conversation.agentId)} · ${esc(detail.conversation.id)}</p></div></div><div class="conversation-entries">${(detail.entries ?? []).map(entry => `<article class="conversation-entry ${entry.role === 'user' ? 'user' : 'assistant'}"><div class="meta-list">${chip(entry.role === 'user' ? '你' : 'Agent')}<small>${esc(entry.senderName || entry.senderId)} · ${esc(time(entry.timestamp))}</small></div><p>${esc((entry.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'))}</p></article>`).join('') || empty('还没有消息，发送一条开始。')}</div><form id="chat-form" class="filters section-gap"><textarea id="chat-input" rows="2" placeholder="输入消息" required></textarea><button class="btn btn-primary" type="submit" ${state.chatBusy ? 'disabled' : ''}>${state.chatBusy ? '等待回复…' : '发送'}</button></form>` : empty('选择或新建一个控制台会话。')}</section></div>`;
  $('#chat-close')?.addEventListener('click', () => { $('#chat-modal').hidden = true; });
  $('#chat-close-2')?.addEventListener('click', () => { $('#chat-modal').hidden = true; });
  $$('[data-chat-conversation]').forEach(button => button.addEventListener('click', () => { void openChatConversation(button.dataset.chatConversation); }));
  $('[data-chat-new]')?.addEventListener('click', () => { void createChatConversation(); });
  $('#chat-form')?.addEventListener('submit', event => { event.preventDefault(); void sendChat(); });
}
async function openChatConversation(id) { try { state.chatDetail = await api(`conversations/${encodeURIComponent(id)}`); renderChat(); } catch (error) { showError(error.message); } }
async function createChatConversation() {
  const agentId = $('#chat-agent')?.value; if (!agentId) return;
  try { const conversation = await api('conversations', { method: 'POST', body: { agentId, title: `控制台 ${new Date().toLocaleString('zh-CN')}` } }); state.chatDetail = await api(`conversations/${encodeURIComponent(conversation.id)}`); await loadChatList(); }
  catch (error) { showError(error.message); }
}
async function sendChat() {
  const detail = state.chatDetail; const text = $('#chat-input')?.value.trim(); if (!detail || !text || state.chatBusy) return;
  state.chatBusy = true; renderChat();
  try {
    const conversation = detail.conversation; const previous = conversation.lastMessage;
    const message = { ...(previous ?? { platform: conversation.platform, platformType: conversation.platformType, sessionId: conversation.sessionId, sessionType: conversation.sessionType, senderId: conversation.ownerId, senderName: '控制台', botId: 'dashboard' }), messageId: `chat-${Date.now().toString(36)}`, timestamp: Date.now(), parts: [{ type: 'text', text }] };
    await api('chat', { method: 'POST', body: { conversationId: conversation.id, message } });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try { state.chatDetail = await api(`conversations/${encodeURIComponent(conversation.id)}`); const latest = state.chatDetail.runIds?.length ?? 0; if (latest > 0) { const run = await api(`runs/${encodeURIComponent(state.chatDetail.runIds.at(-1))}`); if (!['running','queued','paused'].includes(run.run.status)) break; } } catch { /* keep polling */ }
    }
    await loadChatList();
  } catch (error) { showError(error.message); }
  finally { state.chatBusy = false; renderChat(); }
}

function render() {
  const map = { workbench: renderWorkbench, agents: renderAgents, im: renderIm, capabilities: renderCapabilities, resources: renderResources, system: renderSystem };
  $$('[data-screen-panel]').forEach(panel => { panel.hidden = panel.dataset.screenPanel !== state.screen; });
  $$('.rail-mode').forEach(button => button.classList.toggle('active', button.dataset.screen === state.screen));
  $('[data-mode-label]').textContent = ({ workbench:'工作台', agents:'智能体', im:'IM', capabilities:'能力', resources:'资源', system:'系统' }[state.screen]);
  const panel = $(`[data-screen-panel="${state.screen}"]`);
  if (panel) { panel.innerHTML = map[state.screen](); bind(); }
  $('#conn-text').textContent = state.config ? '已连接' : '未连接';
  $('#conn-dot').className = `dot ${state.config ? 'ok' : ''}`;
}

function go(screen) { state.screen = screen; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function putConfig(next, message) {
  const result = await api('config', { method: 'PUT', body: { expectedRevision: state.revision, config: next } });
  state.config = result.config;
  state.revision = result.revision;
  if (!state.selectedAgent && state.config.agents?.length) state.selectedAgent = state.config.agents[0].id;
  toast(message);
  render();
}

async function saveAgent(form) {
  if (!state.config || !state.selectedAgent) return;
  if (!state.personas) throw new Error('人格绑定尚未加载，请刷新后再保存。');
  const data = new FormData(form);
  const selected = state.config.agents.find(item => item.id === state.selectedAgent);
  if (!selected) return;
  const agent = structuredClone(selected);
  agent.displayName = String(data.get('displayName') ?? '').trim();
  agent.model = String(data.get('model') ?? '').trim();
  agent.connectionId = String(data.get('connectionId') ?? '');
  agent.instructions = String(data.get('instructions') ?? '');
  const exampleRaw = String(data.get('exampleDialogs') ?? '[]').trim();
  agent.exampleDialogs = exampleRaw ? JSON.parse(exampleRaw) : [];
  const allowlist = String(data.get('skillAllowlist') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  agent.skillAllowlist = allowlist.length ? allowlist : null;
  agent.voicePrompt = String(data.get('voicePrompt') ?? '') || null;
  agent.customErrorMessage = String(data.get('customErrorMessage') ?? '') || null;
  agent.enabled = form.elements.enabled.checked;
  const selectedTools = [...new Set(data.getAll('tools').map(String))];
  const extraTools = String(data.get('extraTools') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
  agent.resources.tools = [...new Set([...selectedTools, ...extraTools])];
  agent.resources.skills = data.getAll('skills').map(String);
  agent.resources.mcpServers = data.getAll('mcpServers').map(String);
  agent.resources.knowledgeLibraries = data.getAll('knowledgeLibraries').map(String);
  agent.resources.memoryLibraries = data.getAll('memoryLibraries').map(String);
  agent.resources.executionEnvironment = String(data.get('executionEnvironment') ?? 'none');
  agent.resources.directories = String(data.get('directories') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
  agent.approvalTools = String(data.get('approvalTools') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
  agent.permissionDenied = String(data.get('permissionDenied') ?? '');
  agent.budget = { ...(agent.budget ?? {}), maxTurns: Number(data.get('maxTurns')), timeoutMs: Number(data.get('timeoutMs')), maxTokens: Number(data.get('maxTokens')) };
  agent.contextPolicy = { ...(agent.contextPolicy ?? {}), strategy: String(data.get('contextStrategy')), contextWindowTokens: Number(data.get('contextWindowTokens')), compactAtTokens: Number(data.get('compactAtTokens')), targetTokens: Number(data.get('targetTokens')), summaryModel: String(data.get('summaryModel') ?? ''), summaryConnectionId: String(data.get('summaryConnectionId') ?? '') };
  agent.delegationTargets = data.getAll('delegationTargets').map(String);
  agent.memoryExtraction = { enabled: form.elements.memoryExtractionEnabled.checked, ...(String(data.get('memoryExtractionLibrary') ?? '') ? { libraryId: String(data.get('memoryExtractionLibrary')) } : {}) };
  const binding = state.personas.bindings.find(item => item.agentId === agent.id);
  const saved = await api(`agents/${encodeURIComponent(agent.id)}/workbench`, {
    method: 'PUT',
    body: { agent, personaId: data.get('personaId') || null, expectedRevision: state.revision, expectedBindingRevision: binding?.revision ?? 0 },
  });
  if (!state.config || saved.revision < state.revision) return;
  state.config = saved.config;
  state.revision = saved.revision;
  if (state.personas) state.personas.bindings = [...state.personas.bindings.filter(item => item.agentId !== agent.id), saved.binding];
  render();
  toast('Agent 已保存');
}

async function switchResourceTab(tab) {
  state.resourceTab = tab; render();
  if (tab === 'knowledge') await loadKnowledge();
  if (tab === 'memories') await loadMemories();
}
async function loadKnowledge() {
  const library = state.knowledgeLibrary;
  if (!library) { state.knowledgeDocs = []; state.knowledgeHits = []; render(); return; }
  try { state.knowledgeDocs = (await api(`knowledge?libraryId=${encodeURIComponent(library)}`)).documents ?? []; }
  catch (error) { showError(error.message); }
  render();
}
async function loadMemories() {
  const library = state.memoryLibrary;
  if (!library) { state.memories = []; render(); return; }
  try { state.memories = ((await api(`memory?libraryId=${encodeURIComponent(library)}`)).memories ?? []).slice(0, 100); }
  catch (error) { showError(error.message); }
  render();
}
async function importKnowledge(file) {
  if (!file || !state.knowledgeLibrary) return;
  if (file.size > 10 * 1024 * 1024) { showError('文件超过 10 MiB'); return; }
  const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== 'string') reject(new Error('读取文件失败')); else resolve(reader.result.split(',')[1] ?? ''); }; reader.onerror = () => reject(new Error('读取文件失败')); reader.readAsDataURL(file); });
  const mimeType = file.name.endsWith('.pdf') ? 'application/pdf' : file.name.endsWith('.md') ? 'text/markdown' : 'text/plain';
  try { await api('knowledge', { method: 'POST', body: { libraryId: state.knowledgeLibrary, name: file.name, mimeType, encoding: 'base64', content: base64 } }); toast('文件已提交索引'); await loadKnowledge(); }
  catch (error) { showError(error.message); }
}
async function searchKnowledge() {
  if (!state.knowledgeLibrary) { showError('先选择知识库'); return; }
  try { state.knowledgeHits = (await api(`knowledge/search?libraryId=${encodeURIComponent(state.knowledgeLibrary)}&query=${encodeURIComponent(state.knowledgeQuery)}`)).hits ?? []; render(); }
  catch (error) { showError(error.message); }
}
async function deleteKnowledge(id) {
  if (!window.confirm('删除这份文档及其索引？无法恢复。')) return;
  try { await api(`knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('文档已删除'); await loadKnowledge(); }
  catch (error) { showError(error.message); }
}
async function reindexKnowledge(id) {
  try { await api(`knowledge/${encodeURIComponent(id)}/reindex`, { method: 'POST', body: {} }); toast('重建索引已提交'); await loadKnowledge(); }
  catch (error) { showError(error.message); }
}
async function saveMemory() {
  if (!state.memoryLibrary) { showError('先选择记忆库'); return; }
  const text = $('#memory-text')?.value.trim() ?? '';
  if (!text) { showError('记忆内容不能为空'); return; }
  try {
    await api('memory', { method: 'POST', body: {
      libraryId: state.memoryLibrary,
      agentId: $('#memory-agent')?.value,
      principal: { platform: $('#memory-platform')?.value || 'dashboard', senderId: $('#memory-sender')?.value || 'local', sessionId: $('#memory-session')?.value || 'dashboard', sessionType: 'private' },
      scope: $('#memory-scope')?.value || 'sender',
      text,
      source: 'dashboard',
      confidence: 1,
    } });
    toast('记忆已保存'); await loadMemories();
  } catch (error) { showError(error.message); }
}
async function updateMemory(id) {
  const text = $('#memory-edit-text')?.value.trim() ?? '';
  if (!text) { showError('记忆内容不能为空'); return; }
  try { await api(`memory/${encodeURIComponent(id)}`, { method: 'PUT', body: { text } }); state.memoryEditing = ''; toast('记忆已更新'); await loadMemories(); }
  catch (error) { showError(error.message); }
}
async function deleteMemory(id) {
  if (!window.confirm('删除这条记忆？无法恢复。')) return;
  try { await api(`memory/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('记忆已删除'); await loadMemories(); }
  catch (error) { showError(error.message); }
}

async function loadPersonas() {
  try { state.personas = await api('personas'); render(); } catch (error) { showError(error.message); }
}
async function savePersona(form) {
  const data = new FormData(form);
  const editing = state.personaEditing === 'new' ? null : state.personas?.personas?.find(persona => persona.id === state.personaEditing);
  const input = {
    name: String(data.get('name') ?? '').trim(),
    instructions: String(data.get('instructions') ?? ''),
    exampleDialogs: editing?.exampleDialogs ?? [],
    tools: editing?.tools ?? null,
    skills: editing?.skills ?? null,
    customErrorMessage: String(data.get('customErrorMessage') ?? '') || null,
    voicePrompt: String(data.get('voicePrompt') ?? '') || null,
    folderId: editing?.folderId ?? null,
  };
  try {
    if (editing) await api(`personas/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: { ...input, expectedRevision: editing.revision } });
    else await api('personas', { method: 'POST', body: input });
    state.personaEditing = ''; toast(editing ? '人格已保存' : '人格已创建'); await loadPersonas();
  } catch (error) { showError(error.message); }
}
async function deletePersona(id) {
  const persona = state.personas?.personas?.find(item => item.id === id);
  if (!persona || !window.confirm('删除这个人格？绑定它的 Agent 需要重新选择。')) return;
  try { await api(`personas/${encodeURIComponent(id)}`, { method: 'DELETE', body: { expectedRevision: persona.revision } }); state.personaEditing = ''; toast('人格已删除'); await loadPersonas(); }
  catch (error) { showError(error.message); }
}

async function addLibrary(kind, form) {
  const data = new FormData(form);
  const id = String(data.get('id') ?? '').trim();
  const displayName = String(data.get('displayName') ?? '').trim();
  if (!id || !displayName) return;
  if ((state.config[kind] ?? []).some(library => library.id === id)) { showError('库 ID 已存在'); return; }
  const next = structuredClone(state.config);
  next[kind] = [...(next[kind] ?? []), { id, displayName }];
  try {
    await putConfig(next, '库已创建');
    if (kind === 'knowledgeLibraries') { state.knowledgeLibrary = id; await loadKnowledge(); }
    else { state.memoryLibrary = id; await loadMemories(); }
  } catch (error) { showError(error.message); }
}
async function removeLibrary(kind, id) {
  const library = (state.config[kind] ?? []).find(item => item.id === id);
  if (!library || !window.confirm(`删除库“${library.displayName || id}”？库内文档/记忆不会被自动删除。`)) return;
  const next = structuredClone(state.config);
  next[kind] = (next[kind] ?? []).filter(item => item.id !== id);
  try {
    await putConfig(next, '库已删除');
    if (kind === 'knowledgeLibraries' && state.knowledgeLibrary === id) { state.knowledgeLibrary = next.knowledgeLibraries[0]?.id ?? ''; state.knowledgeDocs = []; await loadKnowledge(); }
    if (kind === 'memoryLibraries' && state.memoryLibrary === id) { state.memoryLibrary = next.memoryLibraries[0]?.id ?? ''; state.memories = []; await loadMemories(); }
  } catch (error) { showError(error.message); }
}

async function rollbackConfig() {
  const revision = Number($('#rollback-revision')?.value);
  if (!Number.isInteger(revision) || revision < 0) { showError('修订号无效'); return; }
  if (!window.confirm(`恢复到配置修订 ${revision}？这会创建新 revision。`)) return;
  try { await api('config/rollback', { method: 'POST', body: { revision, expectedRevision: state.revision } }); toast('配置已恢复'); await loadAll(); }
  catch (error) { showError(error.message); }
}
async function importConfig(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const candidate = parsed && typeof parsed === 'object' && 'config' in parsed && !('runtime' in parsed) ? parsed.config : parsed;
    await putConfig(candidate, '配置已导入并发布');
  } catch (error) { showError(error.message); }
}

function openPlatformForm(id) {
  state.platformEditing = id;
  render();
}
function syncPlatformFields(form) {
  const type = form.querySelector('[data-platform-type]')?.value ?? 'telegram';
  $$('[data-platform-fields]').forEach(section => { section.hidden = section.dataset.platformFields !== type; });
}
async function savePlatform(form) {
  const data = new FormData(form); const type = String(data.get('type'));
  const platform = { id: String(data.get('id')).trim(), type, displayName: String(data.get('displayName')).trim(), enabled: form.elements.enabled.checked };
  if (!platform.id || !platform.displayName) { showError('ID 和显示名称不能为空'); return; }
  if (type === 'telegram') Object.assign(platform, { tokenEnv: String(data.get('tokenEnv')).trim() || 'TELEGRAM_BOT_TOKEN', apiBase: String(data.get('telegramApiBase')).trim() || 'https://api.telegram.org', pollingTimeoutSeconds: Number(data.get('pollingTimeoutSeconds') ?? 30) });
  if (type === 'napcat') { Object.assign(platform, { websocketUrl: String(data.get('websocketUrl')).trim(), accessTokenEnv: String(data.get('accessTokenEnv')).trim() || 'NAPCAT_TOKEN', forwardThreshold: Number(data.get('forwardThreshold') ?? 1500) }); const apiBase = String(data.get('napcatApiBase')).trim(); if (apiBase) platform.apiBase = apiBase; }
  if (type === 'weixin') Object.assign(platform, { tokenEnv: String(data.get('weixinTokenEnv')).trim() || 'WEIXIN_TOKEN', apiBase: String(data.get('weixinApiBase')).trim() || 'https://ilinkai.weixin.qq.com', accountId: String(data.get('accountId')).trim(), stateFile: String(data.get('stateFile')).trim() || 'weixin-state.json' });
  const next = structuredClone(state.config);
  const existing = next.platforms.some(item => item.id === platform.id);
  if (state.platformEditing === 'new' && existing) { showError('IM ID 已存在'); return; }
  next.platforms = existing ? next.platforms.map(item => item.id === platform.id ? platform : item) : [...next.platforms, platform];
  try { await putConfig(next, 'IM 配置已保存'); state.platformEditing = ''; await loadAll(); }
  catch (error) { showError(error.message); }
}
async function deletePlatform(id) {
  const platform = state.config?.platforms?.find(item => item.id === id);
  if (!platform || !window.confirm(`删除 IM 通道“${platform.displayName || id}”？`)) return;
  const next = structuredClone(state.config); next.platforms = next.platforms.filter(item => item.id !== id);
  try { await putConfig(next, 'IM 通道已删除'); state.platformEditing = ''; await loadAll(); }
  catch (error) { showError(error.message); }
}

function openModelForm(id) { state.modelEditing = id; render(); }
async function saveModel(form) {
  const data = new FormData(form);
  const connection = { id: String(data.get('id')).trim(), apiKeyEnv: String(data.get('apiKeyEnv')).trim(), protocol: String(data.get('protocol')) };
  const baseUrl = String(data.get('baseUrl') ?? '').trim(); if (baseUrl) connection.baseUrl = baseUrl;
  const editing = state.modelEditing === 'new' ? null : state.config.connections?.find(item => item.id === state.modelEditing);
  if (editing?.fileUpload) connection.fileUpload = editing.fileUpload;
  const next = structuredClone(state.config);
  const exists = next.connections.some(item => item.id === connection.id);
  if (state.modelEditing === 'new' && exists) { showError('模型服务 ID 已存在'); return; }
  next.connections = exists ? next.connections.map(item => item.id === connection.id ? connection : item) : [...next.connections, connection];
  try { await putConfig(next, '模型服务已保存'); state.modelEditing = ''; }
  catch (error) { showError(error.message); }
}
async function deleteModel(id) {
  if (!window.confirm(`删除模型服务“${id}”？引用它的 Agent 需要重新选择。`)) return;
  const next = structuredClone(state.config); next.connections = next.connections.filter(item => item.id !== id);
  try { await putConfig(next, '模型服务已删除'); state.modelEditing = ''; }
  catch (error) { showError(error.message); }
}
async function loadSecrets() {
  try { state.secrets = (await api('management/secrets')).secrets ?? []; } catch { state.secrets = []; }
  try { state.audit = (await api('management/audit')).records ?? []; } catch { state.audit = []; }
  render();
}
async function saveSecret() {
  const name = $('#secret-name')?.value.trim() ?? ''; const value = $('#secret-value')?.value ?? '';
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name) || !value) { showError('密钥名必须是大写环境变量名，值不能为空'); return; }
  try { await api(`management/secrets/${encodeURIComponent(name)}`, { method: 'PUT', body: { value } }); $('#secret-name').value = ''; $('#secret-value').value = ''; toast('密钥已保存'); await loadSecrets(); }
  catch (error) { showError(error.message); }
}
async function deleteSecret(name) {
  if (!window.confirm(`删除密钥 ${name}？`)) return;
  try { await api(`management/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }); toast('密钥已删除'); await loadSecrets(); }
  catch (error) { showError(error.message); }
}

async function saveRoutingDefault(value) {
  const next = structuredClone(state.config); next.flow.routing.defaultAgentId = value;
  try { await putConfig(next, '默认 Agent 已保存'); } catch (error) { showError(error.message); }
}
async function addRoutingRule(form) {
  const data = new FormData(form);
  const rule = { id: `rule-${Date.now().toString(36)}`, agentId: String(data.get('agentId')) };
  for (const key of ['platform', 'sessionType', 'sessionId', 'senderId', 'textIncludes']) { const value = String(data.get(key) ?? '').trim(); if (value) rule[key] = value; }
  const next = structuredClone(state.config); next.flow.routing.rules.push(rule);
  try { await putConfig(next, '路由规则已添加'); } catch (error) { showError(error.message); }
}
async function removeRoutingRule(index) {
  const next = structuredClone(state.config); next.flow.routing.rules.splice(index, 1);
  try { await putConfig(next, '路由规则已删除'); } catch (error) { showError(error.message); }
}
async function addGrant(form) {
  const data = new FormData(form);
  const grant = { platform: String(data.get('platform')).trim(), senderIds: String(data.get('senderIds')).split(',').map(value => value.trim()).filter(Boolean), state: String(data.get('state')) };
  const sessionType = String(data.get('sessionType')); const sessionId = String(data.get('sessionId')).trim();
  if (sessionType) grant.sessionType = sessionType; if (sessionId) grant.sessionId = sessionId;
  const next = structuredClone(state.config); next.grants.push(grant);
  try { await putConfig(next, '发送者授权已添加'); } catch (error) { showError(error.message); }
}
async function removeGrant(index) {
  const next = structuredClone(state.config); next.grants.splice(index, 1);
  try { await putConfig(next, '发送者授权已删除'); } catch (error) { showError(error.message); }
}

async function newAgent() {
  const template = state.config?.agents?.[0];
  if (!template) { showError('没有可用于复制默认值的 Agent'); return; }
  const id = `agent-${Date.now().toString(36)}`;
  const next = structuredClone(state.config);
  next.agents.push({ ...structuredClone(template), id, displayName: '新 Agent', enabled: false });
  try { await putConfig(next, 'Agent 已创建'); state.selectedAgent = id; render(); }
  catch (error) { showError(error.message); }
}
async function deleteAgent() {
  const id = state.selectedAgent;
  if (!id || !window.confirm(`删除 Agent“${id}”？`)) return;
  if ((state.config?.agents?.length ?? 0) <= 1) { showError('至少保留一个 Agent'); return; }
  const next = structuredClone(state.config); next.agents = next.agents.filter(agent => agent.id !== id);
  try { await putConfig(next, 'Agent 已删除'); state.selectedAgent = next.agents[0]?.id ?? null; }
  catch (error) { showError(error.message); }
}

async function startWechatQr(id) {
  state.wechatPlatform = id; state.wechatQr = null; render();
  try { state.wechatQr = await api(`platforms/${encodeURIComponent(id)}/qr`, { method: 'POST', body: {} }); render(); }
  catch (error) { showError(error.message); }
}
async function pollWechatQr() {
  const id = state.wechatPlatform; const qr = state.wechatQr; if (!id || !qr) return;
  try { state.wechatQr = await api(`platforms/${encodeURIComponent(id)}/qr/${encodeURIComponent(qr.id)}`); toast(`微信扫码：${state.wechatQr.status}`); if (state.wechatQr.status === 'confirmed') { state.wechatPlatform = ''; state.wechatQr = null; await loadAll(); } else render(); }
  catch (error) { showError(error.message); }
}

async function toggleExtension(id, enabled, revision) {
  try { await api(`extensions/${encodeURIComponent(id)}`, { method: 'PUT', body: { enabled, expectedRevision: revision } }); toast('扩展状态已保存'); await loadAll(); }
  catch (error) { showError(error.message); }
}
async function saveSearch(form) {
  const data = new FormData(form); const current = state.search?.settings; if (!current) return;
  const body = { enabled: form.elements.enabled.checked, provider: String(data.get('provider')), apiBase: String(data.get('apiBase')), apiKeyEnv: String(data.get('apiKeyEnv')), timeoutMs: Number(current.timeoutMs ?? 25000), defaultCount: Number(data.get('defaultCount')), maxCount: Number(data.get('maxCount')), maxContentChars: Number(data.get('maxContentChars')), expectedRevision: current.revision };
  try { state.search = await api('search', { method: 'PUT', body }); toast('搜索配置已保存'); }
  catch (error) { showError(error.message); }
}

function openAgentTest(id) { state.agentTestResult = null; state.agentTestError = ''; state.selectedAgent = id; $('#agent-test-modal').hidden = false; renderAgentTest(); }
function renderAgentTest() {
  const agent = state.config?.agents?.find(item => item.id === state.selectedAgent);
  const result = state.agentTestResult;
  $('#agent-test-body').innerHTML = `<div class="run-summary"><strong>${esc(agent?.displayName || state.selectedAgent || '')}</strong><p>${esc(agent?.model || '')} · 使用当前编辑中的配置</p></div><form id="agent-test-form" class="agent-section" style="margin:16px 24px"><label>测试消息<textarea id="agent-test-message" rows="4" placeholder="输入一条消息，检查语气和内容" required></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">发送测试</button></div></form>${state.agentTestError ? `<p class="app-error" style="margin:0 24px">${esc(state.agentTestError)}</p>` : ''}${result ? `<section class="run-section"><div class="card-title"><h3>${esc(result.status)}</h3>${chip(`${result.inputTokens + result.outputTokens} Token`)}</div><p style="white-space:pre-wrap;color:var(--ink-2);font-size:12px;line-height:1.7">${esc(result.text || '模型未返回正文。')}</p></section>` : ''}`;
  $('#agent-test-close')?.addEventListener('click', () => { $('#agent-test-modal').hidden = true; });
  $('#agent-test-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const message = $('#agent-test-message')?.value.trim(); if (!message || !state.selectedAgent || !state.config) return;
    state.agentTestError = ''; state.agentTestResult = null; renderAgentTest();
    try { const binding = (state.personas?.bindings ?? []).find(item => item.agentId === state.selectedAgent); state.agentTestResult = await api(`agents/${encodeURIComponent(state.selectedAgent)}/draft-test`, { method: 'POST', body: { config: state.config, agentId: state.selectedAgent, personaId: binding?.personaId ?? null, message } }); }
    catch (error) { state.agentTestError = error.message; }
    renderAgentTest();
  });
}

async function installExtension() {
  const modulePath = $('#extension-module')?.value.trim() ?? ''; const raw = $('#extension-manifest')?.value ?? ''; const trusted = $('#extension-trusted')?.checked ?? false;
  if (!modulePath || !raw || !trusted) { showError('模块路径、Manifest 和受信任确认都必填'); return; }
  try { const manifest = JSON.parse(raw); await api('extensions', { method: 'POST', body: { manifest, modulePath, trustedHostAcknowledged: true, configuration: {} } }); toast('扩展已安装'); await loadAll(); }
  catch (error) { showError(error.message); }
}

async function simulateFlow(form) {
  const data = new FormData(form); const platform = String(data.get('platform')); const platformType = state.config.platforms?.find(item => item.id === platform)?.type ?? 'telegram';
  const message = { platform, platformType, sessionId: String(data.get('sessionId')), sessionType: String(data.get('sessionType')), senderId: String(data.get('senderId')), senderName: '模拟', botId: 'dashboard', messageId: `sim-${Date.now()}`, timestamp: Date.now(), parts: [{ type: 'text', text: String(data.get('text')) }] };
  try { state.flowSimulation = await api('flow/simulate', { method: 'POST', body: { config: state.config, message } }); render(); }
  catch (error) { showError(error.message); }
}

function bind() {
  $$('[data-resource-tab]').forEach(button => button.addEventListener('click', () => { void switchResourceTab(button.dataset.resourceTab); }));
  $$('[data-capability-config]').forEach(button => button.addEventListener('click', () => { void openCapabilityConfig(button.dataset.capabilityConfig); }));
  $$('[data-extension-toggle]').forEach(button => button.addEventListener('click', () => { void toggleExtension(button.dataset.extensionToggle, button.dataset.extensionEnabled === 'true', Number(button.dataset.extensionRevision)); }));
  $$('[data-plugin-config]').forEach(button => button.addEventListener('click', () => { void openCapabilityConfig(button.dataset.pluginConfig); }));
  $('[data-extension-install]')?.addEventListener('click', () => { void installExtension(); });
  $('#search-form')?.addEventListener('submit', event => { event.preventDefault(); void saveSearch(event.target); });
  $$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  $$('[data-conversations]').forEach(button => button.addEventListener('click', () => { void openConversations(); }));
  $$('[data-files]').forEach(button => button.addEventListener('click', () => { void openFiles(); }));
  $$('[data-chat-console]').forEach(button => button.addEventListener('click', () => { void openChatConsole(); }));
  $$('[data-refresh]').forEach(button => button.addEventListener('click', () => { void loadAll().then(render); }));
  $$('[data-agent]').forEach(button => button.addEventListener('click', () => { state.selectedAgent = button.dataset.agent; render(); }));
  $('[data-agent-new]')?.addEventListener('click', () => { void newAgent(); });
  $$('[data-agent-test]').forEach(button => button.addEventListener('click', () => openAgentTest(button.dataset.agentTest)));
  $('[data-agent-delete]')?.addEventListener('click', () => { void deleteAgent(); });
  $$('[data-run-id]').forEach(button => button.addEventListener('click', () => { void openRun(button.dataset.runId); }));
  const agentForm = $('#agent-form');
  if (agentForm) agentForm.onsubmit = async event => {
    event.preventDefault();
    const button = agentForm.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    showError('');
    try { await saveAgent(agentForm); }
    catch (error) { showError(error.message); }
    finally { button.disabled = false; }
  };
  $$('[data-platform-new]').forEach(button => button.addEventListener('click', () => openPlatformForm('new')));
  $$('[data-wechat-qr]').forEach(button => button.addEventListener('click', () => { void startWechatQr(button.dataset.wechatQr); }));
  $('[data-wechat-poll]')?.addEventListener('click', () => { void pollWechatQr(); });
  $('[data-wechat-close]')?.addEventListener('click', () => { state.wechatPlatform = ''; state.wechatQr = null; render(); });
  if (state.wechatQr?.qrUrl && globalThis.PriestessQRCode) { void globalThis.PriestessQRCode.toString(state.wechatQr.qrUrl, { type: 'svg', margin: 1, width: 220 }).then(svg => { const node = $('#wechat-qr'); if (node) node.innerHTML = svg; }).catch(() => {}); }
  $$('[data-im-tab]').forEach(button => button.addEventListener('click', () => { state.imTab = button.dataset.imTab; render(); }));
  $('#routing-default')?.addEventListener('change', event => { void saveRoutingDefault(event.target.value); });
  $('#rule-form')?.addEventListener('submit', event => { event.preventDefault(); void addRoutingRule(event.target); });
  $('#simulate-form')?.addEventListener('submit', event => { event.preventDefault(); void simulateFlow(event.target); });
  $$('[data-rule-remove]').forEach(button => button.addEventListener('click', () => { void removeRoutingRule(Number(button.dataset.ruleRemove)); }));
  $('#grant-form')?.addEventListener('submit', event => { event.preventDefault(); void addGrant(event.target); });
  $$('[data-grant-remove]').forEach(button => button.addEventListener('click', () => { void removeGrant(Number(button.dataset.grantRemove)); }));
  $$('[data-platform-edit]').forEach(button => button.addEventListener('click', () => openPlatformForm(button.dataset.platformEdit)));
  $('[data-platform-cancel]')?.addEventListener('click', () => { state.platformEditing = ''; render(); });
  $('#platform-form')?.addEventListener('submit', event => { event.preventDefault(); void savePlatform(event.target); });
  $('[data-platform-type]')?.addEventListener('change', event => syncPlatformFields(event.target.form));
  $$('[data-platform-delete]').forEach(button => button.addEventListener('click', () => { void deletePlatform(button.dataset.platformDelete); }));
  $$('[data-platform-toggle]').forEach(input => input.addEventListener('change', () => {
    const next = structuredClone(state.config);
    const platform = next.platforms.find(item => item.id === input.dataset.platformToggle);
    if (!platform) return;
    platform.enabled = input.checked;
    void putConfig(next, '通道状态已保存').catch(error => { input.checked = !input.checked; showError(error.message); });
  }));
  $$('[data-capability-tab]').forEach(button => button.addEventListener('click', () => { state.capabilityTab = button.dataset.capabilityTab === 'platforms' ? 'services' : button.dataset.capabilityTab; render(); }));
  $$('[data-search-edit]').forEach(button => button.addEventListener('click', () => { state.searchEditing = true; render(); }));
  $$('[data-search-cancel]').forEach(button => button.addEventListener('click', () => { state.searchEditing = false; render(); }));
  $('[data-cap-search]')?.addEventListener('click', () => { state.capQuery = $('#capability-query')?.value.trim() ?? ''; render(); });
  $('#capability-query')?.addEventListener('keydown', event => { if (event.key === 'Enter') { state.capQuery = event.target.value.trim(); render(); } });
  $$('[data-cap-source]').forEach(button => button.addEventListener('click', () => { state.capSource = button.dataset.capSource; render(); }));
  $$('[data-cap-filter]').forEach(button => button.addEventListener('click', () => { state.capFilter = button.dataset.capFilter; render(); }));
  $$('[data-res-type]').forEach(button => button.addEventListener('click', () => { state.resType = button.dataset.resType; render(); }));
  $$('[data-res-zone]').forEach(button => button.addEventListener('click', () => { state.resZone = button.dataset.resZone; render(); }));
  $('[data-knowledge-library]')?.addEventListener('change', event => { state.knowledgeLibrary = event.target.value; state.knowledgeHits = []; void loadKnowledge(); });
  $('#knowledge-library-form')?.addEventListener('submit', event => { event.preventDefault(); void addLibrary('knowledgeLibraries', event.target); });
  $('#memory-library-form')?.addEventListener('submit', event => { event.preventDefault(); void addLibrary('memoryLibraries', event.target); });
  $$('[data-library-remove]').forEach(button => button.addEventListener('click', () => { void removeLibrary(button.dataset.libraryRemove, button.dataset.libraryId); }));
  $('[data-model-new]')?.addEventListener('click', () => openModelForm('new'));
  $$('[data-model-edit]').forEach(button => button.addEventListener('click', () => openModelForm(button.dataset.modelEdit)));
  $('[data-model-cancel]')?.addEventListener('click', () => { state.modelEditing = ''; render(); });
  $('#model-form')?.addEventListener('submit', event => { event.preventDefault(); void saveModel(event.target); });
  $$('[data-model-delete]').forEach(button => button.addEventListener('click', () => { void deleteModel(button.dataset.modelDelete); }));
  $('[data-secret-save]')?.addEventListener('click', () => { void saveSecret(); });
  $$('[data-secret-delete]').forEach(button => button.addEventListener('click', () => { void deleteSecret(button.dataset.secretDelete); }));
  $('[data-knowledge-refresh]')?.addEventListener('click', () => { void loadKnowledge(); });
  $('[data-knowledge-import]')?.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) void importKnowledge(file); });
  $('[data-knowledge-search]')?.addEventListener('submit', event => { event.preventDefault(); state.knowledgeQuery = $('#knowledge-query')?.value ?? ''; void searchKnowledge(); });
  $$('[data-knowledge-delete]').forEach(button => button.addEventListener('click', () => { void deleteKnowledge(button.dataset.knowledgeDelete); }));
  $$('[data-knowledge-reindex]').forEach(button => button.addEventListener('click', () => { void reindexKnowledge(button.dataset.knowledgeReindex); }));
  $('[data-memory-library]')?.addEventListener('change', event => { state.memoryLibrary = event.target.value; state.memoryEditing = ''; void loadMemories(); });
  $('[data-memory-refresh]')?.addEventListener('click', () => { void loadMemories(); });
  $('[data-memory-add]')?.addEventListener('click', () => { void saveMemory(); });
  $$('[data-memory-edit]').forEach(button => button.addEventListener('click', () => { state.memoryEditing = button.dataset.memoryEdit; render(); }));
  $('[data-memory-cancel]')?.addEventListener('click', () => { state.memoryEditing = ''; render(); });
  $$('[data-memory-save]').forEach(button => button.addEventListener('click', () => { void updateMemory(button.dataset.memorySave); }));
  $$('[data-memory-delete]').forEach(button => button.addEventListener('click', () => { void deleteMemory(button.dataset.memoryDelete); }));
  $('[data-persona-new]')?.addEventListener('click', () => { state.personaEditing = 'new'; render(); });
  $$('[data-persona-edit]').forEach(button => button.addEventListener('click', () => { state.personaEditing = button.dataset.personaEdit; render(); }));
  $('[data-persona-cancel]')?.addEventListener('click', () => { state.personaEditing = ''; render(); });
  $('[data-persona-delete]')?.addEventListener('click', () => { void deletePersona($('[data-persona-delete]').dataset.personaDelete); });
  $('#persona-form')?.addEventListener('submit', event => { event.preventDefault(); void savePersona(event.target); });
  $$('[data-export]').forEach(button => button.addEventListener('click', () => {
    if (!state.config) return;
    const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `priestess-config-r${state.revision}.json`; link.click(); URL.revokeObjectURL(url);
  }));
  $$('[data-logout]').forEach(button => button.addEventListener('click', () => { void logout(); }));
  $('[data-rollback]')?.addEventListener('click', () => { void rollbackConfig(); });
  $('#config-import')?.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) void importConfig(file); });
}

async function loadAll() {
  showError('');
  const [config, platforms, runs, capabilities, workspace, personas, environments] = await Promise.all([
    api('config'),
    api('platforms').catch(() => ({ platforms: [] })),
    api('agent-records?limit=30').catch(() => ({ records: [] })),
    api('agent-capabilities').catch(() => ({ entries: [] })),
    api('workspace').catch(() => null),
    api('personas').catch(() => null),
    api('environments').catch(() => ({ environments: [] })),
  ]);
  state.config = config.config;
  state.revision = config.revision;
  state.platforms = platforms.platforms ?? [];
  state.runs = runs.records ?? [];
  state.capabilities = capabilities.entries ?? [];
  state.workspace = workspace;
  state.personas = personas;
  state.environments = environments.environments ?? [];
  state.secrets = (await api('management/secrets').catch(() => ({ secrets: [] }))).secrets ?? [];
  state.audit = (await api('management/audit').catch(() => ({ records: [] }))).records ?? [];
  state.extensions = (await api('extensions').catch(() => ({ extensions: [] }))).extensions ?? [];
  state.plugins = (await api('plugins').catch(() => ({ plugins: [] }))).plugins ?? [];
  state.search = await api('search').catch(() => null);
  if (!state.knowledgeLibrary || !state.config.knowledgeLibraries?.some(item => item.id === state.knowledgeLibrary)) state.knowledgeLibrary = state.config.knowledgeLibraries?.[0]?.id ?? '';
  if (!state.memoryLibrary || !state.config.memoryLibraries?.some(item => item.id === state.memoryLibrary)) state.memoryLibrary = state.config.memoryLibraries?.[0]?.id ?? '';
  if (!state.selectedAgent || !state.config.agents?.some(agent => agent.id === state.selectedAgent)) state.selectedAgent = state.config.flow?.routing?.defaultAgentId ?? state.config.agents?.[0]?.id ?? null;
  hideLogin();
  render();
}

async function logout() {
  try { await api('auth/logout', { method: 'POST', body: {} }); } catch { /* session already gone */ }
  state.config = null; state.revision = 0; state.platforms = []; state.runs = []; state.capabilities = []; state.workspace = null; state.personas = null; state.selectedAgent = null;
  showLogin();
}

async function login(token) {
  await api('auth/login', { method: 'POST', body: {}, token });
  state.token = '';
  await loadAll();
}

function bindShell() {
  $$('.rail-mode').forEach(button => button.addEventListener('click', () => go(button.dataset.screen)));
  $('#refresh-all').addEventListener('click', () => { if (state.config) void loadAll().catch(error => showError(error.message)); });
  $('#refresh-icon').addEventListener('click', () => { if (state.config) void loadAll().catch(error => showError(error.message)); });
  $('#topbar-logout')?.addEventListener('click', () => { if (state.config) void logout(); else showLogin(); });
  $('#login-form').addEventListener('submit', event => {
    event.preventDefault();
    const token = $('#token').value.trim();
    if (!token) return;
    $('#login-button').disabled = true; $('#login-error').hidden = true;
    void login(token).catch(error => { $('#login-error').hidden = false; $('#login-error').textContent = error.message; }).finally(() => { $('#login-button').disabled = false; });
  });
}

async function init() {
  bindShell();
  try {
    const session = await api('auth/session');
    if (session.authenticated) await loadAll(); else showLogin();
  } catch { showLogin(); }
}
void init();
