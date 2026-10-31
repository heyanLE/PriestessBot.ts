import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { runtimeNavigation } from '../components/typescript/navigation';
const typescriptRuntime = () => import('../views/TypescriptRuntimeView.vue');
import OverviewView from '../views/OverviewView.vue';
import ConfigurationV3View from '../views/ConfigurationV3View.vue';
import PersonaLibraryView from '../views/PersonaLibraryView.vue';
import ExecutionLogView from '../views/ExecutionLogView.vue';
import ConversationView from '../views/ConversationView.vue';
import ConversationDetailView from '../views/ConversationDetailView.vue';
import LogView from '../views/LogView.vue';
import PluginView from '../views/PluginView.vue';
const sectionSummaries: Record<string, string> = {
  system: '管理服务监听、平台目录与消息处理设置。',
  ims: '连接消息平台，按优先级将消息分配给 Agent 或指令。',
  llms: '集中管理模型服务的地址和凭据。',
  agents: '为每个 Agent 选择模型、人格与可用资源。',
  skills: '管理平台共享的技能库，按需装配给 Agent。',
  memories: '整理可由多个 Agent 使用的独立记忆库。',
  mcp: '配置外部 MCP 服务及连接方式。',
  tools: '管理平台可用工具与权限边界。',
};
const configRoute = (path: string, name: string, label: string, section: string, group = '配置'): RouteRecordRaw => ({ path, name, component: ConfigurationV3View, props: { section }, meta: { label, group, summary: sectionSummaries[section] } });
export const routes: RouteRecordRaw[] = [
  ...runtimeNavigation.map(item => ({ path:item.path, name:`typescript-${item.id}`, component:typescriptRuntime, meta:{ typescriptRuntime:true, label:item.label, group:item.group, summary:item.summary } })),
  { path:'/ts', redirect:'/' },
  { path:'/welcome', redirect:'/' },
  { path:'/ims', redirect:'/platforms' },
  { path:'/llms', redirect:'/providers' },
  { path:'/config', redirect:'/settings' },
  { path:'/conversations', redirect:'/sessions' },
  { path:'/knowledge', redirect:'/knowledge-base' },
  { path:'/resources/memories', redirect:'/memories' },
  { path:'/resources/skills', redirect:'/extensions' },
  { path:'/resources/mcp', redirect:'/extensions' },
  { path:'/logs/executions', redirect:'/runs' },
  { path:'/rust', name:'rust-runtime', component:() => import('../views/RustRuntimeView.vue') },
  { path:'/legacy', name:'overview', component:OverviewView, meta:{label:'原版概览',group:'兼容管理'} },
  configRoute('/legacy/config','legacy-config','系统设置','system'),
  configRoute('/legacy/ims','legacy-ims','IM 与路由','ims'),
  configRoute('/legacy/llms','legacy-llms','LLM 连接','llms'),
  configRoute('/legacy/agents','legacy-agents','Agent','agents'),
  ...['skills','memories','mcp','tools'].map(section=>configRoute(`/legacy/resources/${section}`,`legacy-${section}`,section,section)),
  {path:'/legacy/resources/personas',component:PersonaLibraryView},
  {path:'/legacy/conversations',component:ConversationView},
  {path:'/legacy/conversations/:id',component:ConversationDetailView},
  {path:'/legacy/logs/system',component:LogView},
  {path:'/legacy/logs/executions',component:ExecutionLogView},
  {path:'/legacy/plugins',component:PluginView},
  { path:'/:pathMatch(.*)*', redirect:'/' },
];
export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path !== from.path || to.query.agent !== from.query.agent || to.query.platform !== from.query.platform) return { top: 0 };
    return undefined;
  },
});
