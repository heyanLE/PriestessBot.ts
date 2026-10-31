<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { RuntimeConfig, PlatformsResponseSchema } from '../../../../typescript/packages/contracts/src/index';
import { changedConfigPages, isRuntimeConfigEditor } from '../../utils/workflow-model';
import { runtimeNavigation, type RuntimeNavigationItem, type RuntimePage } from './navigation';

const props = defineProps<{ page: RuntimePage; section?: string; draft: RuntimeConfig; published: RuntimeConfig; platformStatuses: ReturnType<typeof PlatformsResponseSchema.parse>['platforms'] }>();
interface Guide { mode: string; text: string; }
const guides: Readonly<Record<RuntimePage, Guide>> = {
  resources: { mode: '选择资源', text: '先在资源库维护资料。再到 Agent 选择需要使用的资源。' },
  tools: { mode: '查看来源与适用条件', text: '查看工具来源和使用条件。Agent 装配后仍需通过权限检查。平台工具只用于其支持的平台。' },
  welcome: { mode: '按步骤配置', text: '先保存配置。再发送测试消息，检查模型回复和平台投递。' },
  chat: { mode: '发送即执行', text: '对话使用已保存的配置。发送后可查看执行详情。需要审批时，请前往执行记录。' },
  conversations: { mode: '会话独立保存', text: '标题与分组单独保存。归档、停止和删除立即提交。从历史继续会创建控制台会话，原记录保留。' },
  providers: { mode: '统一保存配置', text: '连接设置先加入运行配置草稿。请在系统设置保存引用的密钥。发布运行配置后，再为 Agent 选择此服务。' },
  agents: { mode: '保存当前 Agent', text: '只保存当前 Agent 与人格绑定；其他配置草稿保留。应用时仍会重配运行服务，并中断活动任务。' },
  personas: { mode: '编辑人格', text: '在此编辑正文、示例和回复规则。保存后影响所有使用此人格的 Agent。请到 Agent 选择人格并发布。' },
  platforms: { mode: '统一保存配置', text: '连接、启停和回复设置在保存后应用。连接在线后，请检查消息准入、Agent 路由和发送者权限。' },
  flow: { mode: '统一保存配置', text: '节点和规则先加入运行配置草稿。模拟检查当前草稿的路由与权限。实际消息使用已保存配置。' },
  permissions: { mode: '分配固定运行态', text: '选择机器人，填写一个或多个发送者 ID，再选择运行态。发布后，这些 ID 使用该态的固定权限。' },
  knowledge: { mode: '文档操作立即提交', text: '先在“知识库设置”创建并保存库。导入资料后，等待索引完成。验证检索结果后，再为 Agent 装配此库。' },
  memories: { mode: '记忆独立保存', text: '记忆内容单独保存。新增和整理使用表单中指定的身份范围。请检查列表范围后再操作。' },
  search: { mode: '搜索独立保存', text: '用“保存搜索配置”应用修改。密钥状态对应已保存配置。请在 Agent 装配所需工具，并配置发送者权限。' },
  plugins: { mode: '插件独立保存', text: '用插件内的按钮保存设置。扫码登录、取消订阅和回忆管理立即提交。工具仍需在 Agent 装配并获得授权。' },
  extensions: { mode: '统一保存配置', text: 'MCP 与 Skills 先加入运行配置草稿。保存后，请到 Agent 装配资源和工具。再检查发送者权限。' },
  runs: { mode: '查看与处理运行', text: '查看执行步骤、工具结果和产物。停止和审批立即提交。完整消息正文请到会话管理查看。' },
  execution: { mode: '查看状态 · 终止立即执行', text: '先选择运行，再查看进程。终止 SDK Docker 进程会关闭该任务容器，工作文件保留。修改后端请切换到“环境配置”。' },
  files: { mode: '文件操作立即提交', text: '文件操作直接作用于所选工作目录。上传会拒绝覆盖同名文件。生成的产物也可从执行记录下载。' },
  settings: { mode: '凭据与配置分别保存', text: '密钥单独保存，可能触发机器人重连。导入会替换配置草稿。历史恢复会发布新修订。导出前请选择已保存配置或当前草稿。' },
};
const guide = computed<Guide>(() => {
  if (props.page === 'extensions' && props.section === 'native') return { mode: '扩展独立保存', text: '安装、启停和配置重载立即提交。新扩展默认停用。启用后，请在 Agent 装配需要的工具。' };
  if (props.page === 'memories' && props.section === 'maintenance') return { mode: '策略独立保存 · 整理单独执行', text: '选择记忆范围后，生成合并预览。核对来源后再应用。定期策略单独保存。自动应用会替换预览中的源记忆。' };
  if ((props.page === 'memories' || props.page === 'knowledge') && props.section === 'settings') return { mode: '统一保存配置', text: '库设置先加入运行配置草稿。保存后，再到内容页添加资料。请在 Agent 装配需要使用的库。' };
  if (props.page === 'execution' && props.section === 'settings') return { mode: '统一保存配置', text: '环境设置先加入运行配置草稿。保存后，请检查环境是否可用。再为 Agent 和发送者配置执行权限。' };
  return guides[props.page];
});
const modified = computed(() => isRuntimeConfigEditor(props.page, props.section) && changedConfigPages(props.published, props.draft).includes(props.page));
const related = computed(() => (runtimeNavigation.find(item => item.id === props.page)?.related ?? []).map(id => runtimeNavigation.find(item => item.id === id)).filter((item): item is RuntimeNavigationItem => item !== undefined));
const connectedPlatforms = computed(() => props.published.platforms.filter(platform => props.platformStatuses.some(status => status.id === platform.id && status.status === 'connected')).length);
const savedAgents = computed(() => props.published.agents.filter(agent => agent.enabled).length);
</script>
<template>
  <section class="panel ts-fields" aria-label="当前页面操作指南">
    <div class="section-title compact"><div><strong>{{ guide.mode }}</strong><p class="muted">{{ guide.text }}</p></div><span v-if="modified" class="chip">本页有未保存配置</span></div>
    <div v-if="page === 'welcome'" class="ts-start-grid">
      <RouterLink class="ts-start-card" to="/settings"><span>01</span><strong>配置凭据</strong><p>保存机器人和模型引用的密钥。密钥状态在系统设置查看。</p></RouterLink>
      <RouterLink class="ts-start-card" to="/providers"><span>02</span><strong>选择模型服务</strong><p>已有 {{ published.connections.length }} 个已保存配置。请通过对话验证连接。</p></RouterLink>
      <RouterLink class="ts-start-card" to="/agents"><span>03</span><strong>配置 Agent</strong><p>{{ savedAgents }} 个 Agent 已启用。选择模型、人格与获准工具。</p></RouterLink>
      <RouterLink class="ts-start-card" to="/platforms"><span>04</span><strong>连接机器人</strong><p>{{ published.platforms.length }} 个已保存实例，当前 {{ connectedPlatforms }} 个连接在线。</p></RouterLink>
      <RouterLink class="ts-start-card" to="/chat"><span>05</span><strong>对话验证</strong><p>先检查模型回复。再到目标 IM 平台验证路由、权限和投递。</p></RouterLink>
    </div>
    <nav v-else class="toolbar" aria-label="相关操作"><span class="muted">相关操作</span><RouterLink v-for="item in related" :key="item.id" class="button-link" :to="item.path">{{ item.label }}</RouterLink></nav>
    <div v-if="page === 'welcome'" class="toolbar"><RouterLink class="button-link" to="/flow">检查消息路由</RouterLink><RouterLink class="button-link" to="/permissions">配置发送者权限</RouterLink><RouterLink class="button-link" to="/runs">查看验证结果</RouterLink></div>
  </section>
</template>
