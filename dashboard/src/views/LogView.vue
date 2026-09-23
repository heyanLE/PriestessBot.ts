<template>
  <div class="v3-page log-page">
    <section class="panel log-panel" aria-labelledby="log-title">
      <header class="log-header">
        <div class="log-heading">
          <h2 id="log-title">实时日志</h2>
          <span class="connection-state" :class="{ connected: logStore.connected }" role="status">
            <span aria-hidden="true"></span>
            {{ logStore.connected ? '日志流已连接' : '日志流未连接' }}
          </span>
        </div>
        <div class="toolbar log-actions">
          <button type="button" :disabled="logStore.connected" @click="logStore.connect()">连接日志流</button>
          <button type="button" :disabled="!logStore.events.length" @click="logStore.clear()">清空记录</button>
        </div>
      </header>

      <p v-if="logStore.error" class="notice error log-error" role="alert">{{ logStore.error }}</p>

      <div class="log-filters">
        <div class="level-filters" role="group" aria-label="按日志级别筛选">
          <button type="button" :class="{ active: selectedLevel === '' }" :aria-pressed="selectedLevel === ''" @click="selectedLevel = ''">
            全部 <span>{{ logStore.events.length }}</span>
          </button>
          <button
            v-for="level in levels"
            :key="level.name"
            type="button"
            :class="{ active: selectedLevel === level.name }"
            :aria-pressed="selectedLevel === level.name"
            @click="selectedLevel = level.name"
          >
            {{ formatLevel(level.name) }} <span>{{ level.count }}</span>
          </button>
        </div>
        <input v-model="query" class="log-search" type="search" aria-label="搜索日志内容" placeholder="搜索日志内容" />
      </div>

      <div class="log-table-head" aria-hidden="true">
        <span>时间</span>
        <span>级别</span>
        <span>事件内容 <small>按事件时间，最新在前</small></span>
      </div>
      <EmptyState
        v-if="!logStore.events.length"
        title="暂无日志记录"
        :detail="logStore.connected ? '连接已建立。新的运行事件会出现在这里。' : '连接日志流，查看服务运行中的信息、警告与错误。'"
      />
      <div v-else-if="!filteredEvents.length" class="log-empty">
        <h3>没有符合条件的记录</h3>
        <p>尝试其他级别或搜索内容。</p>
        <button type="button" @click="resetFilters">清除筛选</button>
      </div>
      <ol v-else class="event-stream" aria-label="运行事件，按事件时间从新到旧排列">
        <li
          v-for="(event, index) in filteredEvents"
          :key="`${event.timestamp}-${index}-${event.level}`"
          class="event-row"
          :class="`tone-${levelTone(event.level)}`"
        >
          <time class="event-time" :title="formatDateTime(event.timestamp)">{{ formatTime(event.timestamp) }}</time>
          <span class="event-level" :class="levelTone(event.level)">{{ formatLevel(event.level) }}</span>
          <pre class="event-message">{{ event.message }}</pre>
        </li>
      </ol>
      <footer class="log-footer">
        <span>显示 {{ filteredEvents.length }} 条，最多保留最近接收的 200 条</span>
        <span v-if="latestEvent">最新事件 {{ formatTime(latestEvent.timestamp) }}</span>
        <span v-else>{{ logStore.events.length ? '事件时间不可用' : '等待运行事件' }}</span>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import { useLogStore } from '../stores/logs';

const logStore = useLogStore();
const selectedLevel = ref('');
const query = ref('');
const orderedEvents = computed(() => logStore.events
  .map((event, index) => ({ event, index, timestamp: validTimestamp(event.timestamp) }))
  .sort((left, right) => {
    if (left.timestamp === null && right.timestamp === null) return left.index - right.index;
    if (left.timestamp === null) return 1;
    if (right.timestamp === null) return -1;
    return right.timestamp - left.timestamp || left.index - right.index;
  })
  .map(({ event }) => event),
);
const latestEvent = computed(() => orderedEvents.value.find((event) => validTimestamp(event.timestamp) !== null) ?? null);
const levels = computed(() => {
  const counts = new Map<string, number>([['INFO', 0], ['WARN', 0], ['ERROR', 0]]);
  for (const event of logStore.events) {
    const level = normalizeLevel(event.level);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  if (selectedLevel.value && !counts.has(selectedLevel.value)) counts.set(selectedLevel.value, 0);
  return [...counts].map(([name, count]) => ({ name, count }));
});
const filteredEvents = computed(() => {
  const search = query.value.trim().toLowerCase();
  return orderedEvents.value.filter((event) =>
    (!selectedLevel.value || normalizeLevel(event.level) === selectedLevel.value)
    && (!search || String(event.message ?? '').toLowerCase().includes(search)),
  );
});

function normalizeLevel(level: string) {
  const value = String(level).trim().toUpperCase();
  return value === 'WARNING' ? 'WARN' : value || 'UNKNOWN';
}
function levelTone(level: string) {
  const value = normalizeLevel(level);
  if (value === 'ERROR' || value === 'FATAL') return 'danger';
  if (value === 'WARN') return 'warn';
  return 'muted';
}
function formatLevel(level: string) {
  const value = normalizeLevel(level);
  const labels: Record<string, string> = { INFO: '信息', WARN: '警告', ERROR: '错误', DEBUG: '调试', TRACE: '跟踪', FATAL: '严重错误', UNKNOWN: '未知' };
  return labels[value] ?? value;
}
function validTimestamp(value: unknown): number | null {
  // The API supplies Unix milliseconds as a number. Malformed events stay visible at the end.
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}
function formatTime(value: number) {
  const timestamp = validTimestamp(value);
  return timestamp !== null
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp)
    : '未知时间';
}
function formatDateTime(value: number) {
  const timestamp = validTimestamp(value);
  return timestamp !== null ? new Date(timestamp).toLocaleString('zh-CN') : '未知时间';
}
function resetFilters() {
  selectedLevel.value = '';
  query.value = '';
}
onMounted(() => logStore.connect());
</script>

<style scoped>
.log-panel { padding: 0; overflow: hidden; }
.log-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 22px 24px 18px; }
.log-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.log-heading h2 { margin: 0; font-size: 22px; }
.connection-state { display: inline-flex; align-items: center; gap: 7px; color: var(--muted, #63758a); font-size: 12px; }
.connection-state > span { width: 6px; height: 6px; border-radius: 50%; background: var(--weak); }
.connection-state.connected > span { background: #377969; }
.log-actions { gap: 8px; }
.log-error { margin: 0 24px 16px; }
.log-filters { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; padding: 0 24px 18px; }
.level-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.level-filters button { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 6px 10px; border: 1px solid transparent; background: transparent; font-size: 13px; font-weight: 500; }
.level-filters button span { color: var(--muted, #63758a); font-size: 12px; font-variant-numeric: tabular-nums; }
.level-filters button.active { color: var(--accent-ink); background: var(--accent-soft); border-color: var(--line-strong); }
.log-search { width: min(100%, 260px); min-height: 36px; }
.log-table-head, .event-row { display: grid; grid-template-columns: 86px 78px minmax(0, 1fr); column-gap: 12px; }
.log-table-head { padding: 10px 24px; border-block: 1px solid var(--line, #dae3ec); background: var(--surface-soft); color: var(--muted, #63758a); font-size: 12px; }
.log-table-head small { margin-left: 8px; font-weight: 400; font-size: 11px; }
.event-stream { list-style: none; margin: 0; padding: 0; max-height: min(70vh, 780px); overflow: auto; }
.event-row { align-items: start; padding: 14px 24px; border-bottom: 1px solid var(--line); }
.event-row:last-child { border-bottom: 0; }
.event-row.tone-danger { background: #fff8f7; }
.event-time { padding-top: 2px; color: var(--muted, #63758a); font-size: 12px; font-variant-numeric: tabular-nums; }
.event-level { justify-self: start; padding: 2px 7px; border-radius: 4px; background: var(--surface-soft); color: var(--muted); font-size: 11px; line-height: 1.6; }
.event-level.warn { color: #855e17; background: #fbf1d9; }
.event-level.danger { color: #a43f39; background: #f8e2df; }
.event-message { margin: 0; color: var(--ink, #172c42); font: inherit; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.log-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--line, #dae3ec); color: var(--muted, #63758a); font-size: 12px; }
.log-empty { padding: 52px 24px; text-align: center; }
.log-empty h3 { margin: 0 0 8px; font-size: 16px; }
.log-empty p { color: var(--muted, #63758a); font-size: 13px; }
@media (max-width: 640px) {
  .log-header { padding: 18px 16px 14px; align-items: flex-start; }
  .log-heading { display: grid; gap: 8px; }
  .log-actions { width: auto; }
  .log-actions > button { flex: 0 1 auto; }
  .log-filters { padding: 0 16px 14px; gap: 12px; }
  .log-search { width: 100%; }
  .log-error { margin-inline: 16px; }
  .log-table-head { display: none; }
  .event-row { grid-template-columns: 76px minmax(0, 1fr); gap: 8px 12px; padding: 14px 16px; }
  .event-message { grid-column: 1 / -1; }
  .log-footer { padding: 12px 16px; }
}
</style>
