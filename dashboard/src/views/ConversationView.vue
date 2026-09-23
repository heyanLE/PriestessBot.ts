<template>
  <section class="panel conversation-list">
    <header class="conversation-list-header">
      <div>
        <h2>会话列表</h2>
        <p>按最近更新时间排列，打开会话查看消息记录。</p>
      </div>
      <span v-if="store.loading" class="muted" role="status">正在刷新…</span>
    </header>

    <div class="conversation-filters">
      <label>
        搜索会话
        <input
          v-model="query"
          type="search"
          placeholder="搜索会话 ID、IM 或记录 ID"
          aria-label="搜索会话"
        />
      </label>
      <label>
        IM
        <select v-model="platform" aria-label="筛选 IM">
          <option value="">所有 IM</option>
          <option v-for="item in platforms" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
    </div>

    <p v-if="store.error" class="notice error" role="alert">{{ store.error }}</p>

    <template v-if="!store.loading && store.conversations.length === 0">
      <EmptyState
        title="暂无会话记录"
        detail="先配置 IM 和 Agent 路由。收到可处理的消息后，会话记录会显示在这里。"
      />
      <RouterLink class="button-link" to="/ims">配置 IM</RouterLink>
    </template>
    <template v-else-if="!store.loading && filteredConversations.length === 0">
      <EmptyState title="没有匹配的会话" detail="尝试其他关键词，或清除 IM 筛选。" />
      <button type="button" @click="clearFilters">清除筛选</button>
    </template>
    <template v-else-if="filteredConversations.length">
      <div class="conversation-result-meta">
        <span aria-live="polite">
          {{
            query || platform
              ? `显示 ${filteredConversations.length} / ${store.conversations.length} 个会话`
              : `共 ${store.conversations.length} 个会话`
          }}
        </span>
        <button v-if="query || platform" type="button" class="text-button" @click="clearFilters">
          清除筛选
        </button>
      </div>
      <div
        class="conversation-table-wrap"
        role="region"
        tabindex="0"
        aria-label="会话列表，可横向滚动"
      >
        <table class="conversation-table">
          <thead>
            <tr>
              <th scope="col">IM</th>
              <th scope="col">会话</th>
              <th scope="col">最近更新</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="conversation in filteredConversations" :key="conversation.id">
              <td>{{ conversation.platform || '未记录' }}</td>
              <td class="conversation-session">{{ conversation.sessionId || conversation.id }}</td>
              <td>
                <time :datetime="isoTime(conversation.updatedAt)">
                  {{ formatTime(conversation.updatedAt) }}
                </time>
              </td>
              <td>
                <RouterLink
                  class="conversation-detail-link"
                  :to="{ name: 'conversation-detail', params: { id: conversation.id } }"
                  :aria-label="`查看会话 ${conversation.sessionId || conversation.id}`"
                >
                  查看
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import EmptyState from '../components/EmptyState.vue';
import { useDashboardStore } from '../stores/dashboard';

const store = useDashboardStore();
const query = ref('');
const platform = ref('');
const platforms = computed(() =>
  [...new Set(store.conversations.map((conversation) => conversation.platform))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'zh-CN')),
);
const filteredConversations = computed(() => {
  const term = query.value.trim().toLocaleLowerCase('zh-CN');
  return store.conversations
    .filter(
      (conversation) =>
        (!platform.value || conversation.platform === platform.value) &&
        (!term ||
          `${conversation.id} ${conversation.sessionId} ${conversation.platform}`
            .toLocaleLowerCase('zh-CN')
            .includes(term)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
});
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function clearFilters() {
  query.value = '';
  platform.value = '';
}
function isoTime(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function formatTime(value: number) {
  return isoTime(value) ? dateFormatter.format(value) : '时间未知';
}
</script>

<style scoped>
.conversation-list {
  min-width: 0;
}
.conversation-list-header,
.conversation-result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.conversation-list-header h2 {
  margin: 0;
}
.conversation-list-header p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.conversation-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 220px);
  gap: 16px;
  margin: 24px 0 18px;
}
.conversation-filters label {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
.conversation-filters input,
.conversation-filters select {
  width: 100%;
  min-width: 0;
}
.conversation-result-meta {
  min-height: 32px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--muted);
}
.conversation-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border-top: 1px solid var(--line);
}
.conversation-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 13px;
}
.conversation-table th,
.conversation-table td {
  padding: 15px 16px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.conversation-table th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.conversation-table th:first-child,
.conversation-table td:first-child {
  padding-left: 0;
}
.conversation-table th:last-child,
.conversation-table td:last-child {
  padding-right: 0;
  text-align: right;
}
.conversation-session {
  max-width: 380px;
  overflow-wrap: anywhere;
}
.conversation-table time,
.conversation-detail-link {
  white-space: nowrap;
}
.conversation-detail-link {
  display: inline-block;
  padding: 6px 0 6px 12px;
  color: var(--accent);
  font-weight: 600;
}
.conversation-detail-link:hover {
  text-decoration: underline;
}
@media (max-width: 600px) {
  .conversation-filters {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .conversation-list-header {
    align-items: flex-start;
  }
}
</style>
