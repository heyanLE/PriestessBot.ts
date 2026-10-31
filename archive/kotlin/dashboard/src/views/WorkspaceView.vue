<template>
  <div class="workspace-command">
    <section class="panel workspace-hero">
      <div class="workspace-hero-grid">
        <div class="workspace-copy">
          <div class="workspace-band">
            <span>变更</span>
            <span>工作区</span>
          </div>

          <h2>工作区快照列表</h2>
          <p>
            在工作区影响当前智能体的生效配置前，检查运行范围、重载计划和限定资源。
          </p>

          <div class="grid workspace-signal-grid">
            <article v-for="signal in workspaceSignals" :key="signal.label" class="card workspace-signal" :class="`tone-${signal.tone}`">
              <span>{{ signal.label }}</span>
              <strong>{{ signal.value }}</strong>
              <p>{{ signal.detail }}</p>
            </article>
          </div>
        </div>

        <aside class="workspace-rail">
          <article class="card workspace-rail-card">
            <div class="section-title compact">
              <div>
                <h3>检查重点</h3>
                <p>快速确认快照健康状态、启用范围和重载差异。</p>
              </div>
            </div>

            <div class="rail-list">
              <div class="rail-item">
                <span>已启用工作区</span>
                <strong>{{ enabledCount }}/{{ store.workspaces.workspaces.length }}</strong>
              </div>
              <div class="rail-item">
                <span>当前选择</span>
                <strong>{{ detail?.status.name ?? '等待选择' }}</strong>
              </div>
              <div class="rail-item">
                <span>重载状态</span>
                <strong>{{ reloadSummary }}</strong>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </section>

    <div class="workbench-grid wide-detail">
      <section class="panel registry-panel">
        <div class="section-title">
          <div>
            <h2>工作区清单</h2>
            <p>已配置 {{ store.workspaces.workspaces.length }} 个运行范围。</p>
          </div>
          <div class="toolbar">
            <button type="button" @click="loadWorkspaces" :disabled="loading">刷新</button>
            <button type="button" class="primary" @click="reloadAll" :disabled="loading || reloadingId !== null">
              全部重载
            </button>
          </div>
        </div>

        <p v-if="notice" class="notice ok">{{ notice }}</p>
        <p v-if="error" class="notice error">{{ error }}</p>

        <EmptyState
          v-if="store.workspaces.workspaces.length === 0"
          title="暂无工作区"
          detail="后端发布快照后，工作区状态会显示在这里。"
        />

        <div v-else class="table-wrap workspace-table-wrap">
          <table class="table workspace-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>快照</th>
                <th>加载时间</th>
                <th>最近重载</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="workspace in store.workspaces.workspaces"
                :key="workspace.id"
                class="clickable-row"
                :class="{ selected: selectedWorkspaceId === workspace.id }"
                @click="selectWorkspace(workspace.id)"
              >
                <td>
                  <strong>{{ workspace.name }}</strong>
                  <p class="muted"><code>{{ workspace.id }}</code></p>
                </td>
                <td>
                  <StatusDot :label="workspace.enabled ? '已启用' : '已禁用'" :tone="workspace.enabled ? 'ok' : 'muted'" />
                </td>
                <td>{{ workspace.activeSnapshotVersion ?? '无' }}</td>
                <td>{{ formatTime(workspace.loadedAt) }}</td>
                <td>
                  <div class="reload-cell">
                    <StatusDot
                      v-if="workspace.lastReload"
                      :label="reloadStatusLabel(workspace.lastReload.status)"
                      :tone="workspace.lastReload.success ? 'ok' : 'error'"
                    />
                    <span v-else class="muted">无</span>
                    <p v-if="workspace.lastReload?.errorSummary" class="muted">{{ workspace.lastReload.errorSummary }}</p>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    class="primary"
                    :disabled="reloadingId !== null"
                    @click.stop="reloadOne(workspace.id)"
                  >
                    {{ reloadingId === workspace.id ? '重载中' : '重载' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="panel detail-panel workspace-detail-rail">
        <div class="section-title">
          <div>
            <h2>{{ detail?.status.name ?? '工作区详情' }}</h2>
            <p v-if="detail">{{ detail.providerName }} 快照 {{ detail.status.activeSnapshotVersion ?? '无' }}</p>
            <p v-else>选择工作区以检查限定资源和重载状态。</p>
          </div>
        </div>

        <EmptyState
          v-if="!detail && !loadingDetail"
          title="未选择工作区"
          detail="请选择工作区，以检查智能体、工具、技能、MCP、人格预设和记忆策略。"
        />

        <div v-if="detail" class="detail-stack">
          <article class="card workspace-rail-card">
            <div class="grid detail-stat-grid">
              <article class="detail-stat">
                <span>智能体</span>
                <strong>{{ detail.agents.length }}</strong>
              </article>
              <article class="detail-stat">
                <span>工具</span>
                <strong>{{ detail.tools.length }}</strong>
              </article>
              <article class="detail-stat">
                <span>技能</span>
                <strong>{{ detail.skills.length }}</strong>
              </article>
              <article class="detail-stat">
                <span>MCP</span>
                <strong>{{ detail.mcpServers.length }}</strong>
              </article>
            </div>

            <div class="detail-list">
              <div class="detail-item">
                <span>模型服务</span>
                <strong>{{ detail.providerName }}</strong>
              </div>
              <div class="detail-item">
                <span>记忆功能</span>
                <strong>{{ detail.memory.enabled ? '已启用' : '已禁用' }}</strong>
              </div>
              <div class="detail-item">
                <span>最大注入数</span>
                <strong>{{ detail.memory.maxInjectedMemories }}</strong>
              </div>
            </div>
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>智能体</h3>
            <ResourceList :items="detail.agents" empty-label="没有限定智能体" />
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>工具</h3>
            <ResourceList :items="detail.tools" empty-label="没有限定工具" />
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>技能</h3>
            <ResourceList :items="detail.skills" empty-label="没有限定技能" />
            <div v-if="Object.keys(detail.skillSettings).length" class="resource-list">
              <span v-for="(settings, name) in detail.skillSettings" :key="name" class="chip">
                {{ name }}：{{ Object.keys(settings).length }} 项设置
              </span>
            </div>
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>MCP</h3>
            <ResourceList :items="detail.mcpServers" empty-label="没有 MCP 服务" />
            <div v-if="detail.mcpServerDetails.length" class="resource-list">
              <span v-for="server in detail.mcpServerDetails" :key="server.id" class="chip">
                {{ server.id }} / {{ server.transport }}
              </span>
            </div>
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>人格预设</h3>
            <ResourceList :items="detail.personas" empty-label="没有人格预设" />
          </article>

          <article class="card workspace-rail-card resource-card">
            <h3>记忆策略</h3>
            <p>范围：{{ detail.memory.allowedScopes.map(memoryScopeLabel).join(', ') || '无' }}</p>
            <p>知识库：{{ detail.memory.knowledgeBaseIds.join(', ') || '无' }}</p>
          </article>

          <section v-if="detail.status.diagnostics.length" class="notice">
            <strong>诊断信息</strong>
            <ul>
              <li v-for="item in detail.status.diagnostics" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="lastReload" class="notice" :class="{ error: !lastReload.success, ok: lastReload.success }">
            <strong>重载状态：{{ reloadStatusLabel(lastReload.status) }}</strong>
            <p>工作区 {{ lastReload.workspaceId }} / 快照 {{ lastReload.snapshotVersion ?? '未变化' }}</p>
            <p v-if="lastReload.errorSummary">{{ lastReload.errorSummary }}</p>
            <div v-if="lastReload.plan" class="reload-plan">
              <span>新增 {{ lastReload.plan.added.length }}</span>
              <span>移除 {{ lastReload.plan.removed.length }}</span>
              <span>修改 {{ lastReload.plan.modified.length }}</span>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue';
import { dashboardApi, type WorkspaceDetailDto, type WorkspaceReloadResult } from '../api/dashboard';
import EmptyState from '../components/EmptyState.vue';
import StatusDot from '../components/StatusDot.vue';
import { useDashboardStore } from '../stores/dashboard';

const store = useDashboardStore();
const selectedWorkspaceId = ref('');
const detail = ref<WorkspaceDetailDto | null>(null);
const loading = ref(false);
const loadingDetail = ref(false);
const reloadingId = ref<string | null>(null);
const lastReload = ref<WorkspaceReloadResult | null>(null);
const notice = ref('');
const error = ref('');

const selectedWorkspace = computed(
  () => store.workspaces.workspaces.find((workspace) => workspace.id === selectedWorkspaceId.value) ?? null,
);
const enabledCount = computed(() => store.workspaces.workspaces.filter((workspace) => workspace.enabled).length);
const failingReloadCount = computed(
  () => store.workspaces.workspaces.filter((workspace) => workspace.lastReload && !workspace.lastReload.success).length,
);

const workspaceSignals = computed(() => [
  {
    label: '范围',
    value: String(store.workspaces.workspaces.length),
    detail: '后端当前发布的运行时工作区范围。',
    tone: store.workspaces.workspaces.length > 0 ? 'ok' : 'muted',
  },
  {
    label: '已启用',
    value: String(enabledCount.value),
    detail: `${store.workspaces.workspaces.length - enabledCount.value} 个范围已停用。`,
    tone: enabledCount.value > 0 ? 'ok' : 'warn',
  },
  {
    label: '失败',
    value: String(failingReloadCount.value),
    detail: failingReloadCount.value > 0 ? '最近的重载故障需要检查。' : '当前列表中没有重载失败。',
    tone: failingReloadCount.value > 0 ? 'warn' : 'ok',
  },
  {
    label: '已选择',
    value: detail.value?.status.name ?? '无',
    detail: detail.value ? '当前详情面板中的工作区诊断范围。' : '请选择范围以检查资源。',
    tone: detail.value ? 'muted' : 'muted',
  },
]);

const reloadSummary = computed(() => {
  if (reloadingId.value === '*') return '正在重载全部工作区';
  if (reloadingId.value) return `正在重载 ${reloadingId.value}`;
  if (failingReloadCount.value > 0) return `有 ${failingReloadCount.value} 个重载失败`;
  return '没有重载故障';
});

const ResourceList = defineComponent({
  props: {
    items: { type: Array<string>, required: true },
    emptyLabel: { type: String, required: true },
  },
  setup(props) {
    return () =>
      props.items.length === 0
        ? h('p', { class: 'muted' }, props.emptyLabel)
        : h(
            'div',
            { class: 'resource-list' },
            props.items.map((item) => h('span', { class: 'inline-status muted', key: item }, item)),
          );
  },
});

async function loadWorkspaces() {
  loading.value = true;
  error.value = '';
  try {
    await store.loadWorkspaces();
    if (!selectedWorkspaceId.value && store.workspaces.workspaces.length > 0) {
      selectedWorkspaceId.value = store.workspaces.workspaces[0].id;
    }
    await loadDetail();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

async function loadDetail() {
  if (!selectedWorkspaceId.value) {
    detail.value = null;
    return;
  }
  loadingDetail.value = true;
  try {
    detail.value = await dashboardApi.workspaceDetail(selectedWorkspaceId.value);
  } finally {
    loadingDetail.value = false;
  }
}

function selectWorkspace(id: string) {
  selectedWorkspaceId.value = id;
}

async function reloadOne(id: string) {
  reloadingId.value = id;
  notice.value = '';
  error.value = '';
  try {
    lastReload.value = await store.reloadWorkspace(id);
    notice.value = lastReload.value.success ? `已重载 ${id}。` : '';
    await loadDetail();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    reloadingId.value = null;
  }
}

async function reloadAll() {
  reloadingId.value = '*';
  notice.value = '';
  error.value = '';
  try {
    const results = await store.reloadWorkspaces();
    const failed = results.filter((result) => !result.success);
    lastReload.value = results.find((result) => result.workspaceId === selectedWorkspaceId.value) ?? results[0] ?? null;
    notice.value = failed.length === 0 ? `已重载 ${results.length} 个工作区。` : '';
    if (failed.length > 0) error.value = `${failed.length} 个工作区重载失败。`;
    await loadDetail();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    reloadingId.value = null;
  }
}

function formatTime(value?: number) {
  if (!value) return '未加载';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function reloadStatusLabel(status: string) {
  const labels: Record<string, string> = {
    SUCCESS: '成功',
    FAILED: '失败',
    ERROR: '错误',
    RELOADED: '已重载',
    UNCHANGED: '未变化',
  };
  return labels[status] ?? status;
}

function memoryScopeLabel(scope: string) {
  const labels: Record<string, string> = {
    GLOBAL: '全局',
    PLATFORM: '平台',
    SESSION: '会话',
    USER: '用户',
    AGENT: '智能体',
  };
  return labels[scope] ?? scope;
}

watch(selectedWorkspace, () => void loadDetail());

onMounted(() => {
  void loadWorkspaces();
});
</script>

<style scoped>
.workspace-command {
  display: grid;
  gap: 14px;
}

.workspace-hero {
  border-color: #d7cebd;
  background:
    linear-gradient(135deg, rgba(255, 252, 246, 0.98) 0%, rgba(247, 241, 231, 0.98) 55%, rgba(240, 246, 248, 0.98) 100%);
}

.workspace-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(280px, 0.82fr);
  gap: 14px;
}

.workspace-band {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.workspace-band span,
.workspace-signal span,
.rail-item span,
.detail-stat span {
  color: #887152;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.workspace-band span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(182, 159, 111, 0.34);
  background: rgba(255, 251, 245, 0.92);
}

.workspace-copy h2 {
  margin: 0;
  color: #18304c;
  font-size: clamp(28px, 2vw + 18px, 40px);
  line-height: 0.98;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.workspace-copy > p {
  margin: 12px 0 0;
  color: #5c6776;
  line-height: 1.66;
}

.workspace-signal-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.workspace-signal {
  display: grid;
  gap: 8px;
  border-top: 3px solid #98a2b0;
  background: rgba(255, 252, 247, 0.9);
}

.workspace-signal.tone-ok {
  border-top-color: #4c8661;
}

.workspace-signal.tone-warn {
  border-top-color: #bb8524;
}

.workspace-signal.tone-muted {
  border-top-color: #98a2b0;
}

.workspace-signal strong {
  color: #17304d;
  font-size: 28px;
  line-height: 1;
  overflow-wrap: anywhere;
}

.workspace-signal p {
  margin: 0;
  color: #606a79;
  font-size: 12px;
  line-height: 1.58;
}

.workspace-rail,
.detail-stack {
  display: grid;
  gap: 12px;
}

.workspace-rail-card {
  border-color: #ddd4c5;
  background: rgba(255, 252, 246, 0.92);
}

.rail-list,
.resource-list,
.reload-plan {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rail-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e3dacb;
  background: rgba(255, 251, 245, 0.92);
}

.rail-item strong {
  color: #19314d;
  font-size: 14px;
  line-height: 1.46;
}

.registry-panel,
.workspace-detail-rail {
  border-color: #ddd3c3;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.96) 0%, rgba(248, 243, 234, 0.94) 100%);
}

.workspace-table-wrap {
  border-color: #ddd4c4;
  background: rgba(255, 252, 247, 0.74);
}

.reload-cell {
  display: grid;
  gap: 4px;
}

.detail-stat-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.detail-stat {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e3d9c8;
  background: rgba(255, 252, 247, 0.92);
}

.detail-stat strong {
  color: #18314d;
  font-size: 22px;
  line-height: 1;
}

.resource-card {
  min-height: 0;
}

@media (max-width: 1180px) {
  .workspace-hero-grid,
  .workbench-grid.wide-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .workspace-signal-grid,
  .detail-stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
