<template>
  <div class="v3-stack">
    <h3>记忆记录</h3>
    <p class="muted">记忆库保存共享记录，由 Agent 选择装配和写入目标。</p>
    <p v-if="disabled" class="notice">请先保存记忆库声明，再管理记录。</p>
    <div class="toolbar">
      <input v-model="query" type="search" aria-label="搜索库内记忆" placeholder="搜索库内记忆" />
      <button type="button" @click="load" :disabled="busy || disabled">读取记录</button>
      <button type="button" @click="create" :disabled="disabled">新增记录</button>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <div v-for="item in items" :key="item.id" class="card">
      <p class="v3-preserve">{{ item.content }}</p>
      <div class="toolbar">
        <span class="chip">{{ item.scope }}</span>
        <span>{{ item.type }}</span>
        <button type="button" @click="remove(item.id)" :disabled="busy">删除</button>
      </div>
    </div>
    <p v-if="loaded && !items.length" class="muted">暂无匹配记录。</p>
    <form v-if="draft" @submit.prevent="save" class="card v3-stack">
      <div class="v3-form-grid">
        <label>
          范围
          <select v-model="draft.scope">
            <option v-for="scope in scopes" :key="scope">{{ scope }}</option>
          </select>
        </label>
        <label>
          类型
          <select v-model="draft.type">
            <option>FACT</option>
            <option>PREFERENCE</option>
            <option>EVENT</option>
            <option>SUMMARY</option>
          </select>
        </label>
        <label>
          平台 ID
          <input v-model="draft.platformId" />
        </label>
        <label>
          会话 ID
          <input v-model="draft.sessionId" />
        </label>
        <label>
          用户 ID
          <input v-model="draft.userId" />
        </label>
        <label>
          Agent ID
          <input v-model="draft.agentName" />
        </label>
        <label>
          置信度
          <input v-model.number="draft.confidence" type="number" min="0" max="1" step="0.05" />
        </label>
        <label class="v3-span-all">
          内容
          <textarea v-model="draft.content" required rows="5" />
        </label>
      </div>
      <div class="toolbar">
        <button class="primary" :disabled="busy || disabled || !draft.content.trim()">
          保存记录
        </button>
        <button type="button" @click="draft = null">取消</button>
      </div>
    </form>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { request, type MemoryRecord, type MemoryScope, type MemoryType } from '../../api/dashboard';
import { scopes } from '../../models/configV3';
const props = defineProps<{ id: string; disabled?: boolean }>();
const query = ref('');
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const items = ref<MemoryRecord[]>([]);
const draft = ref<{
  content: string;
  scope: MemoryScope;
  type: MemoryType;
  confidence: number;
  platformId: string;
  sessionId: string;
  userId: string;
  agentName: string;
} | null>(null);
const path = () => `/api/memory-libraries/${encodeURIComponent(props.id)}/memories`;
function create() {
  draft.value = {
    content: '',
    scope: 'GLOBAL',
    type: 'FACT',
    confidence: 1,
    platformId: '',
    sessionId: '',
    userId: '',
    agentName: '',
  };
}
async function load() {
  busy.value = true;
  error.value = '';
  try {
    const response = await request<{ memories: MemoryRecord[] }>(
      `${path()}?query=${encodeURIComponent(query.value)}`,
    );
    items.value = response.memories;
    loaded.value = true;
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  error.value = '';
  try {
    const body = {
      ...draft.value,
      tags: [],
      ...Object.fromEntries(
        ['platformId', 'sessionId', 'userId', 'agentName'].map((key) => [
          key,
          draft.value![key as 'platformId'] || null,
        ]),
      ),
    };
    await request(path(), { method: 'POST', body: JSON.stringify(body) });
    draft.value = null;
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
async function remove(id: string) {
  if (!window.confirm('删除这条记忆？')) return;
  busy.value = true;
  error.value = '';
  try {
    await request(`${path()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.id,
  () => {
    items.value = [];
    loaded.value = false;
    draft.value = null;
    error.value = '';
  },
);
</script>
