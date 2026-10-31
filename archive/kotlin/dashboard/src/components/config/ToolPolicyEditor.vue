<template>
  <div class="v3-stack">
    <p class="muted">
      {{ platformPolicy
        ? '仅可使用平台已开启的工具。关闭某一项只影响当前 Agent。'
        : '默认值仅用于首次初始化。这里显示已保存的开关，之后由你决定是否开启。' }}
    </p>
    <input v-model="query" type="search" aria-label="搜索工具" placeholder="搜索工具名称或说明" />
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="muted" role="status">正在读取工具目录…</p>
    <p v-else-if="!initialized" class="notice">工具开关尚未初始化，请重新读取配置。</p>
    <template v-else>
      <div class="tool-count muted">{{ enabledCount }} / {{ toolOptions.length }} 个工具已开启</div>
      <div v-if="filteredTools.length" class="v3-tool-list">
        <label v-for="tool in filteredTools" :key="tool.name" class="v3-toggle-row">
          <span>
            <strong>{{ tool.name }}</strong>
            <small>{{ tool.description }}</small>
            <small v-if="platformPolicy && !platformEnabled(tool.name)" class="tool-blocked">平台已关闭，请先在平台工具中开启。</small>
          </span>
          <span class="tool-switch">
            <input
              type="checkbox"
              role="switch"
              :aria-label="`${tool.name} 开启`"
              :checked="enabled(tool.name)"
              :disabled="!!platformPolicy && !platformEnabled(tool.name)"
              @change="setEnabled(tool.name, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ enabled(tool.name) ? '开启' : '关闭' }}</span>
          </span>
          <span v-if="platformPolicy" class="tool-permission">
            <span>最低身份</span>
            <select
              :aria-label="`${tool.name} 最低身份`"
              :value="minimumPermission(tool)"
              :disabled="!platformEnabled(tool.name)"
              @change="setMinimumPermission(tool, ($event.target as HTMLSelectElement).value as PermissionGroup)"
            >
              <option v-for="group in selectableGroups(tool)" :key="group" :value="group">
                {{ permissionLabels[group] }}
              </option>
            </select>
          </span>
        </label>
      </div>
      <p v-else class="muted">没有匹配的工具，请调整搜索内容。</p>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { dashboardApi, type ToolDto } from '../../api/dashboard';
import { permissionLabels, type PermissionGroup, type ToolPolicy } from '../../models/configV3';
import { isToolEnabled, permissionRank, setToolEnabled, setToolMinimumPermission, toolMinimumPermission } from '../../models/toolPolicy';
const props = defineProps<{ modelValue: ToolPolicy; platformPolicy?: ToolPolicy }>();
const tools = ref<ToolDto[]>([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const initialized = computed(() => (props.platformPolicy ?? props.modelValue).enabled != null);
// Persisted platform/IM/MCP entries remain editable even when absent from the global catalog.
const toolOptions = computed(() => {
  const known = new Set(tools.value.map(tool => tool.name));
  const extras = Object.keys((props.platformPolicy ?? props.modelValue).enabled ?? {})
    .filter(name => !known.has(name)).sort()
    .map(name => ({ name, description: '平台或扩展工具；实际可用性取决于当前 IM 和已装配的 MCP 服务。', requiredPermissionGroup: 'OPERATOR' as PermissionGroup }));
  return [...tools.value, ...extras];
});
const filteredTools = computed(() => {
  const search = query.value.trim().toLowerCase();
  return toolOptions.value.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(search));
});
const platformEnabled = (name: string) => isToolEnabled(name, props.platformPolicy ?? props.modelValue);
const enabled = (name: string) => isToolEnabled(name, props.modelValue, props.platformPolicy);
const enabledCount = computed(() => toolOptions.value.filter(tool => enabled(tool.name)).length);
const minimumPermission = (tool: Pick<ToolDto, 'name' | 'requiredPermissionGroup'>) =>
  toolMinimumPermission(tool.name, props.modelValue, tool.requiredPermissionGroup);
const selectableGroups = (tool: Pick<ToolDto, 'requiredPermissionGroup'>) =>
  (['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] as PermissionGroup[]).filter(group => permissionRank(group) >= permissionRank(tool.requiredPermissionGroup));
function setEnabled(name: string, value: boolean) {
  if (props.platformPolicy && !platformEnabled(name)) return;
  setToolEnabled(props.modelValue, name, value);
}
function setMinimumPermission(tool: Pick<ToolDto, 'name' | 'requiredPermissionGroup'>, value: PermissionGroup) {
  setToolMinimumPermission(props.modelValue, tool.name, value, tool.requiredPermissionGroup);
}
onMounted(async () => {
  try { tools.value = (await dashboardApi.tools()).filter(tool => tool.source === 'BUILTIN'); }
  catch (cause) { error.value = `工具目录读取失败：${String(cause)}`; }
  finally { loading.value = false; }
});
</script>
<style scoped>
.tool-count { font-size: 12px; }
.tool-switch { display: flex; flex-direction: row; align-items: center; gap: 8px; flex-shrink: 0; font-size: 12px; min-width: 64px; }
.tool-permission { display: flex; align-items: center; gap: 7px; flex-shrink: 0; color: var(--muted); font-size: 12px; font-weight: 400; }
.tool-permission select { min-height: 32px; padding: 4px 7px; font-size: 12px; }
.v3-toggle-row > .tool-switch { display: flex; }
.tool-blocked { color: var(--warning); }
input[role=switch] { cursor: pointer; }
input[role=switch]:disabled { cursor: not-allowed; }
@media (max-width: 720px) { .v3-toggle-row { align-items: flex-start; } .tool-switch, .tool-permission { margin-top: 6px; } }
</style>
