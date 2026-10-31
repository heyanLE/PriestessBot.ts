<template>
  <div class="memory-command">
    <section class="panel memory-hero">
      <div class="memory-hero-grid">
        <div class="memory-copy">
          <div class="memory-band">
            <span>资源</span>
            <span>工作区 {{ workspaceId }}</span>
          </div>

          <h2>人格与记忆配置</h2>
          <p>
            统一管理人格预设和记忆记录，编辑时可随时查看注入风格、记忆范围和搜索相关性。
          </p>

          <div class="grid memory-signal-grid">
            <article v-for="signal in memorySignals" :key="signal.label" class="card memory-signal" :class="`tone-${signal.tone}`">
              <span>{{ signal.label }}</span>
              <strong>{{ signal.value }}</strong>
              <p>{{ signal.detail }}</p>
            </article>
          </div>
        </div>

        <aside class="memory-rail">
          <article class="card memory-rail-card">
            <div class="section-title compact">
              <div>
                <h3>检查重点</h3>
                <p>人格风格和记忆范围应清晰、可控且便于测试。</p>
              </div>
            </div>

            <div class="rail-list">
              <div class="rail-item">
                <span>当前工作区</span>
                <strong>{{ workspaceId }}</strong>
              </div>
              <div class="rail-item">
                <span>已选人格预设</span>
                <strong>{{ selectedPersona?.name ?? '无' }}</strong>
              </div>
              <div class="rail-item">
                <span>已选记忆</span>
                <strong>{{ selectedMemory ? memoryTypeLabel(selectedMemory.type) : '无' }}</strong>
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
            <h2>人格预设列表</h2>
            <p>工作区 {{ workspaceId }} 中显示 {{ filteredPersonas.length }} 条人格预设。</p>
          </div>
          <div class="toolbar">
            <input v-model="workspaceId" type="search" aria-label="工作区 ID" placeholder="工作区 ID" />
            <input v-model="personaQuery" type="search" aria-label="搜索人格预设" placeholder="搜索人格预设" />
            <button type="button" @click="loadAll" :disabled="loading">刷新</button>
          </div>
        </div>

        <p v-if="notice" class="notice ok">{{ notice }}</p>
        <p v-if="error" class="notice error">{{ error }}</p>

        <EmptyState
          v-if="filteredPersonas.length === 0"
          title="暂无人格预设"
          detail="请创建人格预设，或调整工作区和搜索条件。"
        />

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>智能体</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="persona in filteredPersonas"
                :key="persona.id"
                class="clickable-row"
                :class="{ selected: selectedPersonaId === persona.id }"
                @click="selectPersona(persona)"
              >
                <td>
                  <strong>{{ persona.name }}</strong>
                  <p class="muted">{{ persona.description || persona.id }}</p>
                </td>
                <td>
                  <span class="inline-status" :class="{ ok: persona.enabled, muted: !persona.enabled }">
                    {{ persona.enabled ? '已启用' : '已禁用' }}
                  </span>
                </td>
                <td>{{ persona.agentNames.length || '全部' }}</td>
                <td>{{ formatTime(persona.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <form class="stacked-form persona-form" @submit.prevent="savePersona">
          <div class="section-title compact">
            <div>
              <h2>{{ personaDraft.id ? '编辑人格预设' : '创建人格预设' }}</h2>
              <p>配置人格作用范围、语气、边界和注入提示词。</p>
            </div>
            <button type="button" @click="resetPersonaDraft">新建</button>
          </div>
          <div class="form-grid">
            <label>
              <span>名称</span>
              <input v-model="personaDraft.name" required />
            </label>
            <label>
              <span>智能体</span>
              <input v-model="personaAgentsText" placeholder="用逗号分隔；留空表示全部" />
            </label>
            <label>
              <span>描述</span>
              <input v-model="personaDraft.description" />
            </label>
            <label>
              <span>语气</span>
              <input v-model="personaDraft.tone" />
            </label>
            <label class="full-span">
              <span>行为边界</span>
              <input v-model="personaBoundariesText" placeholder="用逗号分隔多个边界" />
            </label>
            <label class="full-span">
              <span>系统提示词模板</span>
              <textarea v-model="personaDraft.systemPromptTemplate" class="compact-textarea"></textarea>
            </label>
            <div class="full-span example-dialog-editor">
              <div class="example-dialog-heading">
                <div>
                  <span>示例对话</span>
                  <p>少样本示例会以用户/智能体消息的形式放在真实历史之前，不会写入聊天记录。</p>
                </div>
                <button type="button" :disabled="personaDraft.exampleDialogs.length >= 20" @click="addExampleDialog">
                  添加示例
                </button>
              </div>
              <p v-if="personaDraft.exampleDialogs.length === 0" class="muted">尚未配置示例。</p>
              <article
                v-for="(dialog, index) in personaDraft.exampleDialogs"
                :key="index"
                class="example-dialog-card"
              >
                <div class="example-dialog-title">
                  <strong>示例 {{ index + 1 }}</strong>
                  <div class="toolbar compact-actions">
                    <button type="button" :disabled="index === 0" :aria-label="`上移示例 ${index + 1}`" @click="moveExampleDialog(index, -1)">↑</button>
                    <button type="button" :disabled="index === personaDraft.exampleDialogs.length - 1" :aria-label="`下移示例 ${index + 1}`" @click="moveExampleDialog(index, 1)">↓</button>
                    <button type="button" :aria-label="`移除示例 ${index + 1}`" @click="removeExampleDialog(index)">移除</button>
                  </div>
                </div>
                <label>
                  <span>用户</span>
                  <textarea v-model="dialog.user" class="compact-textarea" maxlength="8000" required></textarea>
                </label>
                <label>
                  <span>智能体</span>
                  <textarea v-model="dialog.assistant" class="compact-textarea" maxlength="8000" required></textarea>
                </label>
              </article>
            </div>
          </div>
          <div class="toolbar">
            <label class="check-row">
              <input v-model="personaDraft.enabled" type="checkbox" />
              <span>启用</span>
            </label>
            <button type="submit" class="primary" :disabled="savingPersona || personaDraft.name.trim().length === 0">
              {{ savingPersona ? '保存中' : '保存人格预设' }}
            </button>
            <button v-if="personaDraft.id" type="button" @click="deleteSelectedPersona" :disabled="savingPersona">删除</button>
          </div>
        </form>
      </section>

      <aside class="panel detail-panel detail-rail">
        <div class="section-title">
          <div>
            <h2>{{ selectedPersona?.name ?? '人格预设详情' }}</h2>
            <p>{{ selectedPersona ? selectedPersona.id : '请选择人格预设以检查注入内容。' }}</p>
          </div>
        </div>

        <EmptyState
          v-if="!selectedPersona"
          title="未选择人格预设"
          detail="请选择记录以检查语气、边界和适用智能体。"
        />

        <div v-else class="detail-stack">
          <article class="card memory-rail-card">
            <div class="detail-list">
              <div class="detail-item">
                <span>工作区</span>
                <strong>{{ selectedPersona.workspaceId }}</strong>
              </div>
              <div class="detail-item">
                <span>语气</span>
                <strong>{{ selectedPersona.tone || '未设置' }}</strong>
              </div>
              <div class="detail-item">
                <span>智能体</span>
                <div class="chip-row">
                  <span v-for="agent in selectedPersona.agentNames" :key="agent" class="chip">{{ agent }}</span>
                  <span v-if="selectedPersona.agentNames.length === 0" class="muted">全部智能体</span>
                </div>
              </div>
              <div class="detail-item">
                <span>行为边界</span>
                <div class="chip-row">
                  <span v-for="boundary in selectedPersona.boundaries" :key="boundary" class="chip">{{ boundary }}</span>
                  <span v-if="selectedPersona.boundaries.length === 0" class="muted">无</span>
                </div>
              </div>
              <div class="detail-item">
                <span>提示词</span>
                <pre class="code-block">{{ selectedPersona.systemPromptTemplate || '未配置模板。' }}</pre>
              </div>
              <div class="detail-item">
                <span>示例对话</span>
                <div v-if="selectedPersona.exampleDialogs.length" class="example-dialog-preview">
                  <div v-for="(dialog, index) in selectedPersona.exampleDialogs" :key="index">
                    <strong>用户</strong>
                    <p>{{ dialog.user }}</p>
                    <strong>智能体</strong>
                    <p>{{ dialog.assistant }}</p>
                  </div>
                </div>
                <span v-else class="muted">无</span>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>

    <div class="workbench-grid wide-detail">
      <section class="panel registry-panel">
        <div class="section-title">
          <div>
            <h2>记忆工作台</h2>
            <p>当前范围内显示 {{ filteredMemories.length }} 条记忆。</p>
          </div>
          <div class="toolbar">
            <input v-model="memoryQuery" type="search" aria-label="搜索记忆" placeholder="搜索记忆" />
            <select v-model="memoryTypeFilter" aria-label="记忆类型">
              <option value="all">全部类型</option>
              <option value="FACT">事实</option>
              <option value="PREFERENCE">偏好</option>
              <option value="EVENT">事件</option>
              <option value="SUMMARY">摘要</option>
            </select>
            <button type="button" @click="searchMemory" :disabled="loadingMemory || memoryQuery.trim().length === 0">搜索</button>
            <button type="button" @click="expireMemory" :disabled="loadingMemory">清理过期</button>
          </div>
        </div>

        <div class="scope-grid">
          <input v-model="memoryScope.platformId" placeholder="平台 ID" aria-label="平台 ID" />
          <input v-model="memoryScope.sessionId" placeholder="会话 ID" aria-label="会话 ID" />
          <input v-model="memoryScope.userId" placeholder="用户 ID" aria-label="用户 ID" />
          <input v-model="memoryScope.agentName" placeholder="智能体名称" aria-label="智能体名称" />
        </div>

        <EmptyState
          v-if="filteredMemories.length === 0"
          title="暂无可见记忆"
          detail="请保存记忆或调整范围筛选条件。"
        />

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>内容</th>
                <th>范围</th>
                <th>类型</th>
                <th>置信度</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="memory in filteredMemories"
                :key="memory.id"
                class="clickable-row"
                :class="{ selected: selectedMemoryId === memory.id }"
                @click="selectedMemoryId = memory.id"
              >
                <td>
                  <strong>{{ memory.content }}</strong>
                  <p class="muted">{{ memory.tags.join(', ') || memory.id }}</p>
                </td>
                <td>{{ memory.scope }}</td>
                <td>{{ memoryTypeLabel(memory.type) }}</td>
                <td>{{ Math.round(memory.confidence * 100) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <form class="stacked-form persona-form" @submit.prevent="saveMemory">
          <div class="section-title compact">
            <div>
              <h2>保存记忆</h2>
              <p>将限定范围的事实、偏好、事件或摘要写入运行时存储。</p>
            </div>
          </div>
          <div class="form-grid">
            <label>
              <span>范围</span>
              <select v-model="memoryDraft.scope">
                <option value="GLOBAL">全局</option>
                <option value="PLATFORM">平台</option>
                <option value="SESSION">会话</option>
                <option value="USER">用户</option>
                <option value="AGENT">智能体</option>
              </select>
            </label>
            <label>
              <span>类型</span>
              <select v-model="memoryDraft.type">
                <option value="FACT">事实</option>
                <option value="PREFERENCE">偏好</option>
                <option value="EVENT">事件</option>
                <option value="SUMMARY">摘要</option>
              </select>
            </label>
            <label>
              <span>标签</span>
              <input v-model="memoryTagsText" placeholder="用逗号分隔" />
            </label>
            <label>
              <span>置信度</span>
              <input v-model.number="memoryDraft.confidence" type="number" min="0" max="1" step="0.05" />
            </label>
            <label class="full-span">
              <span>内容</span>
              <textarea v-model="memoryDraft.content" class="compact-textarea" required></textarea>
            </label>
          </div>
          <button type="submit" class="primary" :disabled="savingMemory || memoryDraft.content.trim().length === 0">
            {{ savingMemory ? '保存中' : '保存记忆' }}
          </button>
        </form>
      </section>

      <aside class="panel detail-panel detail-rail">
        <div class="section-title">
          <div>
            <h2>{{ selectedMemory ? memoryTypeLabel(selectedMemory.type) : '记忆详情' }}</h2>
            <p>{{ selectedMemory ? selectedMemory.id : '请选择记忆记录或运行搜索。' }}</p>
          </div>
        </div>

        <EmptyState
          v-if="!selectedMemory"
          title="未选择记忆"
          detail="请选择记忆记录或运行范围搜索。"
        />

        <div v-else class="detail-stack">
          <article class="card memory-rail-card">
            <div class="detail-list">
              <div class="detail-item">
                <span>内容</span>
                <strong>{{ selectedMemory.content }}</strong>
              </div>
              <div class="detail-item">
                <span>范围</span>
                <div class="chip-row">
                  <span class="chip">{{ memoryScopeLabel(selectedMemory.scope) }}</span>
                  <span v-if="selectedMemory.platformId" class="chip">平台 {{ selectedMemory.platformId }}</span>
                  <span v-if="selectedMemory.sessionId" class="chip">会话 {{ selectedMemory.sessionId }}</span>
                  <span v-if="selectedMemory.userId" class="chip">用户 {{ selectedMemory.userId }}</span>
                  <span v-if="selectedMemory.agentName" class="chip">智能体 {{ selectedMemory.agentName }}</span>
                </div>
              </div>
              <div class="detail-item">
                <span>标签</span>
                <div class="chip-row">
                  <span v-for="tag in selectedMemory.tags" :key="tag" class="chip">{{ tag }}</span>
                  <span v-if="selectedMemory.tags.length === 0" class="muted">无</span>
                </div>
              </div>
              <div class="detail-item">
                <span>更新时间</span>
                <strong>{{ formatTime(selectedMemory.updatedAt) }}</strong>
              </div>
              <button type="button" @click="deleteSelectedMemory">删除记忆</button>
            </div>
          </article>

          <div v-if="searchResults.length" class="search-results">
            <div class="section-title compact">
              <div>
                <h2>搜索结果</h2>
                <p>匹配 {{ searchResults.length }} 条记录。</p>
              </div>
            </div>
            <button
              v-for="result in searchResults"
              :key="result.record.id"
              type="button"
              class="result-row"
              @click="selectedMemoryId = result.record.id"
            >
              <strong>{{ result.record.content }}</strong>
              <span>{{ result.matchReason }} / {{ result.score.toFixed(2) }}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  dashboardApi,
  type MemoryRecord,
  type MemoryScope,
  type MemorySearchResult,
  type MemoryType,
  type Persona,
  type PersonaUpsertDto,
} from '../api/dashboard';
import EmptyState from '../components/EmptyState.vue';

const workspaceId = ref('default');
const personas = ref<Persona[]>([]);
const memories = ref<MemoryRecord[]>([]);
const searchResults = ref<MemorySearchResult[]>([]);
const selectedPersonaId = ref('');
const selectedMemoryId = ref('');
const personaQuery = ref('');
const memoryQuery = ref('');
const memoryTypeFilter = ref<MemoryType | 'all'>('all');
const personaAgentsText = ref('');
const personaBoundariesText = ref('');
const memoryTagsText = ref('');
const loading = ref(false);
const loadingMemory = ref(false);
const savingPersona = ref(false);
const savingMemory = ref(false);
const notice = ref('');
const error = ref('');

const personaDraft = reactive<PersonaUpsertDto>({
  workspaceId: 'default',
  name: '',
  description: '',
  tone: '',
  boundaries: [],
  systemPromptTemplate: '',
  exampleDialogs: [],
  enabled: true,
  agentNames: [],
});

const memoryScope = reactive({
  platformId: '',
  sessionId: '',
  userId: '',
  agentName: '',
});

const memoryDraft = reactive({
  content: '',
  type: 'FACT' as MemoryType,
  scope: 'GLOBAL' as MemoryScope,
  confidence: 1,
});

const enabledPersonas = computed(() => personas.value.filter((persona) => persona.enabled).length);

const filteredPersonas = computed(() => {
  const query = personaQuery.value.trim().toLowerCase();
  return personas.value.filter((persona) => {
    if (!query) return true;
    return [persona.name, persona.description, persona.tone, persona.id, ...persona.agentNames]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
});

const filteredMemories = computed(() => {
  const query = memoryQuery.value.trim().toLowerCase();
  return memories.value.filter((memory) => {
    const matchesType = memoryTypeFilter.value === 'all' || memory.type === memoryTypeFilter.value;
    const matchesQuery =
      !query || [memory.content, memory.id, ...memory.tags, memory.scope, memory.type].join(' ').toLowerCase().includes(query);
    return matchesType && matchesQuery;
  });
});

const selectedPersona = computed(
  () => personas.value.find((persona) => persona.id === selectedPersonaId.value) ?? filteredPersonas.value[0] ?? null,
);
const selectedMemory = computed(
  () =>
    memories.value.find((memory) => memory.id === selectedMemoryId.value) ??
    searchResults.value.find((result) => result.record.id === selectedMemoryId.value)?.record ??
    filteredMemories.value[0] ??
    null,
);

const memorySignals = computed(() => [
  {
    label: '人格预设',
    value: String(personas.value.length),
    detail: `当前列表中有 ${enabledPersonas.value} 个已启用人格预设。`,
    tone: personas.value.length > 0 ? 'ok' : 'muted',
  },
  {
    label: '可见记忆',
    value: String(memories.value.length),
    detail: '当前筛选条件下已加载的范围记忆记录。',
    tone: memories.value.length > 0 ? 'ok' : 'muted',
  },
  {
    label: '搜索匹配',
    value: String(searchResults.value.length),
    detail: searchResults.value.length > 0 ? '可查看范围相关性测试结果。' : '运行搜索以检查排序效果。',
    tone: searchResults.value.length > 0 ? 'warn' : 'muted',
  },
  {
    label: '工作区',
    value: workspaceId.value,
    detail: '人格和记忆操作当前使用的工作区范围。',
    tone: 'muted',
  },
]);

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    personaDraft.workspaceId = workspaceId.value;
    const response = await dashboardApi.personas(workspaceId.value);
    personas.value = response.personas;
    selectedPersonaId.value = personas.value[0]?.id ?? '';
    await loadMemories();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

async function loadMemories() {
  loadingMemory.value = true;
  try {
    const response = await dashboardApi.memories({
      workspaceId: workspaceId.value,
      platformId: normalize(memoryScope.platformId),
      sessionId: normalize(memoryScope.sessionId),
      userId: normalize(memoryScope.userId),
      agentName: normalize(memoryScope.agentName),
      type: memoryTypeFilter.value,
      limit: 80,
    });
    memories.value = response.memories;
    selectedMemoryId.value = memories.value[0]?.id ?? '';
  } finally {
    loadingMemory.value = false;
  }
}

function selectPersona(persona: Persona) {
  selectedPersonaId.value = persona.id;
  Object.assign(personaDraft, {
    id: persona.id,
    workspaceId: persona.workspaceId,
    name: persona.name,
    description: persona.description,
    tone: persona.tone,
    boundaries: [...persona.boundaries],
    systemPromptTemplate: persona.systemPromptTemplate,
    exampleDialogs: persona.exampleDialogs.map((dialog) => ({ ...dialog })),
    enabled: persona.enabled,
    agentNames: [...persona.agentNames],
  });
  personaAgentsText.value = persona.agentNames.join(', ');
  personaBoundariesText.value = persona.boundaries.join(', ');
}

function resetPersonaDraft() {
  selectedPersonaId.value = '';
  Object.assign(personaDraft, {
    id: undefined,
    workspaceId: workspaceId.value,
    name: '',
    description: '',
    tone: '',
    boundaries: [],
    systemPromptTemplate: '',
    exampleDialogs: [],
    enabled: true,
    agentNames: [],
  });
  personaAgentsText.value = '';
  personaBoundariesText.value = '';
}

function addExampleDialog() {
  if (personaDraft.exampleDialogs.length >= 20) return;
  personaDraft.exampleDialogs.push({ user: '', assistant: '' });
}

function removeExampleDialog(index: number) {
  personaDraft.exampleDialogs.splice(index, 1);
}

function moveExampleDialog(index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= personaDraft.exampleDialogs.length) return;
  const [dialog] = personaDraft.exampleDialogs.splice(index, 1);
  personaDraft.exampleDialogs.splice(target, 0, dialog);
}

async function savePersona() {
  savingPersona.value = true;
  notice.value = '';
  error.value = '';
  try {
    const body: PersonaUpsertDto = {
      ...personaDraft,
      workspaceId: workspaceId.value,
      agentNames: splitList(personaAgentsText.value),
      boundaries: splitList(personaBoundariesText.value),
    };
    const saved = body.id ? await dashboardApi.updatePersona(body.id, body) : await dashboardApi.savePersona(body);
    notice.value = `已保存人格预设 ${saved.name}。`;
    await loadAll();
    selectPersona(saved);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    savingPersona.value = false;
  }
}

async function deleteSelectedPersona() {
  if (!personaDraft.id) return;
  await dashboardApi.deletePersona(personaDraft.id);
  notice.value = `已删除人格预设 ${personaDraft.name}。`;
  resetPersonaDraft();
  await loadAll();
}

async function saveMemory() {
  savingMemory.value = true;
  notice.value = '';
  error.value = '';
  try {
    const saved = await dashboardApi.saveMemory({
      content: memoryDraft.content,
      type: memoryDraft.type,
      scope: memoryDraft.scope,
      workspaceId: workspaceId.value,
      platformId: normalize(memoryScope.platformId),
      sessionId: normalize(memoryScope.sessionId),
      userId: normalize(memoryScope.userId),
      agentName: normalize(memoryScope.agentName),
      tags: splitList(memoryTagsText.value),
      confidence: memoryDraft.confidence,
    });
    notice.value = `已保存记忆 ${saved.id}。`;
    memoryDraft.content = '';
    memoryTagsText.value = '';
    await loadMemories();
    selectedMemoryId.value = saved.id;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    savingMemory.value = false;
  }
}

async function searchMemory() {
  loadingMemory.value = true;
  error.value = '';
  try {
    const response = await dashboardApi.searchMemory({
      query: memoryQuery.value,
      workspaceId: workspaceId.value,
      platformId: normalize(memoryScope.platformId),
      sessionId: normalize(memoryScope.sessionId),
      userId: normalize(memoryScope.userId),
      agentName: normalize(memoryScope.agentName),
      type: memoryTypeFilter.value === 'all' ? undefined : memoryTypeFilter.value,
      limit: 10,
    });
    searchResults.value = response.results;
    selectedMemoryId.value = response.results[0]?.record.id ?? selectedMemoryId.value;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loadingMemory.value = false;
  }
}

async function deleteSelectedMemory() {
  if (!selectedMemory.value) return;
  await dashboardApi.deleteMemory(selectedMemory.value.id, {
    workspaceId: workspaceId.value,
    platformId: normalize(memoryScope.platformId),
    sessionId: normalize(memoryScope.sessionId),
    userId: normalize(memoryScope.userId),
    agentName: normalize(memoryScope.agentName),
  });
  notice.value = `已删除记忆 ${selectedMemory.value.id}。`;
  await loadMemories();
}

async function expireMemory() {
  const response = await dashboardApi.expireMemory();
  notice.value = `已清理 ${response.expired} 条过期记忆。`;
  await loadMemories();
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value: string) {
  return value.trim() || undefined;
}

function memoryTypeLabel(type: MemoryType) {
  const labels: Record<MemoryType, string> = {
    FACT: '事实',
    PREFERENCE: '偏好',
    EVENT: '事件',
    SUMMARY: '摘要',
  };
  return labels[type];
}

function memoryScopeLabel(scope: MemoryScope) {
  const labels: Record<MemoryScope, string> = {
    GLOBAL: '全局',
    PLATFORM: '平台',
    SESSION: '会话',
    USER: '用户',
    AGENT: '智能体',
  };
  return labels[scope];
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

watch(workspaceId, () => {
  personaDraft.workspaceId = workspaceId.value;
});

watch(memoryTypeFilter, () => void loadMemories());

onMounted(() => {
  void loadAll();
});
</script>

<style scoped>
.memory-command {
  display: grid;
  gap: 14px;
}

.memory-hero {
  border-color: #d7cebd;
  background:
    linear-gradient(135deg, rgba(255, 252, 246, 0.98) 0%, rgba(247, 241, 231, 0.98) 55%, rgba(240, 246, 248, 0.98) 100%);
}

.memory-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(280px, 0.82fr);
  gap: 14px;
}

.memory-band {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.memory-band span,
.memory-signal span,
.rail-item span {
  color: #887152;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.memory-band span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(182, 159, 111, 0.34);
  background: rgba(255, 251, 245, 0.92);
}

.memory-copy h2 {
  margin: 0;
  color: #18304c;
  font-size: clamp(28px, 2vw + 18px, 40px);
  line-height: 0.98;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.memory-copy > p {
  margin: 12px 0 0;
  color: #5c6776;
  line-height: 1.66;
}

.memory-signal-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.memory-signal {
  display: grid;
  gap: 8px;
  border-top: 3px solid #98a2b0;
  background: rgba(255, 252, 247, 0.9);
}

.memory-signal.tone-ok {
  border-top-color: #4c8661;
}

.memory-signal.tone-warn {
  border-top-color: #bb8524;
}

.memory-signal.tone-muted {
  border-top-color: #98a2b0;
}

.memory-signal strong {
  color: #17304d;
  font-size: 28px;
  line-height: 1;
  overflow-wrap: anywhere;
}

.memory-signal p {
  margin: 0;
  color: #606a79;
  font-size: 12px;
  line-height: 1.58;
}

.memory-rail,
.detail-stack {
  display: grid;
  gap: 12px;
}

.memory-rail-card {
  border-color: #ddd4c5;
  background: rgba(255, 252, 246, 0.92);
}

.example-dialog-editor,
.example-dialog-preview {
  display: grid;
  gap: 10px;
}

.example-dialog-heading,
.example-dialog-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.example-dialog-heading p,
.example-dialog-preview p {
  margin: 4px 0 0;
  color: var(--muted);
  line-height: 1.55;
}

.example-dialog-card,
.example-dialog-preview > div {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.72);
}

.compact-actions {
  gap: 6px;
}

.rail-list {
  display: grid;
  gap: 10px;
}

.rail-item {
  display: grid;
  gap: 4px;
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
.detail-rail {
  border-color: #ddd3c3;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.96) 0%, rgba(248, 243, 234, 0.94) 100%);
}

.memory-command .memory-hero,
.memory-command .memory-rail-card,
.memory-command .registry-panel,
.memory-command .detail-rail,
.memory-command .memory-signal,
.memory-command .rail-item {
  border-color: var(--line);
  background: rgba(255, 255, 255, 0.92);
}

.memory-command .memory-band span,
.memory-command .memory-signal span,
.memory-command .rail-item span {
  color: var(--weak);
  font-weight: 600;
  letter-spacing: 0.06em;
}

.memory-command .memory-copy h2 {
  color: var(--text-strong);
  letter-spacing: -0.04em;
  text-transform: none;
}

.memory-command .memory-copy > p,
.memory-command .rail-item strong,
.memory-command .memory-signal p {
  color: var(--muted);
}

@media (max-width: 1180px) {
  .memory-hero-grid,
  .workbench-grid.wide-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .memory-signal-grid {
    grid-template-columns: 1fr;
  }
}
</style>
