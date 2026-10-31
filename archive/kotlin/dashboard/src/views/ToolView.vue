<template>
  <div class="tool-governance">
    <section class="panel governance-hero">
      <div class="governance-grid">
        <div class="governance-copy">
          <div class="governance-band">
            <span>资源</span>
            <span>工具</span>
          </div>

          <h2>运行时工具列表</h2>
          <p>
            在请求进入运行时前，集中检查可调用能力、允许/拒绝状态和风险等级。
          </p>

          <div class="grid governance-signal-grid">
            <article v-for="signal in governanceSignals" :key="signal.label" class="card governance-signal" :class="`tone-${signal.tone}`">
              <span>{{ signal.label }}</span>
              <strong>{{ signal.value }}</strong>
              <p>{{ signal.detail }}</p>
            </article>
          </div>
        </div>

        <aside class="governance-rail">
          <article class="card rail-card">
            <div class="section-title compact">
              <div>
                <h3>检查重点</h3>
                <p>修改工具策略前，确认作用范围、风险和覆盖设置。</p>
              </div>
            </div>

            <div class="rail-list">
              <div class="rail-item">
                <span>策略状态</span>
                <strong>{{ policyPosture }}</strong>
              </div>
              <div class="rail-item">
                <span>审计标记</span>
                <strong>{{ auditedCount }} 个工具包含审查元数据</strong>
              </div>
              <div class="rail-item">
                <span>默认关闭</span>
                <strong>{{ defaultOffCount }} 个工具默认受限</strong>
              </div>
            </div>
          </article>

          <article class="card rail-card">
            <div class="section-title compact">
              <div>
                <h3>来源分布</h3>
                <p>按工具来源统计配置覆盖情况。</p>
              </div>
            </div>

            <div class="source-list">
              <div v-for="item in sourceCards" :key="item.label" class="source-row">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
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
            <h2>工具列表</h2>
            <p>筛选后显示 {{ filteredTools.length }}/{{ store.tools.length }} 个工具。</p>
          </div>
          <div class="toolbar">
            <span class="inline-status" :class="registryStatus.tone">{{ registryStatus.label }}</span>
          </div>
        </div>

        <div class="control-strip">
          <label class="control-field search-field">
            <span>搜索</span>
            <input v-model="query" type="search" placeholder="名称或描述" />
          </label>

          <label class="control-field">
            <span>来源</span>
            <select v-model="sourceFilter">
              <option value="all">全部来源</option>
              <option value="BUILTIN">内置</option>
              <option value="PLUGIN">插件</option>
              <option value="MCP">MCP</option>
            </select>
          </label>

          <label class="control-field">
            <span>风险等级</span>
            <select v-model="riskFilter">
              <option value="all">全部风险</option>
              <option value="SAFE_READ">安全读取</option>
              <option value="SESSION_ACTION">会话操作</option>
              <option value="EXTERNAL_READ">外部读取</option>
              <option value="STATE_WRITE">状态写入</option>
              <option value="HIGH_RISK">高风险</option>
            </select>
          </label>

          <label class="control-field">
            <span>策略状态</span>
            <select v-model="enabledFilter">
              <option value="all">全部状态</option>
              <option value="enabled">允许</option>
              <option value="disabled">拒绝</option>
            </select>
          </label>
        </div>

        <p v-if="actionNotice" class="notice ok">{{ actionNotice }}</p>
        <p v-if="actionError" class="notice error">{{ actionError }}</p>

        <EmptyState
          v-if="filteredTools.length === 0"
          title="没有匹配工具"
          detail="请调整搜索内容或筛选条件。"
        />

        <div v-else class="table-wrap governance-table-wrap">
          <table class="table governance-table">
            <thead>
              <tr>
                <th>工具</th>
                <th>来源</th>
                <th>风险</th>
                <th>策略</th>
                <th>调用约束</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="tool in filteredTools"
                :key="tool.name"
                class="clickable-row"
                :class="{ selected: selectedTool?.name === tool.name }"
                @click="selectedToolName = tool.name"
              >
                <td>
                  <strong>{{ tool.name }}</strong>
                  <p class="muted">{{ tool.description }}</p>
                </td>
                <td>
                  <span class="inline-status muted">{{ formatSource(tool.source) }}</span>
                </td>
                <td>
                  <span class="inline-status" :class="riskTone(tool.riskLevel)">
                    {{ formatRiskLevel(tool.riskLevel) }}
                  </span>
                </td>
                <td>
                  <div class="tool-state">
                    <span class="inline-status" :class="isToolAllowed(tool.name) ? 'ok' : 'warn'">
                      {{ isToolAllowed(tool.name) ? '允许' : '拒绝' }}
                    </span>
                    <small>{{ tool.defaultEnabled ? '默认开启' : '默认关闭' }}</small>
                  </div>
                </td>
                <td>
                  <div class="contract-cell">
                    <strong>{{ tool.parameters.required.length }}</strong>
                    <small>{{ tool.requiredCapabilities.length }} 项能力</small>
                  </div>
                </td>
                <td>
                  <div class="toolbar compact-actions">
                    <button
                      type="button"
                      class="primary"
                      :disabled="!canEditTools || isToolAllowed(tool.name)"
                      @click.stop="allowTool(tool.name)"
                    >
                      允许
                    </button>
                    <button
                      type="button"
                      :disabled="!canEditTools || !isToolAllowed(tool.name)"
                      @click.stop="denyTool(tool.name)"
                    >
                      拒绝
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside class="panel detail-panel detail-rail">
        <div class="section-title">
          <div>
            <h2>{{ selectedTool?.name ?? '工具详情' }}</h2>
            <p>{{ selectedTool ? selectedDetailSummary : '请选择工具以检查策略和调用约束。' }}</p>
          </div>
        </div>

        <EmptyState
          v-if="!selectedTool"
          title="未选择工具"
          detail="请从列表中选择工具以检查策略详情。"
        />

        <div v-else class="detail-stack">
          <article class="card detail-card">
            <div class="section-title compact">
              <div>
                <h3>策略状态</h3>
                <p>当前允许状态、默认状态和审查标记。</p>
              </div>
            </div>

            <div class="chip-row detail-badges">
              <span class="inline-status" :class="isToolAllowed(selectedTool.name) ? 'ok' : 'warn'">
                {{ isToolAllowed(selectedTool.name) ? '允许' : '拒绝' }}
              </span>
              <span class="inline-status" :class="selectedTool.defaultEnabled ? 'muted' : 'warn'">
                {{ selectedTool.defaultEnabled ? '默认开启' : '默认关闭' }}
              </span>
              <span v-if="selectedTool.auditLog" class="inline-status muted">已审计</span>
              <span class="inline-status" :class="riskTone(selectedTool.riskLevel)">
                {{ formatRiskLevel(selectedTool.riskLevel) }}
              </span>
            </div>

            <div class="detail-list detail-list-tight">
              <div class="detail-item">
                <span>来源</span>
                <strong>{{ formatSource(selectedTool.source) }}</strong>
              </div>
              <div v-if="selectedTool.owner" class="detail-item">
                <span>所有者</span>
                <strong>{{ selectedTool.owner }}</strong>
              </div>
              <div class="detail-item">
                <span>运行说明</span>
                <strong>{{ toolOperationalNote(selectedTool) }}</strong>
              </div>
            </div>

            <div class="toolbar action-row">
              <button
                type="button"
                class="primary"
                :disabled="!canEditTools || isToolAllowed(selectedTool.name)"
                @click="allowTool(selectedTool.name)"
              >
                允许
              </button>
              <button
                type="button"
                :disabled="!canEditTools || !isToolAllowed(selectedTool.name)"
                @click="denyTool(selectedTool.name)"
              >
                拒绝
              </button>
            </div>
          </article>

          <article class="card detail-card">
            <div class="section-title compact">
              <div>
                <h3>调用约束</h3>
                <p>调用方需要提供的字段和满足的能力条件。</p>
              </div>
            </div>

            <div class="grid detail-stat-grid">
              <article class="detail-stat">
                <span>必填字段</span>
                <strong>{{ selectedTool.parameters.required.length }}</strong>
              </article>
              <article class="detail-stat">
                <span>结构属性</span>
                <strong>{{ parameterCount(selectedTool) }}</strong>
              </article>
              <article class="detail-stat">
                <span>能力条件</span>
                <strong>{{ selectedTool.requiredCapabilities.length }}</strong>
              </article>
            </div>

            <div class="detail-item">
              <span>必填参数</span>
              <div class="chip-row">
                <span v-for="name in selectedTool.parameters.required" :key="name" class="chip">{{ name }}</span>
                <span v-if="selectedTool.parameters.required.length === 0" class="muted">无</span>
              </div>
            </div>

            <div class="detail-item">
              <span>能力条件</span>
              <div class="chip-row">
                <span v-for="name in selectedTool.requiredCapabilities" :key="name" class="chip">{{ name }}</span>
                <span v-if="selectedTool.requiredCapabilities.length === 0" class="muted">无</span>
              </div>
            </div>
          </article>

          <p v-if="selectedTool.statusReason" class="notice warning">{{ selectedTool.statusReason }}</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import { useDashboardStore } from '../stores/dashboard';
import type { ToolDto } from '../api/dashboard';

const store = useDashboardStore();
const query = ref('');
const sourceFilter = ref('all');
const riskFilter = ref('all');
const enabledFilter = ref('all');
const selectedToolName = ref('');
const actionNotice = ref('');
const actionError = ref('');

const filteredTools = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase();
  return store.tools.filter((tool) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      tool.name.toLowerCase().includes(normalizedQuery) ||
      tool.description.toLowerCase().includes(normalizedQuery);
    const matchesSource = sourceFilter.value === 'all' || tool.source === sourceFilter.value;
    const matchesRisk = riskFilter.value === 'all' || tool.riskLevel === riskFilter.value;
    const allowed = isToolAllowed(tool.name);
    const matchesEnabled =
      enabledFilter.value === 'all' ||
      (enabledFilter.value === 'enabled' && allowed) ||
      (enabledFilter.value === 'disabled' && !allowed);
    return matchesQuery && matchesSource && matchesRisk && matchesEnabled;
  });
});

const selectedTool = computed(
  () => filteredTools.value.find((tool) => tool.name === selectedToolName.value) ?? filteredTools.value[0] ?? null,
);

const canEditTools = computed(() => false);
const allowedCount = computed(() => store.tools.filter((tool) => isToolAllowed(tool.name)).length);
const deniedCount = computed(() => store.tools.length - allowedCount.value);
const highRiskCount = computed(() => store.tools.filter((tool) => tool.riskLevel === 'HIGH_RISK').length);
const auditedCount = computed(() => store.tools.filter((tool) => tool.auditLog).length);
const defaultOffCount = computed(() => store.tools.filter((tool) => !tool.defaultEnabled).length);
const highRiskAllowedCount = computed(
  () => store.tools.filter((tool) => tool.riskLevel === 'HIGH_RISK' && isToolAllowed(tool.name)).length,
);

const governanceSignals = computed(() => [
  {
    label: '可见',
    value: String(filteredTools.value.length),
    detail: `运行时中共登记 ${store.tools.length} 个工具。`,
    tone: 'muted',
  },
  {
    label: '允许',
    value: String(allowedCount.value),
    detail: `${deniedCount.value} 个工具被策略明确阻止。`,
    tone: allowedCount.value > 0 ? 'ok' : 'warn',
  },
  {
    label: '拒绝',
    value: String(deniedCount.value),
    detail: '默认关闭和手动拒绝的工具仍会显示，便于审计。',
    tone: deniedCount.value > 0 ? 'warn' : 'muted',
  },
  {
    label: '高风险',
    value: String(highRiskCount.value),
    detail: `当前允许 ${highRiskAllowedCount.value} 个高风险工具。`,
    tone: highRiskAllowedCount.value > 0 ? 'warn' : 'ok',
  },
]);

const sourceCards = computed(() => [
  {
    label: '内置',
    value: String(store.tools.filter((tool) => tool.source === 'BUILTIN').length),
  },
  {
    label: '插件',
    value: String(store.tools.filter((tool) => tool.source === 'PLUGIN').length),
  },
  {
    label: 'MCP',
    value: String(store.tools.filter((tool) => tool.source === 'MCP').length),
  },
]);

const policyPosture = computed(() => {
  if (store.tools.length === 0) return '等待运行时同步工具列表';
  if (highRiskAllowedCount.value > 0) return `已开放 ${highRiskAllowedCount.value} 个高风险工具`;
  if (deniedCount.value > 0) return `${deniedCount.value} 个工具受限`;
  return '工具策略正常';
});

const registryStatus = computed(() => {
  if (filteredTools.value.length === 0) {
    return { label: '筛选结果为空', tone: 'muted' };
  }
  if (highRiskAllowedCount.value > 0) {
    return { label: '存在高风险开放项', tone: 'warn' };
  }
  return { label: '策略检查正常', tone: 'ok' };
});

const selectedDetailSummary = computed(() => {
  if (!selectedTool.value) return '';
  return `${formatSource(selectedTool.value.source)}工具，风险等级为${formatRiskLevel(selectedTool.value.riskLevel)}，包含 ${selectedTool.value.parameters.required.length} 个必填字段。`;
});

function isToolAllowed(name: string) {
  const tool = store.tools.find((item) => item.name === name);
  return tool?.effectiveEnabled ?? false;
}

async function allowTool(name: string) {
  actionNotice.value = '';
  actionError.value = '';
  try {
    await store.updateToolAllowance(name, true);
    actionNotice.value = `已允许 ${name}。`;
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function denyTool(name: string) {
  actionNotice.value = '';
  actionError.value = '';
  try {
    await store.updateToolAllowance(name, false);
    actionNotice.value = `已拒绝 ${name}。`;
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function formatRiskLevel(level: ToolDto['riskLevel']) {
  const labels: Record<ToolDto['riskLevel'], string> = {
    SAFE_READ: '安全读取',
    SESSION_ACTION: '会话操作',
    EXTERNAL_READ: '外部读取',
    STATE_WRITE: '状态写入',
    HIGH_RISK: '高风险',
  };
  return labels[level];
}

function formatSource(source: ToolDto['source']) {
  switch (source) {
    case 'BUILTIN':
      return '内置';
    case 'PLUGIN':
      return '插件';
    case 'MCP':
      return 'MCP';
    default:
      return source;
  }
}

function riskTone(level: ToolDto['riskLevel']) {
  switch (level) {
    case 'HIGH_RISK':
      return 'danger';
    case 'STATE_WRITE':
      return 'warn';
    case 'EXTERNAL_READ':
      return 'muted';
    case 'SESSION_ACTION':
      return 'ok';
    case 'SAFE_READ':
    default:
      return 'muted';
  }
}

function parameterCount(tool: ToolDto) {
  return Object.keys(tool.parameters.properties ?? {}).length;
}

function toolOperationalNote(tool: ToolDto) {
  if (tool.statusReason) return tool.statusReason;
  if (tool.requiredCapabilities.length > 0) {
    return `调用前需要满足 ${tool.requiredCapabilities.length} 项能力条件。`;
  }
  if (tool.parameters.required.length > 0) {
    return `有效调用需要填写 ${tool.parameters.required.length} 个字段。`;
  }
  return '除运行时策略和调用方范围外，没有额外限制。';
}

watch(filteredTools, (nextTools) => {
  if (!nextTools.some((tool) => tool.name === selectedToolName.value)) {
    selectedToolName.value = nextTools[0]?.name ?? '';
  }
});
</script>

<style scoped>
.tool-governance {
  display: grid;
  gap: 14px;
}

.governance-hero {
  overflow: hidden;
  border-color: #d8ceb9;
  background:
    linear-gradient(135deg, rgba(255, 252, 245, 0.98) 0%, rgba(248, 241, 229, 0.98) 58%, rgba(241, 246, 249, 0.98) 100%);
}

.governance-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(280px, 0.82fr);
  gap: 14px;
  align-items: start;
}

.governance-band {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.governance-band span,
.governance-signal span,
.rail-item span,
.source-row span,
.control-field span,
.detail-stat span {
  color: #8a7351;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.governance-band span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(185, 162, 113, 0.34);
  background: rgba(255, 251, 244, 0.92);
}

.governance-copy h2 {
  margin: 0;
  font-size: clamp(28px, 2vw + 18px, 40px);
  line-height: 0.98;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #17314c;
}

.governance-copy > p {
  max-width: 68ch;
  margin: 12px 0 0;
  color: #596473;
  line-height: 1.68;
}

.governance-signal-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.governance-signal {
  display: grid;
  gap: 8px;
  border-top: 3px solid #97a1b1;
  background: rgba(255, 252, 247, 0.88);
}

.governance-signal.tone-ok {
  border-top-color: #4c8661;
}

.governance-signal.tone-warn {
  border-top-color: #be8621;
}

.governance-signal.tone-muted {
  border-top-color: #97a1b1;
}

.governance-signal strong {
  color: #182f49;
  font-size: 30px;
  line-height: 1;
}

.governance-signal p {
  margin: 0;
  color: #5f6a78;
  font-size: 12px;
  line-height: 1.58;
}

.governance-rail {
  display: grid;
  gap: 12px;
}

.rail-card,
.detail-card {
  border-color: #ddd4c3;
  background: rgba(255, 252, 246, 0.92);
}

.rail-list,
.source-list {
  display: grid;
  gap: 10px;
}

.rail-item,
.source-row {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #e3d9ca;
  background: rgba(255, 251, 245, 0.92);
}

.rail-item strong,
.source-row strong {
  color: #182f49;
  font-size: 14px;
  line-height: 1.45;
}

.registry-panel,
.detail-rail {
  border-color: #ddd3c2;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.96) 0%, rgba(248, 243, 234, 0.94) 100%);
}

.control-strip {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(160px, 0.8fr));
  gap: 10px;
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid #dfd5c5;
  border-radius: 16px;
  background: rgba(255, 251, 244, 0.9);
}

.control-field {
  display: grid;
  gap: 6px;
}

.control-field input,
.control-field select {
  min-width: 0;
}

.governance-table-wrap {
  border-color: #ddd4c4;
  background: rgba(255, 252, 247, 0.74);
}

.governance-table {
  min-width: 860px;
}

.tool-state,
.contract-cell {
  display: grid;
  gap: 4px;
}

.tool-state small,
.contract-cell small {
  color: #6c7786;
  font-size: 12px;
}

.contract-cell strong {
  color: #18314d;
  font-size: 16px;
  line-height: 1.1;
}

.compact-actions {
  flex-wrap: nowrap;
}

.detail-stack {
  display: grid;
  gap: 12px;
}

.detail-badges {
  margin-bottom: 12px;
}

.detail-list-tight {
  gap: 10px;
}

.action-row {
  margin-top: 12px;
}

.detail-stat-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 12px;
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

@media (max-width: 1180px) {
  .governance-grid,
  .workbench-grid.wide-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .control-strip,
  .governance-signal-grid,
  .detail-stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
