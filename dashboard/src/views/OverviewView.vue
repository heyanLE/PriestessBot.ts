<template>
  <div class="overview-page">
    <div class="overview-statusbar">
      <div class="overview-status-copy">
        <span class="inline-status" :class="healthTone">{{ healthLabel }}</span>
        <span>{{ store.lastUpdated ? `更新于 ${clock(store.lastUpdated)}` : '正在读取运行状态' }}</span>
      </div>
      <RouterLink class="overview-text-link" to="/logs/system">系统日志 <span aria-hidden="true">↗</span></RouterLink>
    </div>

    <p v-if="store.error || configuration.error" class="notice error" role="alert">{{ store.error || configuration.error }}</p>

    <section class="surface-section overview-chain">
      <div class="section-title">
        <div><h2>消息处理链路</h2><p>从消息接入到模型响应，查看已保存的配置。</p></div>
        <span v-if="configuration.dirty" class="overview-context-note">编辑中的草稿尚未计入</span>
      </div>
      <div class="chain-stages">
        <RouterLink v-for="(stage, index) in chainStages" :key="stage.label" :to="stage.to" class="chain-stage">
          <div class="chain-stage-label"><span class="chain-index">0{{ index + 1 }}</span><span>{{ stage.label }}</span><span class="chain-open" aria-hidden="true">↗</span></div>
          <div class="chain-stage-value">{{ stage.value }}<span>{{ stage.unit }}</span></div>
          <p>{{ stage.detail }}</p>
          <span v-if="index < chainStages.length - 1" class="chain-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </div>
      <div class="chain-footnote">
        <span><i class="overview-live-dot" aria-hidden="true"></i>{{ store.runningPlatforms }} 个 IM 正在运行</span>
        <span>{{ assignedAgents }} 个 Agent 已被启用的路由引用</span>
        <RouterLink to="/ims">检查路由配置 <span aria-hidden="true">→</span></RouterLink>
      </div>
    </section>

    <div class="overview-workbench">
      <section class="surface-section overview-activity">
        <div class="section-title">
          <div><h2>近期执行</h2><p>最新 {{ recentExecutions.length }} 条记录 · 共 {{ executionTotal?.toLocaleString() ?? '—' }} 次已记录执行</p></div>
          <RouterLink class="overview-text-link" to="/logs/executions">全部执行 <span aria-hidden="true">→</span></RouterLink>
        </div>
        <p v-if="executionError" class="notice error" role="alert">{{ executionError }}</p>
        <p v-if="executionLoading && !recentExecutions.length" class="overview-empty" role="status">正在加载执行记录…</p>
        <div v-else-if="!recentExecutions.length && !executionError" class="overview-empty">
          <strong>尚无执行记录</strong><p>IM 消息触发 Agent 后，可以在这里查看模型与工具的执行过程。</p><RouterLink to="/agents">打开 Agent 调试 →</RouterLink>
        </div>
        <ol v-else class="recent-executions">
          <li v-for="item in recentExecutions" :key="item.id">
            <RouterLink :to="{ path: '/logs/executions', query: { execution: item.id } }" class="recent-execution">
              <span class="execution-status-mark" :class="statusTone(item.status)" aria-hidden="true"></span>
              <div class="recent-execution-body"><strong>{{ item.inputPreview || '无文本输入' }}</strong><span>{{ item.platform }} <span aria-hidden="true">/</span> {{ item.agent || '未进入 Agent' }} <span aria-hidden="true">·</span> {{ item.model || '未调用模型' }}</span></div>
              <div class="recent-execution-end"><span class="execution-state" :class="statusTone(item.status)">{{ statusLabels[item.status] }}</span><time :datetime="new Date(item.startedAt).toISOString()">{{ date(item.startedAt) }}</time></div>
              <span class="recent-execution-arrow" aria-hidden="true">↗</span>
            </RouterLink>
          </li>
        </ol>
      </section>

      <aside class="surface-section overview-attention">
        <div class="section-title"><div><h2>需要关注 <span v-if="attentionItems.length" class="attention-count">{{ attentionItems.length }}</span></h2><p>连接、配置与最近的执行异常。</p></div></div>
        <div v-if="!store.health && !savedConfig" class="overview-empty"><p>运行数据加载后显示检查结果。</p></div>
        <div v-else-if="!attentionItems.length" class="attention-clear"><span class="attention-check" aria-hidden="true">✓</span><strong>当前没有待处理项</strong><p>{{ executionError || executionLoading ? '健康检查未报告异常，执行记录尚未加载完成。' : '健康检查未报告异常，最近加载的执行中也没有失败记录。' }}</p></div>
        <ul v-else class="attention-list">
          <li v-for="item in attentionItems" :key="item.id"><RouterLink :to="item.to"><span class="attention-kind" :class="item.tone">{{ item.badge }}</span><strong>{{ item.title }}</strong><p>{{ item.detail }}</p><span class="attention-action">{{ item.action }} <span aria-hidden="true">→</span></span></RouterLink></li>
        </ul>
      </aside>
    </div>

    <section class="surface-section overview-conversations">
      <div class="section-title"><div><h2>最近会话</h2><p>跨 IM 查看最近活跃的对话。</p></div><RouterLink class="overview-text-link" to="/conversations">全部会话 <span aria-hidden="true">→</span></RouterLink></div>
      <div v-if="!recentConversations.length" class="overview-empty compact"><p>还没有会话。收到并处理消息后，会话历史会显示在这里。</p></div>
      <div v-else class="table-wrap"><table class="table overview-conversation-table"><thead><tr><th>IM</th><th>会话 ID</th><th>最近更新</th><th><span class="sr-only">操作</span></th></tr></thead><tbody><tr v-for="conversation in recentConversations" :key="conversation.id"><td>{{ conversation.platform }}</td><td><RouterLink :to="`/conversations/${conversation.id}`"><code>{{ conversation.sessionId }}</code></RouterLink></td><td>{{ date(conversation.updatedAt) }}</td><td><RouterLink :to="`/conversations/${conversation.id}`" :aria-label="`查看会话 ${conversation.sessionId}`">查看 <span aria-hidden="true">↗</span></RouterLink></td></tr></tbody></table></div>
    </section>

    <details class="surface-section overview-system">
      <summary><span>系统信息</span><small>配置来源、运行时间与平台资源</small></summary>
      <dl class="overview-system-grid"><div><dt>持续运行</dt><dd>{{ uptime }}</dd></div><div><dt>当前快照</dt><dd>{{ store.health?.diagnostics.activeSnapshotVersion || '—' }}</dd></div><div><dt>平台资源</dt><dd>{{ savedConfig?.skillLibraries.length ?? 0 }} 个 Skill 库 · {{ savedConfig?.memoryLibraries.length ?? 0 }} 个记忆库 · {{ savedConfig?.mcpServers.length ?? 0 }} 个 MCP 服务</dd></div><div><dt>配置文件</dt><dd><code>{{ configuration.sourcePath || store.health?.diagnostics.configPath || '未加载' }}</code></dd></div><div><dt>平台目录</dt><dd><code>{{ store.health?.diagnostics.platformDirectory || savedConfig?.platformDirectory || '未加载' }}</code></dd></div><div><dt>数据库</dt><dd><code>{{ store.health?.diagnostics.databasePath || '未加载' }}</code></dd></div></dl>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { executionsApi, type ExecutionSummary } from '../api/executions';
import type { ApplicationConfig } from '../models/configV3';
import { useDashboardStore } from '../stores/dashboard';
import { useConfigV3Store } from '../stores/configV3';

const store = useDashboardStore();
const configuration = useConfigV3Store();
const recentExecutions = ref<ExecutionSummary[]>([]);
const executionTotal = ref<number | null>(null);
const executionLoading = ref(false);
const executionError = ref('');
let executionRequest = 0;
const savedConfig = computed<ApplicationConfig | null>(() => {
  try { return configuration.baseline ? JSON.parse(configuration.baseline) as ApplicationConfig : null; }
  catch { return null; }
});
const activeIms = computed(() => savedConfig.value?.ims.filter(item => item.enabled) ?? []);
const activeAgents = computed(() => savedConfig.value?.agents.filter(item => item.enabled) ?? []);
const activeLlms = computed(() => savedConfig.value?.llms.filter(item => item.enabled) ?? []);
const activeRoutes = computed(() => activeIms.value.flatMap(im => im.routes.filter(route => route.enabled)));
const assignedAgents = computed(() => new Set(activeRoutes.value.filter(route => route.action.type === 'AGENT').map(route => route.action.agentId).filter(id => activeAgents.value.some(agent => agent.id === id))).size);
const chainStages = computed(() => [
  { label: 'IM 接入', value: savedConfig.value ? activeIms.value.length : '—', unit: '个启用', detail: `${savedConfig.value?.ims.length ?? 0} 个连接配置`, to: '/ims' },
  { label: '消息路由', value: savedConfig.value ? activeRoutes.value.length : '—', unit: '条启用', detail: `${activeRoutes.value.filter(route => route.action.type === 'COMMAND').length} 条命令路由，按顺序匹配`, to: '/ims' },
  { label: 'Agent', value: savedConfig.value ? activeAgents.value.length : '—', unit: '个启用', detail: '独立的模型与资源装配', to: '/agents' },
  { label: 'LLM 连接', value: savedConfig.value ? activeLlms.value.length : '—', unit: '个启用', detail: `${new Set(activeAgents.value.map(agent => agent.llm.providerRef)).size} 个连接被 Agent 使用`, to: '/llms' },
]);
const statusLabels = { RUNNING: '运行中', SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消', SKIPPED: '已跳过' };
function statusTone(status: string) { return status === 'FAILED' ? 'error' : status === 'RUNNING' ? 'warn' : status === 'SUCCEEDED' ? 'ok' : 'muted'; }
const healthTone = computed(() => !store.health ? 'muted' : ['UP', 'OK', 'HEALTHY'].includes(store.health.status.toUpperCase()) ? 'ok' : 'warn');
const healthLabel = computed(() => !store.health ? '状态待加载' : healthTone.value === 'ok' ? '服务运行正常' : '服务需要检查');
const recentConversations = computed(() => [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5));
type AttentionItem = { id: string; title: string; detail: string; badge: string; action: string; tone: string; to: string };
const attentionItems = computed(() => {
  const items: AttentionItem[] = [];
  Object.entries(store.health?.components ?? {}).filter(([key, status]) => !key.endsWith('Error') && /^(DEGRADED|DOWN|ERROR|FAILED|UNHEALTHY)$/i.test(status)).forEach(([key, status]) => {
    items.push({ id: key, title: `${componentName(key)}需要检查`, detail: `健康接口报告 ${status}。`, badge: '运行异常', action: '检查系统日志', tone: 'error', to: '/logs/system' });
  });
  const pending = Number(store.health?.diagnostics.pendingRestartCount ?? 0);
  if (pending > 0) items.push({ id: 'restart', title: `${pending} 项配置等待重启`, detail: '已保存的变更将在服务重启后生效。', badge: '待生效', action: '查看系统设置', tone: 'warn', to: '/config' });
  const diagnostic = store.health?.diagnostics.configurationDiagnostics ?? '';
  if (/(ERROR|WARNING):[1-9]\d*/.test(diagnostic)) items.push({ id: 'diagnostics', title: '配置诊断需要处理', detail: diagnostic, badge: '配置', action: '检查配置', tone: 'warn', to: '/config' });
  if (savedConfig.value) {
    if (!activeIms.value.length) items.push({ id: 'im', title: '尚未启用 IM 连接', detail: '配置消息接入后，机器人才能在对应平台工作。', badge: '待配置', action: '配置 IM', tone: 'muted', to: '/ims' });
    else if (activeIms.value.some(im => !im.routes.some(route => route.enabled))) items.push({ id: 'routes', title: '有 IM 尚无启用路由', detail: '未匹配路由的消息不会触发 Agent。', badge: '待配置', action: '添加消息路由', tone: 'warn', to: '/ims' });
    if (!activeAgents.value.length) items.push({ id: 'agents', title: '尚未启用 Agent', detail: '选择模型并装配资源，开始处理消息。', badge: '待配置', action: '配置 Agent', tone: 'muted', to: '/agents' });
    else if (!activeLlms.value.length) items.push({ id: 'llms', title: '尚无启用的 LLM 连接', detail: 'Agent 需要可用的模型连接。', badge: '待配置', action: '配置 LLM', tone: 'warn', to: '/llms' });
  }
  const stopped = store.platforms.filter(item => item.enabled && !item.running);
  if (stopped.length) items.push({ id: 'stopped', title: `${stopped.length} 个已启用 IM 未运行`, detail: stopped.map(item => item.name).join('、'), badge: '连接', action: '检查 IM', tone: 'warn', to: '/ims' });
  const failed = recentExecutions.value.find(item => item.status === 'FAILED');
  if (failed) items.push({ id: failed.id, title: '最近的执行存在失败', detail: `${failed.agent || failed.platform} · ${date(failed.startedAt)}`, badge: '执行失败', action: '查看失败原因', tone: 'error', to: `/logs/executions?execution=${encodeURIComponent(failed.id)}` });
  return items.slice(0, 5);
});
const uptime = computed(() => {
  if (!store.health) return '—';
  const minutes = Math.floor(store.health.uptimeMillis / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时 ${minutes % 60} 分钟` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
});
const clock = (value: number) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
const date = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
function componentName(value: string) { return ({ config: '配置', database: '数据库', server: '服务端', providers: '模型服务', platforms: 'IM 平台', plugins: '插件', tools: '工具', workspaceReload: '配置重载' } as Record<string, string>)[value] ?? value; }
async function loadExecutions() {
  const request = ++executionRequest;
  executionLoading.value = true;
  executionError.value = '';
  try {
    const response = await executionsApi.list({ limit: 6, offset: 0 });
    if (request !== executionRequest) return;
    recentExecutions.value = response.items;
    executionTotal.value = response.total;
  } catch (cause) { if (request === executionRequest) executionError.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (request === executionRequest) executionLoading.value = false; }
}
onMounted(() => { void configuration.load(); void loadExecutions(); });
watch(() => store.lastUpdated, () => { void loadExecutions(); });
</script>

<style scoped>
.overview-page { display: grid; gap: 22px; min-width: 0; }
.overview-statusbar, .overview-status-copy { display: flex; align-items: center; gap: 12px; }
.overview-statusbar { justify-content: space-between; font-size: 12px; color: var(--muted); }
.overview-text-link { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; color: var(--text-strong); font-size: 12px; font-weight: 600; }
.overview-chain, .overview-activity, .overview-attention, .overview-conversations, .overview-system { min-width: 0; padding: 24px; background: var(--surface-strong, #fff); border: 1px solid var(--line, #DAE3EC); border-radius: 12px; }
.overview-context-note { color: var(--muted); font-size: 11px; }
.chain-stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 24px -4px 22px; }
.chain-stage { position: relative; display: block; min-width: 0; padding: 6px 24px 6px 20px; color: inherit; border-left: 1px solid var(--line); }
.chain-stage:first-child { border-left: 0; padding-left: 4px; }
.chain-stage:hover .chain-stage-label { color: var(--accent); }
.chain-stage-label { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--text-strong); }
.chain-index { color: var(--weak); font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
.chain-open { margin-left: auto; color: var(--weak); }
.chain-stage-value { margin-top: 18px; font-size: 38px; line-height: 1.15; font-weight: 600; letter-spacing: -1.5px; font-variant-numeric: tabular-nums; color: var(--text-strong); }
.chain-stage-value > span { margin-left: 9px; color: var(--muted); font-size: 11px; font-weight: 400; letter-spacing: 0; }
.chain-stage p { margin: 9px 0 0; font-size: 11px; color: var(--muted); line-height: 1.5; }
.chain-arrow { position: absolute; right: -8px; top: 51px; z-index: 1; background: var(--surface-strong, #fff); color: var(--weak); font-size: 17px; line-height: 22px; }
.chain-footnote { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 24px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.chain-footnote > span { display: inline-flex; align-items: center; gap: 7px; }
.chain-footnote > a { margin-left: auto; color: var(--text-strong); }
.overview-live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
.overview-workbench { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(260px, 1fr); gap: 22px; align-items: start; }
.recent-executions, .attention-list { margin: 0; padding: 0; list-style: none; }
.recent-executions li + li { border-top: 1px solid var(--line); }
.recent-execution { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto 12px; gap: 13px; align-items: center; padding: 18px 0; color: inherit; }
.recent-execution:hover strong, .recent-execution:hover .recent-execution-arrow { color: var(--accent); }
.execution-status-mark { width: 6px; height: 6px; border-radius: 50%; background: var(--weak); }
.execution-status-mark.ok { background: #42796a; }
.execution-status-mark.warn { background: #b1833f; }
.execution-status-mark.error { background: var(--accent); }
.recent-execution-body { display: grid; gap: 7px; min-width: 0; }
.recent-execution-body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; color: var(--text-strong); }
.recent-execution-body > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--muted); }
.recent-execution-body > span > span { padding: 0 4px; color: var(--weak); }
.recent-execution-end { display: grid; justify-items: end; gap: 7px; white-space: nowrap; }
.recent-execution-end time { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.execution-state { font-size: 10px; color: var(--muted); }
.execution-state.ok { color: #42796a; }
.execution-state.error { color: var(--accent); }
.recent-execution-arrow { color: var(--weak); font-size: 13px; }
.attention-count { font-size: 11px; font-weight: 500; color: var(--accent); margin-left: 6px; }
.attention-list li + li { border-top: 1px solid var(--line); }
.attention-list a { display: grid; gap: 8px; padding: 18px 0; color: inherit; }
.attention-list li:first-child a { padding-top: 2px; }
.attention-list strong { color: var(--text-strong); font-size: 13px; font-weight: 500; }
.attention-list p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.attention-kind { color: var(--muted); font-size: 10px; }
.attention-kind.error { color: var(--accent); }
.attention-kind.warn { color: #9c7535; }
.attention-action { margin-top: 2px; color: var(--text-strong); font-size: 11px; }
.attention-clear { display: grid; justify-items: start; gap: 12px; padding: 15px 0; }
.attention-check { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; color: #42796a; }
.attention-clear strong { font-size: 13px; color: var(--text-strong); font-weight: 500; }
.attention-clear p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.overview-empty { display: grid; gap: 10px; padding: 35px 10px; color: var(--muted); font-size: 12px; line-height: 1.8; }
.overview-empty p { margin: 0; }
.overview-empty strong { color: var(--text-strong); font-weight: 500; }
.overview-empty a { justify-self: start; color: var(--text-strong); }
.overview-empty.compact { padding: 16px 0; }
.overview-conversation-table th, .overview-conversation-table td { font-size: 12px; }
.overview-conversation-table th:last-child, .overview-conversation-table td:last-child { text-align: right; }
.overview-conversation-table code { font-size: 11px; overflow-wrap: anywhere; }
.overview-system { padding: 18px 24px; }
.overview-system > summary { display: flex; align-items: center; gap: 18px; cursor: pointer; color: var(--text-strong); font-size: 12px; font-weight: 500; }
.overview-system > summary::after { content: '+'; margin-left: auto; color: var(--muted); }
.overview-system[open] > summary::after { content: '−'; }
.overview-system > summary small { font-size: 11px; font-weight: 400; color: var(--muted); }
.overview-system-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px 28px; margin: 24px 0 4px; }
.overview-system-grid > div { min-width: 0; }
.overview-system-grid dt { margin-bottom: 7px; color: var(--muted); font-size: 11px; }
.overview-system-grid dd { margin: 0; color: var(--text-strong); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.overview-system-grid code { font-size: 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1120px) { .overview-workbench { grid-template-columns: minmax(0, 1.5fr) minmax(250px, 1fr); } .chain-stage { padding-right: 15px; padding-left: 15px; } }
@media (max-width: 900px) { .overview-workbench { grid-template-columns: 1fr; } .attention-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; } .attention-list li:nth-child(2) { border-top: 0; } .attention-list li:nth-child(2) a { padding-top: 2px; } .overview-system-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .overview-page { gap: 16px; } .overview-chain, .overview-activity, .overview-attention, .overview-conversations { padding: 18px; } .chain-stages { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 0; } .chain-stage:nth-child(3) { border-left: 0; padding-left: 4px; } .chain-stage:nth-child(2) .chain-arrow { display: none; } .chain-stage-value { font-size: 32px; } .chain-footnote { gap: 10px; } .chain-footnote > a { margin-left: 0; width: 100%; } .attention-list { display: block; } .attention-list li:nth-child(2) { border-top: 1px solid var(--line); } .attention-list li:nth-child(2) a { padding-top: 18px; } .recent-execution { gap: 9px; grid-template-columns: 5px minmax(0, 1fr) auto; } .recent-execution-arrow { display: none; } .recent-execution-body strong { font-size: 12px; } .overview-system-grid { grid-template-columns: 1fr; } .overview-system > summary small { display: none; } .overview-status-copy { gap: 8px; font-size: 10px; } }
</style>
