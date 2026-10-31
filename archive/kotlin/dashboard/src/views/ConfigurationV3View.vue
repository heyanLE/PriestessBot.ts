<template>
  <ConfigFrame :title="pageTitle" :description="pageDescription">
    <template v-if="document">
      <RuntimeEditor v-if="section === 'system'" :document="document" />
      <section v-else-if="section === 'tools'" class="panel">
        <h2>内置工具</h2>
        <p class="muted">开启后可供 Agent 使用；关闭后，所有 Agent 均不可调用。</p>
        <ToolPolicyEditor v-model="document.toolPolicy" />
      </section>
      <div v-else class="v3-registry-layout">
        <aside class="panel v3-registry">
          <div class="section-title">
            <h2>{{ pageTitle }}<span class="registry-count">{{ entities.length }}</span></h2>
            <button type="button" class="primary" @click="create">新增</button>
          </div>
          <input
            v-model="query"
            type="search"
            :placeholder="`搜索${pageTitle}`"
            :aria-label="`搜索${pageTitle}`"
          />
          <div class="v3-entity-list">
            <button
              v-for="entry in entries"
              :key="entry.index"
              type="button"
              :class="{ selected: selectedIndex === entry.index }"
              :aria-pressed="selectedIndex === entry.index"
              @click="selectedIndex = entry.index"
            >
              <strong>{{ entry.name }}</strong>
              <span v-if="entry.name !== entry.id">{{ entry.id }}</span>
              <span class="entity-meta"><small class="entity-state" :class="{ enabled: entry.enabled }">{{ entry.enabled ? '已启用' : '已禁用' }}</small><small>{{ entry.kind }}</small></span>
            </button>
          </div>
          <p v-if="!entries.length" class="muted">没有匹配的记录。点击新增开始配置。</p>
        </aside>
        <div class="v3-stack" v-if="selectedEntity">
          <div class="v3-selection-bar">
            <span class="chip">{{ persisted ? '已保存实体' : '新增实体' }}</span>
            <button type="button" class="danger" @click="remove">
              删除 {{ selectedEntity.id }}
            </button>
          </div>
          <AgentEditor
            :key="`agent-${selectedIndex}`"
            v-if="section === 'agents' && selectedAgent"
            :agent="selectedAgent"
            :document="document"
            :agent-types="store.agentTypes"
            :strategies="store.compressionStrategies"
            :persisted="persisted"
            :dirty="store.dirty"
          />
          <ImEditor
            :key="`im-${selectedIndex}`"
            v-if="section === 'ims' && selectedIm"
            :im="selectedIm"
            :agents="document.agents"
            :agent-types="store.agentTypes"
            :persisted="persisted"
            :dirty="store.dirty"
          />
          <section v-if="section === 'llms' && selectedLlm" class="panel">
            <h2>LLM 连接</h2>
            <p class="muted">连接只声明服务与凭据。模型名称及生成参数在 Agent 中配置。</p>
            <div class="v3-form-grid">
              <label>
                ID
                <input v-model.trim="selectedLlm.id" :readonly="persisted" required />
              </label>
              <label>
                服务类型
                <input v-model.trim="selectedLlm.type" list="provider-types" required />
                <datalist id="provider-types">
                  <option value="openai" />
                  <option value="anthropic" />
                  <option value="gemini" />
                  <option value="ollama" />
                </datalist>
              </label>
              <label class="v3-span-all">
                API 地址
                <input
                  v-model.trim="selectedLlm.endpoint"
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                请求协议
                <select
                  :value="selectedLlm.protocol ?? ''"
                  @change="selectedLlm.protocol = ($event.target as HTMLSelectElement).value || null"
                >
                  <option value="">默认（{{ store.providerProtocols.find(item => item.providerType === selectedLlm?.type)?.defaultProtocol || '由服务决定' }}）</option>
                  <option
                    v-for="protocol in store.providerProtocols.find(item => item.providerType === selectedLlm?.type)?.protocols || []"
                    :key="protocol"
                    :value="protocol"
                  >{{ protocol }}</option>
                  <option
                    v-if="selectedLlm.protocol && !store.providerProtocols.find(item => item.providerType === selectedLlm?.type)?.protocols.includes(selectedLlm.protocol)"
                    :value="selectedLlm.protocol"
                  >{{ selectedLlm.protocol }}（当前值）</option>
                </select>
              </label>
              <label>
                API Key 环境变量
                <input
                  :value="selectedLlm.credentialRef?.key || ''"
                  @input="setLlmCredential(($event.target as HTMLInputElement).value)"
                  placeholder="OPENAI_API_KEY"
                />
              </label>
              <label class="v3-check">
                <input v-model="selectedLlm.enabled" type="checkbox" />
                启用连接
              </label>
            </div>
            <h3>连接参数</h3>
            <KeyValueEditor v-model="selectedLlm.settings" />
          </section>
          <section v-if="section === 'skills' && selectedSkill" class="panel">
            <h2>平台 Skill 库</h2>
            <div class="v3-form-grid">
              <label>
                ID
                <input v-model.trim="selectedSkill.id" :readonly="persisted" required />
              </label>
              <label>
                名称
                <input v-model.trim="selectedSkill.name" required />
              </label>
              <label class="v3-span-all">
                库目录
                <input v-model.trim="selectedSkill.directory" required />
                <small>相对路径以平台目录为根，每个技能存放在自己的目录中。</small>
              </label>
              <label class="v3-check">
                <input v-model="selectedSkill.enabled" type="checkbox" />
                启用技能库
              </label>
            </div>
            <SkillBrowser
              :key="`skill-${selectedIndex}`"
              kind="skill-libraries"
              :id="selectedSkill.id"
              :disabled="!persisted || store.dirty"
            />
          </section>
          <section v-if="section === 'memories' && selectedMemory" class="panel">
            <h2>平台记忆库</h2>
            <div class="v3-form-grid">
              <label>
                ID
                <input v-model.trim="selectedMemory.id" :readonly="persisted" required />
              </label>
              <label>
                名称
                <input v-model.trim="selectedMemory.name" required />
              </label>
              <label class="v3-span-all">
                说明
                <textarea v-model="selectedMemory.description" rows="3" />
              </label>
              <label class="v3-check">
                <input v-model="selectedMemory.enabled" type="checkbox" />
                启用记忆库
              </label>
            </div>
            <MemoryLibraryBrowser
              :key="`memory-${selectedIndex}`"
              :id="selectedMemory.id"
              :disabled="!persisted || store.dirty"
            />
          </section>
          <section v-if="section === 'mcp' && selectedMcp" class="panel">
            <h2>MCP 服务</h2>
            <div class="v3-form-grid">
              <label>
                ID
                <input v-model.trim="selectedMcp.id" :readonly="persisted" required />
              </label>
              <label>
                传输方式
                <select v-model="selectedMcp.transport">
                  <option value="stdio">标准输入输出</option>
                  <option value="sse">SSE</option>
                  <option value="streamable_http">Streamable HTTP</option>
                </select>
              </label>
              <label class="v3-check">
                <input v-model="selectedMcp.enabled" type="checkbox" />
                启用服务
              </label>
              <label class="v3-check">
                <input v-model="selectedMcp.required" type="checkbox" />
                启动失败时阻止装配
              </label>
              <template v-if="selectedMcp.transport === 'stdio'">
                <label>
                  启动命令
                  <input v-model="selectedMcp.command" required />
                </label>
                <label>
                  启动参数（每行一项）
                  <StringList v-model="selectedMcp.args" label="MCP 启动参数" />
                </label>
              </template>
              <label v-else class="v3-span-all">
                服务地址
                <input v-model.trim="selectedMcp.url" required type="url" />
              </label>
            </div>
            <h3>凭据环境变量</h3>
            <CredentialMapEditor v-model="selectedMcp.credentialRefs" />
            <h3>服务参数</h3>
            <KeyValueEditor v-model="selectedMcp.settings" />
          </section>
        </div>
        <section v-else class="panel">
          <h2>选择或新增{{ pageTitle }}</h2>
          <p class="muted">在左侧选择实体，再编辑其配置。修改将作为一个版本统一预览和保存。</p>
        </section>
      </div>
    </template>
  </ConfigFrame>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useConfigV3Store } from '../stores/configV3';
import { defaultGroupContext, defaultRoutes, newAgent, uniqueId, type ApplicationConfig } from '../models/configV3';
import ConfigFrame from '../components/config/ConfigFrame.vue';
import AgentEditor from '../components/config/AgentEditor.vue';
import ImEditor from '../components/config/ImEditor.vue';
import RuntimeEditor from '../components/config/RuntimeEditor.vue';
import ToolPolicyEditor from '../components/config/ToolPolicyEditor.vue';
import KeyValueEditor from '../components/config/KeyValueEditor.vue';
import CredentialMapEditor from '../components/config/CredentialMapEditor.vue';
import StringList from '../components/config/StringList.vue';
import SkillBrowser from '../components/config/SkillBrowser.vue';
import MemoryLibraryBrowser from '../components/config/MemoryLibraryBrowser.vue';
type Section = 'system' | 'agents' | 'ims' | 'llms' | 'skills' | 'memories' | 'mcp' | 'tools';
const props = defineProps<{ section: Section }>();
const store = useConfigV3Store();
const document = computed(() => store.document);
const selectedIndex = ref(0);
const query = ref('');
const newEntities = new WeakSet<object>();
const labels: Record<Section, string> = {
  system: '系统设置',
  agents: 'Agent',
  ims: 'IM 与路由',
  llms: 'LLM 连接',
  skills: 'Skill 库',
  memories: '记忆库',
  mcp: 'MCP 服务',
  tools: '工具',
};
const pageTitle = computed(() => labels[props.section]);
const pageDescription = computed(() =>
  props.section === 'system'
    ? '管理服务、目录、权限和运行设置。'
    : '集中配置平台资源，按需装配到独立 Agent。所有修改经过预览与版本校验。',
);
const collectionKeys: Partial<
  Record<Section, 'agents' | 'ims' | 'llms' | 'skillLibraries' | 'memoryLibraries' | 'mcpServers'>
> = {
  agents: 'agents',
  ims: 'ims',
  llms: 'llms',
  skills: 'skillLibraries',
  memories: 'memoryLibraries',
  mcp: 'mcpServers',
};
const collectionKey = computed(() => collectionKeys[props.section]);
const entities = computed(() => {
  const key = collectionKey.value;
  return document.value && key ? document.value[key] : [];
});
const entries = computed(() =>
  entities.value
    .map((entity, index) => ({
      id: entity.id,
      name:
        'displayName' in entity ? entity.displayName : 'name' in entity ? entity.name : entity.id,
      enabled: entity.enabled,
      kind: 'routes' in entity ? `${entity.routes.length} 条路由` : 'llm' in entity ? entity.llm.model : 'type' in entity ? entity.type : '',
      index,
    }))
    .filter((entry) =>
      `${entry.id} ${entry.name}`.toLowerCase().includes(query.value.toLowerCase()),
    ),
);
const selectedEntity = computed(() => entities.value[selectedIndex.value]);
const persisted = computed(() => {
  if (
    !selectedEntity.value ||
    newEntities.has(selectedEntity.value) ||
    !collectionKey.value ||
    !store.baseline
  )
    return false;
  const saved = JSON.parse(store.baseline) as ApplicationConfig;
  return saved[collectionKey.value].some((item) => item.id === selectedEntity.value?.id);
});
watch(
  () => props.section,
  () => {
    selectedIndex.value = 0;
    query.value = '';
  },
);
const selectedAgent = computed(() => document.value?.agents[selectedIndex.value]);
const selectedIm = computed(() => document.value?.ims[selectedIndex.value]);
const selectedLlm = computed(() => document.value?.llms[selectedIndex.value]);
const selectedSkill = computed(() => document.value?.skillLibraries[selectedIndex.value]);
const selectedMemory = computed(() => document.value?.memoryLibraries[selectedIndex.value]);
const selectedMcp = computed(() => document.value?.mcpServers[selectedIndex.value]);
function create() {
  const doc = document.value;
  if (!doc) return;
  const id = uniqueId(props.section === 'agents' ? 'agent' : props.section, entities.value);
  switch (props.section) {
    case 'agents':
      // The chat type is first in the server roster; other types bring their own budgets.
      doc.agents.push(newAgent(id, doc.llms[0]?.id, store.agentTypes[0]));
      break;
    case 'ims':
      doc.ims.push({
        id,
        name: id,
        type: 'napcat4_18_6',
        enabled: true,
        credentialRefs: {},
        settings: { host: '127.0.0.1', port: '3000', wsPort: '3001' },
        permission: { adminIds: [], superAdminIds: [] },
        routes: defaultRoutes(doc.agents[0]?.id || null),
        groupContext: defaultGroupContext(),
      });
      break;
    case 'llms':
      doc.llms.push({
        id,
        type: 'openai',
        enabled: true,
        endpoint: 'https://api.openai.com/v1',
        protocol: null,
        credentialRef: null,
        settings: {},
      });
      break;
    case 'skills':
      doc.skillLibraries.push({ id, name: id, directory: `skills/${id}`, enabled: true });
      break;
    case 'memories':
      doc.memoryLibraries.push({ id, name: id, description: '', enabled: true });
      break;
    case 'mcp':
      doc.mcpServers.push({
        id,
        enabled: true,
        required: true,
        transport: 'stdio',
        command: '',
        args: [],
        url: '',
        credentialRefs: {},
        settings: {},
      });
      break;
  }
  selectedIndex.value = entities.value.length - 1;
  if (selectedEntity.value) newEntities.add(selectedEntity.value);
  query.value = '';
}
function remove() {
  if (
    !selectedEntity.value ||
    !window.confirm(`删除 ${selectedEntity.value.id}？已有引用需要一并修正，应用修订后才会生效。`)
  )
    return;
  entities.value.splice(selectedIndex.value, 1);
  selectedIndex.value = Math.max(0, selectedIndex.value - 1);
}
function setLlmCredential(value: string) {
  if (selectedLlm.value)
    selectedLlm.value.credentialRef = value.trim()
      ? { source: 'ENVIRONMENT', key: value.trim() }
      : null;
}
</script>
