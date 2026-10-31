<template>
  <div class="agent-editor">
    <header class="editor-title agent-object-header">
      <div>
        <h2>{{ agent.displayName || '未命名 Agent' }}</h2>
        <p>{{ agent.id || '新 Agent' }}</p>
      </div>
      <label class="v3-check object-enabled">
        <input v-model="agent.enabled" type="checkbox" />
        启用
      </label>
    </header>
    <dl class="editor-summary agent-object-summary">
      <div>
        <dt>当前模型</dt>
        <dd>{{ agent.llm.model || '尚未选择' }}</dd>
      </div>
      <div>
        <dt>LLM 连接</dt>
        <dd>{{ agent.llm.providerRef || '尚未绑定' }}</dd>
      </div>
      <div>
        <dt>资源装配</dt>
        <dd>
          {{ agent.skills.platformLibraries.length }} 个技能库，{{
            agent.memory.libraryIds.length
          }}
          个记忆库
        </dd>
      </div>
      <div>
        <dt>人格</dt>
        <dd>{{ selectedPersonaName }}</dd>
      </div>
    </dl>
    <EditorSectionTabs
      v-model="activeTab"
      :items="tabs"
      label="Agent 配置分区"
      :id-prefix="editorId"
    />
    <div
      v-show="activeTab === 'basics'"
      :id="`${editorId}-panel-basics`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-basics`"
      tabindex="0"
      class="agent-editor-panel"
    >
      <section class="editor-section">
        <h3>身份与指令</h3>
        <div class="v3-form-grid">
          <label>
            Agent ID
            <input
              v-model.trim="agent.id"
              required
              :readonly="persisted"
              pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
            />
          </label>
          <label>
            显示名称
            <input v-model.trim="agent.displayName" required />
          </label>
          <label class="v3-span-all">
            系统指令
            <textarea v-model="agent.instructions" rows="5" />
          </label>
          <label>
            Agent 类型
            <select v-model="agent.type" :aria-label="`${agent.id} Agent 类型`">
              <option v-for="option in typeOptions" :key="option.type" :value="option.type" :disabled="!option.available && option.type !== agent.type">
                {{ option.displayName }}{{ option.available ? '' : '（暂不可用）' }}
              </option>
            </select>
          </label>
          <div class="v3-span-all agent-preset-detail">
            <p v-if="selectedType" class="agent-preset-description">{{ selectedType.description }}</p>
            <small v-if="selectedType">引擎：{{ selectedType.engine }} · 支持协议：{{ selectedType.llmProtocols.join('、') }} · 工具注入：{{ selectedType.toolInjectionModes.join('、') }}</small>
            <button
              type="button"
              :disabled="!selectedType || selectedType.engine !== 'INTERNAL'"
              @click="applyTypeBudgets"
            >
              应用该类型的默认预算（{{ selectedType?.maxSteps ?? '—' }} 步 /
              {{ selectedType?.maxContextTokens ?? '—' }} 令牌）
            </button>
            <small>
              仅修改步数与上下文预算，不会改动提示词或工具配置。运行参数页可逐项调整。
            </small>
          </div>
        </div>
      </section>
      <section class="editor-section">
        <h3>LLM 与生成参数</h3>
        <div class="v3-form-grid">
          <label>
            LLM 连接
            <select v-model="agent.llm.providerRef" required>
              <option value="" disabled>选择连接</option>
              <option v-for="llm in document.llms" :key="llm.id" :value="llm.id">
                {{ llm.id }}{{ llm.enabled ? '' : '（已禁用）' }}
              </option>
            </select>
          </label>
          <label>
            模型
            <input v-model.trim="agent.llm.model" required placeholder="例如 gpt-4.1" />
          </label>
          <label v-if="!isCodex">
            Temperature
            <input
              v-model.number="agent.llm.generation.temperature"
              type="number"
              min="0"
              max="2"
              step="0.05"
            />
          </label>
          <label v-if="!isCodex">
            最大输出 Token（留空使用模型默认）
            <input
              :value="agent.llm.generation.maxOutputTokens ?? ''"
              @input="outputTokens"
              type="number"
              min="1"
              step="1"
            />
          </label>
        </div>
        <p v-if="isCodex" class="muted">CODEX 由原生引擎管理生成过程；此处仅选择模型和 Responses 连接，Temperature 与最大输出 Token 不生效。</p>
      </section>
    </div>
    <div
      v-show="activeTab === 'skills'"
      :id="`${editorId}-panel-skills`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-skills`"
      tabindex="0"
      class="agent-editor-panel"
    >
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>Skill 装配</h3>
            <p>
              已装配 {{ agent.skills.platformLibraries.length }} 个平台库，{{
                enabledLocalSources
              }}
              个本地来源已启用。
            </p>
          </div>
          <RouterLink to="/resources/skills" class="editor-resource-link">管理 Skill 库</RouterLink>
        </div>
        <p class="muted">每种来源独立开关和权限。平台库可以装配多个。</p>
        <div v-for="lib in document.skillLibraries" :key="lib.id" class="v3-toggle-row">
          <label class="v3-check">
            <input
              type="checkbox"
              :checked="!!mount(lib.id)"
              @change="toggleMount(lib.id, ($event.target as HTMLInputElement).checked)"
            />
            {{ lib.name }}
            <small>{{ lib.enabled ? lib.directory : '平台库已禁用' }}</small>
          </label>
          <div v-if="mount(lib.id)" class="toolbar">
            <label class="v3-check">
              <input
                :checked="mount(lib.id)!.enabled"
                type="checkbox"
                @change="mount(lib.id)!.enabled = ($event.target as HTMLInputElement).checked"
              />
              启用
            </label>
            <select
              :value="mount(lib.id)!.permissionGroup"
              :aria-label="`${lib.name} 权限`"
              @change="
                mount(lib.id)!.permissionGroup = ($event.target as HTMLSelectElement)
                  .value as PermissionGroup
              "
            >
              <option v-for="group in permissions" :key="group" :value="group">
                {{ permissionLabels[group] }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="!document.skillLibraries.length" class="muted">
          暂无平台 Skill 库，可前往平台资源创建。
        </p>
        <div
          v-for="source in ['configuration', 'temporary'] as const"
          :key="source"
          class="v3-toggle-row"
        >
          <label class="v3-check">
            <input v-model="agent.skills[source].enabled" type="checkbox" />
            {{ source === 'configuration' ? '配置目录 Skill' : '临时目录 Skill' }}
          </label>
          <select v-model="agent.skills[source].permissionGroup" :aria-label="`${source} 权限`">
            <option v-for="group in permissions" :key="group" :value="group">
              {{ permissionLabels[group] }}
            </option>
          </select>
        </div>
        <SkillBrowser kind="agents" :id="agent.id" :disabled="!persisted || dirty" />
      </section>
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>MCP 装配</h3>
            <p>已绑定 {{ agent.mcpServerIds.length }} 个服务。</p>
          </div>
          <RouterLink to="/resources/mcp" class="editor-resource-link">管理 MCP 服务</RouterLink>
        </div>
        <div class="v3-checks">
          <label v-for="server in document.mcpServers" :key="server.id">
            <input v-model="agent.mcpServerIds" type="checkbox" :value="server.id" />
            {{ server.id }} · {{ server.transport }}{{ server.enabled ? '' : '（已禁用）' }}
          </label>
        </div>
        <p v-if="!document.mcpServers.length" class="muted">暂无 MCP 服务，可前往平台资源创建。</p>
      </section>
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>工具策略</h3>
            <p>逐项设置当前 Agent 是否启用工具，以及调用者需要达到的最低身份。</p>
          </div>
          <RouterLink to="/resources/tools" class="editor-resource-link">查看平台工具</RouterLink>
        </div>
        <ToolPolicyEditor v-model="agent.toolPolicy" :platform-policy="document.toolPolicy" />
      </section>
    </div>
    <div
      v-show="activeTab === 'memory'"
      :id="`${editorId}-panel-memory`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-memory`"
      tabindex="0"
      class="agent-editor-panel"
    >
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>记忆库装配</h3>
            <p>已绑定 {{ agent.memory.libraryIds.length }} 个记忆库，选择其中一个作为写入目标。</p>
          </div>
          <RouterLink to="/resources/memories" class="editor-resource-link">管理记忆库</RouterLink>
        </div>
        <div class="v3-checks">
          <label v-for="lib in document.memoryLibraries" :key="lib.id">
            <input
              v-model="agent.memory.libraryIds"
              :value="lib.id"
              type="checkbox"
              @change="syncWriteLibrary"
            />
            {{ lib.name }}{{ lib.enabled ? '' : '（已禁用）' }}
          </label>
        </div>
        <p v-if="!document.memoryLibraries.length" class="muted">
          暂无记忆库；未装配时不注入库内记忆。
        </p>
        <div class="v3-form-grid">
          <label>
            记忆写入库
            <select v-model="agent.memory.writeLibraryId">
              <option :value="null">不写入记忆</option>
              <option
                v-for="lib in document.memoryLibraries.filter((item) =>
                  agent.memory.libraryIds.includes(item.id),
                )"
                :key="lib.id"
                :value="lib.id"
              >
                {{ lib.name }}
              </option>
            </select>
          </label>
          <label>
            最大注入条数
            <input v-model.number="agent.memory.maxInjected" type="number" min="0" />
          </label>
        </div>
        <h3>允许的记忆范围</h3>
        <div class="v3-checks">
          <label v-for="scope in scopes" :key="scope">
            <input v-model="agent.memory.allowedScopes" type="checkbox" :value="scope" />
            {{ scope }}
          </label>
        </div>
      </section>
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>人格预设</h3>
            <p>单选一个人格，为当前 Agent 提供语气、行为边界和对话风格。</p>
          </div>
          <RouterLink to="/resources/personas" class="editor-resource-link">管理人格库</RouterLink>
        </div>
        <div class="v3-form-grid">
          <label>
            人格预设
            <select v-model="agent.personaId">
              <option :value="null">不绑定人格</option>
              <option v-for="persona in personas" :key="persona.id" :value="persona.id">
                {{ persona.name }}{{ persona.enabled ? '' : '（已禁用）' }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="personaError" class="notice error" role="alert">{{ personaError }}</p>
      </section>
    </div>
    <div
      v-show="activeTab === 'runtime'"
      :id="`${editorId}-panel-runtime`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-runtime`"
      tabindex="0"
      class="agent-editor-panel"
    >
      <section class="editor-section">
        <h3>运行目录</h3>
        <p class="muted">配置与临时产物分开保存；相对路径按配置文件所在目录解析。</p>
        <div class="v3-form-grid">
          <label>
            配置目录
            <input v-model.trim="agent.configDirectory" required />
            <small>存放持久化 Agent 配置与技能。</small>
          </label>
          <label>
            临时目录
            <input v-model.trim="agent.tempDirectory" required />
            <small>存放本次运行产物与临时技能。</small>
          </label>
        </div>
      </section>
      <section class="editor-section">
        <h3>上下文与执行</h3>
        <p v-if="isCodex" class="muted">CODEX 自行管理上下文和执行步数，整回合安全上限为 180 秒。人格示例预算和桥接工具的单次超时仍然生效。</p>
        <button v-if="isCodex && hasInertCodexOverrides" type="button" @click="resetInertCodexSettings">清除 CODEX 无效字段的旧配置</button>
        <div class="v3-form-grid">
          <label v-if="!isCodex">
            压缩策略
            <select v-model="agent.context.compression.strategy">
              <option v-for="value in strategyOptions" :key="value" :value="value">
                {{ compressionStrategyLabels[value] ?? value }}
              </option>
            </select>
          </label>
          <label>
            人格示例 Token 预算
            <input v-model.number="agent.context.personaExampleTokens" type="number" min="0" />
          </label>
          <label v-if="!isCodex">
            保留轮数
            <input v-model.number="agent.context.compression.maxRounds" type="number" min="1" />
          </label>
          <label v-if="!isCodex">
            上下文 Token
            <input v-model.number="agent.context.compression.maxTokens" type="number" min="1" />
          </label>
          <label v-if="!isCodex">
            最大执行步数
            <input v-model.number="agent.execution.maxSteps" type="number" min="1" />
          </label>
          <label>
            工具超时（毫秒）
            <input v-model.number="agent.execution.toolTimeoutMillis" type="number" min="1" />
          </label>
          <label v-for="(label, key) in toolResultLabels" v-show="!isCodex" :key="key">
            {{ label }}
            <input v-model.number="agent.context.toolResults[key]" type="number" min="1" />
          </label>
        </div>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue';
import { RouterLink } from 'vue-router';
import { dashboardApi, type Persona } from '../../api/dashboard';
import {
  compressionStrategyLabels,
  newAgent,
  permissions,
  permissionLabels,
  scopes,
  type PermissionGroup,
  type AgentTypeView,
  type AgentProfile,
  type ApplicationConfig,
} from '../../models/configV3';
import ToolPolicyEditor from './ToolPolicyEditor.vue';
import SkillBrowser from './SkillBrowser.vue';
import EditorSectionTabs from './EditorSectionTabs.vue';
const props = defineProps<{
  agent: AgentProfile;
  document: ApplicationConfig;
  /** Type roster reported by the runtime; empty when it could not be fetched. */
  agentTypes: AgentTypeView[];
  /** Accepted compression strategy values reported by the runtime; empty when it could not be fetched. */
  strategies: string[];
  persisted: boolean;
  dirty: boolean;
}>();
const editorId = `agent-editor-${useId()}`;
const selectedType = computed(() => props.agentTypes.find((item) => item.type === props.agent.type));
const isCodex = computed(() => props.agent.type === 'CODEX');
const inertCodexDefaults = computed(() => newAgent(props.agent.id, props.agent.llm.providerRef, selectedType.value));
const hasInertCodexOverrides = computed(() => {
  if (!isCodex.value) return false;
  const actual = props.agent;
  const defaults = inertCodexDefaults.value;
  return actual.execution.maxSteps !== defaults.execution.maxSteps ||
    actual.context.compression.strategy !== defaults.context.compression.strategy ||
    actual.context.compression.maxRounds !== defaults.context.compression.maxRounds ||
    actual.context.compression.maxTokens !== defaults.context.compression.maxTokens ||
    Object.keys(defaults.context.toolResults).some((key) =>
      actual.context.toolResults[key as keyof typeof defaults.context.toolResults] !==
      defaults.context.toolResults[key as keyof typeof defaults.context.toolResults]) ||
    actual.llm.generation.temperature !== defaults.llm.generation.temperature ||
    actual.llm.generation.maxOutputTokens !== defaults.llm.generation.maxOutputTokens;
});
function resetInertCodexSettings() {
  const defaults = inertCodexDefaults.value;
  props.agent.execution.maxSteps = defaults.execution.maxSteps;
  props.agent.context.compression = defaults.context.compression;
  props.agent.context.toolResults = defaults.context.toolResults;
  props.agent.llm.generation = defaults.llm.generation;
}
/**
 * Keeps the current value selectable even when the roster is unavailable or does not know it.
 */
const typeOptions = computed(() => {
  if (selectedType.value) return props.agentTypes;
  return [...props.agentTypes, {
    type: props.agent.type,
    displayName: props.agent.type,
    description: '',
    engine: 'INTERNAL' as const,
    llmProtocols: [],
    toolInjectionModes: [],
    available: false,
    maxSteps: props.agent.execution.maxSteps,
    maxContextTokens: props.agent.context.compression.maxTokens,
    maxRounds: props.agent.context.compression.maxRounds,
  }];
});
/**
 * Values come from the server contract; only the labels are local. The Agent's current value is always
 * kept selectable, so a value the server did not list stays visible instead of silently changing.
 */
const strategyOptions = computed(() => {
  const values = props.strategies.length ? props.strategies : ['token_window', 'round_truncation'];
  const current = props.agent.context.compression.strategy;
  return values.includes(current) ? values : [...values, current];
});
/** Explicit, because silently overwriting the operator's budgets on a dropdown change is worse. */
function applyTypeBudgets() {
  const type = selectedType.value;
  if (!type || type.engine !== 'INTERNAL') return;
  props.agent.execution.maxSteps = type.maxSteps;
  props.agent.context.compression.maxTokens = type.maxContextTokens;
  props.agent.context.compression.maxRounds = type.maxRounds;
}
const activeTab = ref('basics');
const tabs = [
  { id: 'basics', label: '基础配置' },
  { id: 'skills', label: '技能与工具' },
  { id: 'memory', label: '记忆与人格' },
  { id: 'runtime', label: '运行参数' },
];
const personas = ref<Persona[]>([]);
const selectedPersonaName = computed(() =>
  props.agent.personaId
    ? personas.value.find((persona) => persona.id === props.agent.personaId)?.name || '已绑定人格'
    : '未绑定',
);
const enabledLocalSources = computed(
  () =>
    Number(props.agent.skills.configuration.enabled) + Number(props.agent.skills.temporary.enabled),
);
const personaError = ref('');
const toolResultLabels = {
  inlineTokens: '工具结果内联 Token',
  previewTokens: '工具结果预览 Token',
  ttlSeconds: '工具结果保留秒数',
  maxBytes: '单条工具结果最大字节',
  storeMaxBytes: '结果存储最大字节',
};
function mount(id: string) {
  return props.agent.skills.platformLibraries.find((item) => item.libraryId === id);
}
function toggleMount(id: string, enabled: boolean) {
  if (enabled)
    props.agent.skills.platformLibraries.push({
      libraryId: id,
      enabled: true,
      permissionGroup: 'OPERATOR',
    });
  else
    props.agent.skills.platformLibraries = props.agent.skills.platformLibraries.filter(
      (item) => item.libraryId !== id,
    );
}
function syncWriteLibrary() {
  if (
    props.agent.memory.writeLibraryId &&
    !props.agent.memory.libraryIds.includes(props.agent.memory.writeLibraryId)
  )
    props.agent.memory.writeLibraryId = null;
}
function outputTokens(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  props.agent.llm.generation.maxOutputTokens = value === '' ? null : Number(value);
}
onMounted(async () => {
  try {
    personas.value = (await dashboardApi.personas('platform')).personas;
  } catch (cause) {
    personaError.value = `人格列表读取失败：${String(cause)}`;
  }
});
</script>

<style scoped>
.agent-editor {
  min-width: 0;
}
.agent-object-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.agent-object-header h2 {
  margin: 0;
}
.agent-object-header p {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
}
.object-enabled {
  flex-shrink: 0;
}
.agent-object-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
.agent-object-summary div {
  min-width: 0;
}
.agent-object-summary dt {
  margin-bottom: 6px;
}
.agent-object-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.agent-editor-panel {
  min-width: 0;
  padding-top: 20px;
}
.editor-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.editor-section-heading h3 {
  margin: 0;
}
.editor-section-heading p {
  margin: 7px 0 0;
  max-width: 58ch;
}
.editor-resource-link {
  flex-shrink: 0;
}
@media (max-width: 1000px) {
  .agent-object-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .agent-object-summary {
    gap: 18px 12px;
  }
  .editor-section-heading {
    flex-direction: column;
    gap: 10px;
  }
}
</style>
