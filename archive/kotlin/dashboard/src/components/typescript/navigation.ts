export type RuntimePage = 'plugins' | 'search' | 'welcome' | 'platforms' | 'providers' | 'agents' | 'extensions' | 'permissions' | 'knowledge' | 'memories' | 'flow' | 'chat' | 'runs' | 'execution' | 'settings' | 'personas' | 'conversations' | 'files' | 'resources' | 'tools';
export type RuntimeNavigationGroup = '工作台' | 'Agent' | '机器人' | '资源库' | '设置';
export const runtimeNavGroups: readonly RuntimeNavigationGroup[] = ['工作台', 'Agent', '机器人', '资源库', '设置'];
export interface RuntimeNavigationItem { id: RuntimePage; path: string; label: string; group: RuntimeNavigationGroup; summary: string; keywords: readonly string[]; related: readonly RuntimePage[]; }
export const runtimeNavigation: readonly RuntimeNavigationItem[] = [
  { id:'welcome', path:'/', label:'概览', group:'工作台', summary:'查看连接状态，按步骤配置并验证你的助手。', keywords:['首页','开始使用','设置向导','状态'], related:['settings','providers','agents','platforms','chat'] },
  { id:'chat', path:'/chat', label:'对话', group:'工作台', summary:'与已保存的 Agent 对话，查看回复与生成文件。', keywords:['聊天','测试','附件','图片','继续','停止'], related:['agents','conversations','runs'] },
  { id:'conversations', path:'/sessions', label:'会话管理', group:'工作台', summary:'搜索聊天记录、整理分组、归档或从历史继续。', keywords:['聊天记录','历史','分组','文件夹','归档','恢复','导出'], related:['chat','runs','memories'] },
  { id:'providers', path:'/providers', label:'模型服务', group:'设置', summary:'管理模型 API、协议与凭据引用，再装配给 Agent。', keywords:['LLM','API','OpenAI','DeepSeek','连接','密钥','Responses','Chat Completions'], related:['settings','agents','chat'] },
  { id:'agents', path:'/agents', label:'Agent', group:'Agent', summary:'选择模型与人格，装配工具和资料，设置执行规则。', keywords:['助手','智能体','系统提示词','审批','上下文','压缩','委派','多agent'], related:['providers','personas','permissions','chat'] },
  { id:'personas', path:'/personas', label:'人格库', group:'资源库', summary:'编辑人格正文、示例对话和回复规则。人格分配统一在 Agent 中操作。', keywords:['角色','提示词','示例对话','编辑','语气'], related:['agents','chat'] },
  { id:'platforms', path:'/platforms', label:'机器人', group:'机器人', summary:'连接 Telegram、NapCat 和微信，管理平台回复设置。', keywords:['IM','QQ','OneBot','TG','Telegram','NapCat','微信','扫码','表情','防刷屏','合并转发'], related:['settings','flow','permissions','runs'] },
  { id:'flow', path:'/flow', label:'消息路由', group:'机器人', summary:'设置准入、Agent 分配与执行限制，模拟消息处理。', keywords:['流程','节点','编排','群聊','白名单','触发','并发','队列','模拟','流式'], related:['platforms','agents','permissions','runs'] },
  { id:'permissions', path:'/permissions', label:'权限管理', group:'机器人', summary:'按机器人为一个或多个发送者分配固定运行态。', keywords:['授权','普通干员','资深干员','高级资深干员','能力','资源范围'], related:['platforms','agents','flow'] },
  { id:'knowledge', path:'/knowledge-base', label:'知识库', group:'资源库', summary:'导入资料、查看索引并验证检索结果。', keywords:['文档','PDF','RAG','Embedding','Reranker','向量','上传','检索'], related:['agents','providers','runs'] },
  { id:'memories', path:'/memories', label:'长期记忆', group:'资源库', summary:'查看来源与作用域，编辑记忆并审核整理结果。', keywords:['记忆库','提取','整理','合并','作用域','来源','定期'], related:['agents','conversations','plugins'] },
  { id:'search', path:'/search', label:'网络搜索', group:'资源库', summary:'设置搜索与网页正文服务，再为 Agent 装配工具。', keywords:['联网','网页','web_search','web_fetch','Tavily','Brave','DeepSeek'], related:['settings','agents','chat'] },
  { id:'plugins', path:'/plugins', label:'插件管理', group:'资源库', summary:'管理 QQ 群工具、消息格式、视频、番剧和本地回忆。', keywords:['QQ','群文件','公告','Markdown','Bilibili','哔哩哔哩','Bangumi','订阅','回忆'], related:['agents','settings','conversations'] },
  { id:'extensions', path:'/extensions', label:'扩展', group:'资源库', summary:'配置 MCP、Skills 和原生扩展，按需装配给 Agent。', keywords:['MCP','Skills','技能','原生','工具','安装','模块'], related:['agents','permissions','settings'] },
  { id:'runs', path:'/runs', label:'执行记录', group:'工作台', summary:'定位失败步骤，查看工具、产物并处理审批。', keywords:['运行','日志','失败','错误','审批','取消','token','时间线','产物'], related:['conversations','execution','agents','flow'] },
  { id:'execution', path:'/execution', label:'执行环境', group:'设置', summary:'检查环境可用性、后台进程和命令输出。', keywords:['Docker','沙箱','sandbox','命令','终端','进程','网络','隔离'], related:['agents','permissions','files','runs'] },
  { id:'files', path:'/files', label:'工作目录', group:'工作台', summary:'浏览已授权环境的文件，上传、下载或整理目录。', keywords:['文件','文件夹','上传','下载','预览','移动','产物'], related:['execution','runs','agents'] },
  { id:'settings', path:'/settings', label:'系统设置', group:'设置', summary:'管理登录和密钥，导入导出配置或恢复历史版本。', keywords:['Token','密钥','凭据','登录','审计','操作日志','导入','导出','恢复','修订','备份'], related:['providers','platforms','search','extensions'] },
  { id:'resources', path:'/resources', label:'资源库', group:'资源库', summary:'集中管理人格、知识、记忆与可复用能力，在 Agent 中按需装配。', keywords:['资料','资源','人格','知识','记忆','工具'], related:['personas','knowledge','memories','tools'] },
  { id:'tools', path:'/tools', label:'工具与插件', group:'资源库', summary:'区分通用能力与平台专属能力，查看来源、适用场景和配置入口。', keywords:['通用','平台','QQ','Telegram','微信','工具','插件','MCP','Skills'], related:['agents','plugins','search','extensions'] },
];

export function matchesRuntimeNavigation(item: RuntimeNavigationItem, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = [item.id, item.path, item.label, item.group, item.summary, ...item.keywords].join(' ').toLocaleLowerCase();
  return terms.every(term => searchable.includes(term));
}

export type RuntimeDomain = 'workbench' | 'agents' | 'platforms' | 'resources' | 'settings';
export interface RuntimeDomainItem { id: RuntimeDomain; label: RuntimeNavigationGroup; path: string; }
export const runtimeDomains: readonly RuntimeDomainItem[] = [
  { id: 'workbench', label: '工作台', path: '/' },
  { id: 'agents', label: 'Agent', path: '/agents' },
  { id: 'platforms', label: '机器人', path: '/platforms' },
  { id: 'resources', label: '资源库', path: '/resources' },
  { id: 'settings', label: '设置', path: '/settings' },
];
export interface RuntimeAreaLink { label: string; path: string; pages: readonly RuntimePage[]; section?: string; }
export const runtimeAreaLinks: Readonly<Record<RuntimeDomain, readonly RuntimeAreaLink[]>> = {
  workbench: [
    { label: '概览', path: '/', pages: ['welcome'] },
    { label: '会话', path: '/sessions', pages: ['conversations', 'chat'] },
    { label: '任务与审批', path: '/runs', pages: ['runs'] },
    { label: '后台进程', path: '/execution', section: 'processes', pages: ['execution'] },
    { label: '文件', path: '/files', pages: ['files'] },
  ],
  agents: [],
  platforms: [
    { label: '平台实例', path: '/platforms', pages: ['platforms'] },
    { label: '消息路由', path: '/flow', pages: ['flow'] },
    { label: '发送者授权', path: '/permissions', pages: ['permissions'] },
  ],
  resources: [
    { label: '全部资源', path: '/resources', pages: ['resources'] },
    { label: '人格', path: '/personas', pages: ['personas'] },
    { label: '知识库', path: '/knowledge-base', pages: ['knowledge'] },
    { label: '长期记忆', path: '/memories', pages: ['memories'] },
    { label: '工具与插件', path: '/tools', pages: ['tools', 'plugins', 'search', 'extensions'] },
  ],
  settings: [
    { label: '系统与凭据', path: '/settings', pages: ['settings'] },
    { label: '模型连接', path: '/providers', pages: ['providers'] },
    { label: '执行环境', path: '/execution', section: 'settings', pages: ['execution'] },
  ],
};

export function runtimeDomainFor(page: RuntimePage, section?: string): RuntimeDomain {
  if (page === 'execution') return section === 'settings' ? 'settings' : 'workbench';
  const group = runtimeNavigation.find(item => item.id === page)?.group;
  return runtimeDomains.find(item => item.label === group)?.id ?? 'workbench';
}

export function areaLinkActive(link: RuntimeAreaLink, page: RuntimePage, section?: string): boolean {
  return link.pages.includes(page) && (link.section === undefined || link.section === section);
}
