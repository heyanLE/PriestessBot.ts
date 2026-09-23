import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
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
  { path: '/', name: 'overview', component: OverviewView, meta: { label: '概览', group: '首页', summary: '集中查看运行健康状态、连接与资源。' } },
  configRoute('/config', 'config', '系统设置', 'system'),
  configRoute('/ims', 'ims', 'IM 与路由', 'ims'),
  configRoute('/llms', 'llms', 'LLM 连接', 'llms'),
  configRoute('/agents', 'agents', 'Agent', 'agents'),
  configRoute('/resources/skills', 'skill-libraries', 'Skill 库', 'skills', '平台资源'),
  configRoute('/resources/memories', 'memory-libraries', '记忆库', 'memories', '平台资源'),
  configRoute('/resources/mcp', 'mcp-servers', 'MCP 服务', 'mcp', '平台资源'),
  configRoute('/resources/tools', 'tools', '工具', 'tools', '平台资源'),
  { path: '/resources/personas', name: 'personas', component: PersonaLibraryView, meta: { label: '人格库', group: '平台资源', summary: '管理可由 Agent 单选装配的人格预设。' } },
  { path: '/conversations', name: 'conversations', component: ConversationView, meta: { label: '会话', group: '运行管理', summary: '检查消息流量与会话历史。' } },
  { path: '/conversations/:id', name: 'conversation-detail', component: ConversationDetailView, meta: { label: '会话详情', group: '运行管理', nav: false } },
  { path: '/logs/system', name: 'logs', component: LogView, meta: { label: '系统日志', group: '日志', summary: '查看服务运行事件、警告与错误。' } },
  { path: '/logs/executions', name: 'executions', component: ExecutionLogView, meta: { label: 'LLM 执行链', group: '日志', summary: '跟踪 IM、Agent、模型与工具的完整执行过程。' } },
  { path: '/plugins', name: 'plugins', component: PluginView, meta: { label: '插件', group: '兼容管理', nav: false } },
  { path: '/platforms', redirect: '/ims' }, { path: '/providers', redirect: '/llms' },
  { path: '/tools', redirect: '/resources/tools' }, { path: '/persona-memory', redirect: '/resources/personas' },
  { path: '/logs', redirect: '/logs/system' }, { path: '/workspaces', redirect: '/agents' },
  { path: '/working-directory', redirect: '/config' }, { path: '/sub-agents', redirect: '/agents' },
  { path: '/agent', redirect: '/agents' }, { path: '/effective-runtime', redirect: '/config' },
  { path: '/knowledge', redirect: '/resources/memories' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];
export default createRouter({ history: createWebHistory(), routes });
