<template>
  <div class="execution-page">
    <section class="surface-section execution-filters">
      <form @submit.prevent="applyFilters">
        <label>IM<input v-model.trim="filters.platform" placeholder="IM ID" /></label>
        <label>Agent<input v-model.trim="filters.agent" placeholder="Agent ID" /></label>
        <label>LLM 连接<input v-model.trim="filters.provider" placeholder="连接 ID" /></label>
        <label>会话<input v-model.trim="filters.sessionId" placeholder="会话 ID" /></label>
        <label>状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select></label>
        <button class="primary" :disabled="loading">筛选</button>
      </form>
    </section>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <div class="execution-workbench">
      <section class="surface-section execution-registry" :aria-busy="loading">
        <div class="execution-list-heading"><h2>执行记录 <span>{{ total.toLocaleString() }}</span></h2><button type="button" class="quiet-button" @click="refresh" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button></div>
        <p class="execution-list-caption">按开始时间排列，最新在前</p>
        <div class="execution-list">
          <p v-if="loading && !items.length" class="execution-empty" role="status">正在加载执行记录…</p>
          <div v-else-if="!items.length" class="execution-empty"><strong>{{ error ? '执行记录暂时不可用' : '没有匹配的执行记录' }}</strong><p>{{ error ? '点击刷新，重新尝试读取记录。' : '调整筛选条件，或等待下一次 Agent 执行。' }}</p></div>
          <button v-for="item in items" :key="item.id" type="button" class="execution-list-item" :class="{ selected: selectedId === item.id }" aria-label="查看链路" :aria-pressed="selectedId === item.id" @click="select(item.id)">
            <span class="execution-item-top"><span class="execution-status" :class="tone(item.status)"><i aria-hidden="true"></i>{{ statusLabels[item.status] }}</span><time :datetime="new Date(item.startedAt).toISOString()">{{ shortDate(item.startedAt) }}</time></span>
            <strong>{{ item.inputPreview || '无文本输入' }}</strong>
            <span class="execution-item-route">{{ item.platform }} <span aria-hidden="true">→</span> {{ item.agent || '未进入 Agent' }}</span>
            <span class="execution-item-bottom"><span>{{ number(item.totalTokens) }} tokens <span aria-hidden="true">·</span> {{ duration(item.durationMillis) }}</span><span class="execution-open">查看链路 <span aria-hidden="true">↗</span></span></span>
          </button>
        </div>
        <nav class="execution-pagination" aria-label="执行记录分页"><button type="button" :disabled="offset === 0 || loading" @click="changePage(-1)">上一页</button><span>{{ Math.floor(offset / limit) + 1 }} / {{ Math.max(1, Math.ceil(total / limit)) }}</span><button type="button" :disabled="offset + limit >= total || loading" @click="changePage(1)">下一页</button></nav>
      </section>

      <section class="surface-section execution-inspector" :aria-busy="detailLoading">
        <div v-if="!selectedId" class="inspector-placeholder"><span class="placeholder-path" aria-hidden="true"><i></i><b></b><i></i><b></b><i></i></span><h2>选择一次执行</h2><p>先查看结果与耗时，再沿时间线检查模型请求、响应和工具调用。</p><span>左侧选择记录，查看完整链路</span></div>
        <template v-else>
          <div class="section-title execution-detail-heading"><div><h2>执行详情</h2><span class="execution-id" :title="selectedId">{{ selectedId }}</span></div><button type="button" class="quiet-button" @click="closeDetail">关闭</button></div>
          <p v-if="detailError" class="notice error" role="alert">{{ detailError }} <button type="button" @click="loadDetail(!detail)" :disabled="detailLoading">重试</button></p>
          <p v-if="detailLoading && !detail" class="execution-empty" role="status">正在加载执行详情…</p>
          <template v-if="detail">
            <div class="execution-outcome"><span class="inline-status" :class="tone(detail.status)">{{ statusLabels[detail.status] }}</span><span>{{ date(detail.startedAt) }}</span><span class="execution-event-count">{{ detail.eventCount }} 个事件</span></div>
            <div class="execution-path"><span>{{ detail.platform }}</span><span aria-hidden="true">→</span><strong>{{ detail.agent || '未装配 Agent' }}</strong><span aria-hidden="true">→</span><span>{{ detail.provider || '未调用 LLM' }}<small v-if="detail.model">{{ detail.model }}</small></span></div>
            <dl class="execution-facts"><div><dt>总耗时</dt><dd>{{ duration(detail.durationMillis) }}</dd></div><div><dt>输入 Token</dt><dd>{{ number(detail.promptTokens) }}</dd></div><div><dt>输出 Token</dt><dd>{{ number(detail.completionTokens) }}</dd></div><div><dt>会话</dt><dd class="execution-session" :title="detail.sessionId">{{ detail.sessionId || '—' }}</dd></div></dl>
            <p v-if="detail.error" class="notice error" role="alert">{{ detail.error }}</p>
            <div class="execution-response-summary"><div><span>用户输入</span><p>{{ detail.inputPreview || '无文本输入' }}</p></div><div v-if="detail.outputPreview"><span>最终输出</span><p>{{ detail.outputPreview }}</p></div><small>摘要可能截断，完整内容可在下方对应事件中查看。</small></div>

            <div class="timeline-heading"><div><h3>事件时间线</h3><span>{{ events.length }} / {{ detail.eventCount }} 已加载</span></div><button type="button" class="quiet-button" @click="loadDetail(false)" :disabled="detailLoading">{{ detailLoading ? '读取中…' : '读取最新事件' }}</button></div>
            <div class="timeline-filters" role="group" aria-label="事件类别"><label v-for="category in categories" :key="category" :class="{ active: visibleCategories.includes(category) }"><input v-model="visibleCategories" type="checkbox" :value="category" /><span>{{ category }}</span><small>{{ events.filter(event => event.category === category).length }}</small></label></div>
            <ol class="event-timeline">
              <li v-for="event in visibleEvents" :key="event.seq" class="v3-event timeline-event" :class="{ 'event-failed': event.type.includes('error') || event.type.includes('cancelled') }">
                <span class="timeline-node" :class="`node-${event.category.toLowerCase()}`" aria-hidden="true"></span>
                <details class="event-disclosure">
                  <summary><span class="event-summary-main"><span class="event-title">{{ eventTitle(event) }}<span v-if="event.step != null" class="event-step">步骤 {{ event.step }}</span></span><span class="event-preview">{{ eventPreview(event) }}</span><span class="event-type">{{ event.seq }} · {{ event.category }} · {{ event.type }}</span></span><span class="event-timing"><span>{{ relativeTime(event.timestamp) }}</span><small v-if="event.durationMillis != null">{{ duration(event.durationMillis) }}</small><span class="event-chevron" aria-hidden="true">⌄</span></span></summary>
                  <div class="event-content">
                    <p v-if="event.truncated" class="notice">此事件内容已按存储限制截断。</p>
                    <template v-if="event.type === 'llm.request' && Array.isArray(event.data.messages)">
                      <div class="event-metadata"><span>模型 <strong>{{ text(event.data.model) }}</strong></span><span>Temperature <strong>{{ text(event.data.temperature) }}</strong></span><span v-if="event.data.maxTokens != null">输出上限 <strong>{{ text(event.data.maxTokens) }}</strong></span></div>
                      <h4>实际发送的消息 · {{ messages(event).length }}</h4>
                      <details v-for="(message, index) in messages(event)" :key="index" class="message-disclosure"><summary><span class="message-role">{{ text(message.role) }}</span><span>{{ preview(message.content, 80) || '无文本内容' }}</span></summary><pre class="v3-event-data">{{ text(message.content) || '（无文本内容）' }}</pre><pre v-if="message.toolCalls" class="v3-event-data">{{ pretty(message.toolCalls) }}</pre></details>
                      <details v-if="Array.isArray(event.data.tools) && event.data.tools.length" class="event-raw"><summary>可调用工具定义 · {{ event.data.tools.length }}</summary><pre class="v3-event-data">{{ pretty(event.data.tools) }}</pre></details>
                    </template>
                    <template v-else-if="event.type === 'llm.response'">
                      <h4>模型响应</h4><pre class="v3-event-data">{{ responseText(event) || '（无文本响应）' }}</pre>
                      <details v-if="Array.isArray(event.data.toolCalls) && event.data.toolCalls.length" class="event-raw"><summary>模型发起的工具调用 · {{ event.data.toolCalls.length }}</summary><pre class="v3-event-data">{{ pretty(event.data.toolCalls) }}</pre></details>
                      <div v-if="event.data.finishReason" class="event-metadata"><span>结束原因 <strong>{{ text(event.data.finishReason) }}</strong></span></div>
                    </template>
                    <template v-else-if="event.type === 'tool.call'"><h4>{{ text(event.data.name) }} · 调用参数</h4><pre class="v3-event-data">{{ pretty(event.data.arguments) }}</pre><span class="event-call-id">调用 ID：{{ text(event.data.callId) }}</span></template>
                    <template v-else-if="event.type === 'tool.result'"><h4>{{ text(event.data.name) }} · 执行结果</h4><pre class="v3-event-data">{{ toolOutput(event) }}</pre><details v-if="event.data.observation" class="event-raw"><summary>返回模型的工具内容</summary><pre class="v3-event-data">{{ text(event.data.observation) }}</pre></details></template>
                    <template v-else-if="event.type === 'message.received'"><h4>接收到的消息</h4><pre class="v3-event-data">{{ text(event.data.input) }}</pre></template>
                    <template v-else-if="event.type === 'execution.finished'"><h4>最终输出</h4><pre class="v3-event-data">{{ text(event.data.output) || text(event.data.error) || '（无文本输出）' }}</pre></template>
                    <pre v-else class="v3-event-data">{{ pretty(event.data) }}</pre>
                    <details v-if="isStructuredEvent(event)" class="event-raw"><summary>原始事件数据</summary><pre class="v3-event-data">{{ pretty(event.data) }}</pre></details>
                  </div>
                </details>
              </li>
            </ol>
            <p v-if="!events.length && !detailLoading" class="execution-empty">尚无事件。</p>
            <p v-else-if="!visibleEvents.length" class="execution-empty">没有选中类别的事件，请调整上方类别筛选。</p>
            <div class="timeline-footer"><button v-if="hasMore" type="button" @click="loadDetail(false)" :disabled="detailLoading">{{ detailLoading ? '加载中…' : '加载更多事件' }}</button><span v-else>{{ detail.status === 'RUNNING' ? '执行仍在进行，可读取最新事件。' : '已到达当前执行的末尾。' }}</span></div>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { executionsApi, type ExecutionSummary, type ExecutionEvent } from '../api/executions';

const route = useRoute();
const statusLabels = { RUNNING: '运行中', SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消', SKIPPED: '已跳过' };
const filters = reactive({ platform: '', agent: '', provider: '', status: '', sessionId: '' });
const appliedFilters = reactive({ ...filters });
const items = ref<ExecutionSummary[]>([]);
const total = ref(0);
const limit = 30;
const offset = ref(0);
const loading = ref(false);
const error = ref('');
const selectedId = ref('');
const detail = ref<ExecutionSummary | null>(null);
const events = ref<ExecutionEvent[]>([]);
const nextSeq = ref(0);
const hasMore = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequest = 0;
let listRequest = 0;
const categories = ['IM', 'AGENT', 'LLM', 'TOOL'];
const visibleCategories = ref([...categories]);
const visibleEvents = computed(() => events.value.filter(item => visibleCategories.value.includes(item.category)));
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const shortDate = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
const duration = (value?: number) => value == null ? '—' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
const number = (value: number) => value.toLocaleString('zh-CN');
const tone = (status: string) => status === 'SUCCEEDED' ? 'ok' : status === 'FAILED' ? 'error' : status === 'RUNNING' ? 'warn' : 'muted';
const relativeTime = (value: number) => `+${(Math.max(0, value - (detail.value?.startedAt ?? value)) / 1000).toFixed(2)}s`;
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
const preview = (value: unknown, size = 110) => { const normalized = text(value).replace(/\s+/g, ' ').trim(); return normalized.length > size ? `${normalized.slice(0, size)}…` : normalized; };
function pretty(value: unknown) { if (typeof value === 'string') { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } } return JSON.stringify(value, null, 2) ?? '—'; }
function object(value: unknown): Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function messages(event: ExecutionEvent) { return Array.isArray(event.data.messages) ? event.data.messages.map(object) : []; }
function responseText(event: ExecutionEvent) {
  const content = text(event.data.content);
  const hasToolCalls = Array.isArray(event.data.toolCalls) && event.data.toolCalls.length > 0;
  return hasToolCalls && content.trim() === 'null' ? '' : content;
}
function toolOutput(event: ExecutionEvent) { const result = object(event.data.result); return text(result.output) || text(result.error) || pretty(result); }
function isStructuredEvent(event: ExecutionEvent) { return ['llm.request', 'llm.response', 'tool.call', 'tool.result', 'message.received', 'execution.finished'].includes(event.type); }
function eventTitle(event: ExecutionEvent) {
  const labels: Record<string, string> = { 'message.received': '接收消息', 'route.matched': '匹配 IM 路由', 'route.unmatched': '未匹配路由', 'agent.selected': '装配 Agent', 'step.started': '开始推理步骤', 'step.finished': '推理步骤结束', 'step.error': '推理步骤出错', 'step.cancelled': '推理步骤已取消', 'llm.request': '发送模型请求', 'llm.response': '收到模型响应', 'llm.error': '模型调用失败', 'llm.cancelled': '模型调用已取消', 'tool.call': '调用工具', 'tool.result': '工具返回结果', 'tool.cancelled': '工具调用已取消', 'execution.finished': '执行结束', 'execution.interrupted': '执行被中断' };
  return labels[event.type] ?? event.type;
}
function eventPreview(event: ExecutionEvent) {
  const data = event.data;
  if (event.type === 'llm.request') return `${text(data.model) || '模型请求'} · ${messages(event).length} 条消息 · ${Array.isArray(data.tools) ? data.tools.length : 0} 个工具定义`;
  if (event.type === 'llm.response') return preview(responseText(event)) || (Array.isArray(data.toolCalls) && data.toolCalls.length ? `${data.toolCalls.length} 个工具调用` : '无文本响应');
  if (event.type === 'tool.call') return text(data.name) || '查看调用参数';
  if (event.type === 'tool.result') return `${text(data.name)} · ${object(data.result).success === false ? '失败' : '完成'}`;
  if (event.type === 'route.matched') return `${text(data.routeId)}${data.agentId ? ` → ${text(data.agentId)}` : ''}`;
  if (event.type === 'agent.selected') return `${text(data.agent)} · ${text(data.model)}`;
  if (event.type === 'message.received') return preview(data.input);
  if (event.type === 'execution.finished') return preview(data.error) || preview(data.output) || statusLabels[text(data.status) as keyof typeof statusLabels] || '';
  if (data.error) return preview(data.error);
  return data.state ? `状态：${text(data.state)}` : '';
}
async function refresh() {
  const request = ++listRequest;
  loading.value = true;
  error.value = '';
  try {
    const response = await executionsApi.list({ ...appliedFilters, limit, offset: offset.value });
    if (request !== listRequest) return;
    items.value = response.items;
    total.value = response.total;
  } catch (cause) { if (request === listRequest) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (request === listRequest) loading.value = false; }
}
function applyFilters() { Object.assign(appliedFilters, filters); offset.value = 0; closeDetail(); void refresh(); }
function changePage(delta: number) { offset.value = Math.max(0, offset.value + delta * limit); closeDetail(); void refresh(); }
function select(id: string) {
  selectedId.value = id;
  detail.value = null;
  events.value = [];
  nextSeq.value = 0;
  hasMore.value = false;
  visibleCategories.value = [...categories];
  void loadDetail(true);
}
function closeDetail() { detailRequest++; selectedId.value = ''; detail.value = null; events.value = []; detailError.value = ''; detailLoading.value = false; nextSeq.value = 0; hasMore.value = false; }
async function loadDetail(reset: boolean) {
  if (!selectedId.value) return;
  const request = ++detailRequest;
  const id = selectedId.value;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const response = await executionsApi.detail(id, reset ? 0 : nextSeq.value);
    if (request !== detailRequest || id !== selectedId.value) return;
    detail.value = response.execution;
    const merged = new Map((reset ? [] : events.value).map(event => [event.seq, event]));
    response.events.forEach(event => merged.set(event.seq, event));
    events.value = [...merged.values()].sort((a, b) => a.seq - b.seq);
    nextSeq.value = reset ? response.nextSeq : Math.max(nextSeq.value, response.nextSeq);
    hasMore.value = response.hasMore;
  } catch (cause) { if (request === detailRequest) detailError.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (request === detailRequest) detailLoading.value = false; }
}
function openLinkedExecution() { if (typeof route.query.execution === 'string' && route.query.execution) select(route.query.execution); }
onMounted(() => { void refresh(); openLinkedExecution(); });
watch(() => route.query.execution, openLinkedExecution);
</script>

<style scoped>
.execution-page { display: grid; gap: 18px; min-width: 0; }
.execution-filters, .execution-registry, .execution-inspector { background: var(--surface-strong, #fff); border: 1px solid var(--line, #DAE3EC); border-radius: 12px; min-width: 0; }
.execution-filters { padding: 20px; }
.execution-filters form { display: grid; grid-template-columns: repeat(4, minmax(95px, 1fr)) minmax(105px, .85fr) auto; gap: 14px; align-items: end; }
.execution-filters label { display: grid; gap: 8px; min-width: 0; font-size: 11px; font-weight: 500; color: var(--muted); }
.execution-filters input, .execution-filters select { width: 100%; min-width: 0; font-size: 12px; }
.execution-workbench { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 20px; align-items: start; }
.execution-registry { position: sticky; top: 20px; overflow: hidden; }
.execution-list-heading { display: flex; align-items: center; justify-content: space-between; padding: 18px 18px 0; gap: 10px; }
.execution-list-heading h2 { margin: 0; color: var(--text-strong); font-size: 13px; font-weight: 600; }
.execution-list-heading h2 > span { margin-left: 7px; font-size: 11px; color: var(--muted); font-weight: 400; }
.quiet-button { padding: 5px 8px; background: transparent; border-color: transparent; box-shadow: none; color: var(--muted); font-size: 11px; }
.quiet-button:hover { background: var(--surface-soft); color: var(--text-strong); }
.execution-list-caption { margin: 8px 18px 17px; color: var(--weak); font-size: 10px; }
.execution-list { max-height: min(720px, calc(100vh - 320px)); min-height: 280px; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--line); }
.execution-list-item { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); justify-content: stretch; justify-items: stretch; align-items: start; gap: 10px; width: 100%; min-width: 0; padding: 16px 18px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; color: inherit; text-align: left; box-shadow: none; font-weight: 400; }
.execution-list-item:last-child { border-bottom: 0; }
.execution-list-item:hover { background: var(--surface-soft); transform: none; }
.execution-list-item.selected { background: var(--accent-soft, #fbf2f1); box-shadow: inset 3px 0 0 var(--accent); }
.execution-item-top, .execution-item-bottom { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.execution-item-top time { color: var(--weak); font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.execution-status { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; color: var(--muted); }
.execution-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.execution-status.ok { color: #42796a; }
.execution-status.error { color: var(--accent); }
.execution-status.warn { color: #9c7535; }
.execution-list-item > strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; color: var(--text-strong); font-size: 13px; font-weight: 500; line-height: 1.6; }
.execution-item-route { color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.execution-item-route > span { padding: 0 6px; color: var(--weak); }
.execution-item-bottom { margin-top: 2px; color: var(--weak); font-size: 10px; font-variant-numeric: tabular-nums; }
.execution-item-bottom > span:first-child > span { padding: 0 4px; }
.execution-open { color: var(--muted); white-space: nowrap; }
.execution-pagination { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.execution-pagination button { padding: 6px 10px; min-height: 30px; font-size: 10px; }
.execution-inspector { padding: 24px; min-height: 500px; }
.inspector-placeholder { display: grid; align-content: center; justify-items: center; gap: 16px; min-height: 410px; text-align: center; padding: 30px; }
.inspector-placeholder h2 { margin: 8px 0 0; color: var(--text-strong); font-size: 17px; font-weight: 500; }
.inspector-placeholder p { margin: 0; max-width: 310px; line-height: 1.9; color: var(--muted); font-size: 12px; }
.inspector-placeholder > span:last-child { margin-top: 12px; color: var(--weak); font-size: 10px; }
.placeholder-path { display: flex; align-items: center; }
.placeholder-path i { width: 12px; height: 12px; border: 1px solid var(--line-strong); border-radius: 50%; }
.placeholder-path i:nth-of-type(2) { background: var(--accent); border-color: var(--accent); }
.placeholder-path b { width: 40px; height: 1px; background: var(--line); }
.execution-detail-heading { margin-bottom: 20px; align-items: flex-start; }
.execution-id { display: block; margin-top: 7px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--weak); font-size: 10px; overflow-wrap: anywhere; }
.execution-outcome { display: flex; align-items: center; gap: 12px; font-size: 10px; color: var(--muted); flex-wrap: wrap; }
.execution-event-count { margin-left: auto; }
.execution-path { display: flex; flex-wrap: wrap; align-items: center; gap: 11px; margin: 24px 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.execution-path > strong { color: var(--text-strong); font-weight: 600; }
.execution-path > span[aria-hidden] { color: var(--weak); }
.execution-path small { display: block; margin-top: 5px; font-size: 10px; color: var(--weak); }
.execution-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(80px, 1.3fr); gap: 12px; padding: 17px 0; margin: 0 0 22px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.execution-facts > div { min-width: 0; }
.execution-facts dt { color: var(--muted); font-size: 10px; margin-bottom: 8px; }
.execution-facts dd { margin: 0; color: var(--text-strong); font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 500; }
.execution-facts .execution-session { font-size: 11px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.execution-response-summary { display: grid; gap: 15px; padding-bottom: 24px; }
.execution-response-summary > div { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 12px; }
.execution-response-summary > div > span { padding-top: 2px; color: var(--muted); font-size: 10px; line-height: 1.8; }
.execution-response-summary p { margin: 0; color: var(--text-strong); font-size: 12px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 140px; overflow: auto; }
.execution-response-summary > small { color: var(--weak); font-size: 10px; }
.timeline-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 22px; border-top: 1px solid var(--line); }
.timeline-heading > div { display: flex; align-items: baseline; gap: 12px; }
.timeline-heading h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-strong); }
.timeline-heading > div > span { color: var(--weak); font-size: 10px; }
.timeline-filters { display: flex; gap: 7px; flex-wrap: wrap; margin: 16px 0 24px; }
.timeline-filters label { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 5px; padding: 5px 7px; color: var(--muted); font-size: 10px; cursor: pointer; }
.timeline-filters label.active { background: var(--surface-soft); color: var(--text-strong); }
.timeline-filters input { margin: 0; width: 11px; height: 11px; accent-color: var(--accent); }
.timeline-filters small { font-size: 9px; color: var(--weak); }
.event-timeline { list-style: none; padding: 0; margin: 0 0 0 5px; }
.timeline-event { position: relative; border-left: 1px solid var(--line); padding: 0 0 0 20px; min-width: 0; }
.timeline-event:last-child { border-left-color: transparent; }
.timeline-node { position: absolute; left: -4px; top: 11px; width: 7px; height: 7px; border-radius: 50%; background: var(--surface-strong, #fff); border: 1px solid var(--line-strong); }
.node-llm { background: var(--text-strong); border-color: var(--text-strong); }
.node-tool { background: var(--accent); border-color: var(--accent); }
.event-failed .timeline-node { border-color: var(--accent); }
.event-disclosure { padding-bottom: 22px; }
.event-disclosure > summary { display: flex; justify-content: space-between; gap: 15px; cursor: pointer; list-style: none; padding: 3px 0 0; }
.event-disclosure > summary::-webkit-details-marker { display: none; }
.event-summary-main { display: grid; gap: 7px; min-width: 0; }
.event-title { display: flex; align-items: center; gap: 8px; color: var(--text-strong); font-size: 12px; font-weight: 500; }
.event-step { color: var(--weak); font-size: 9px; font-weight: 400; white-space: nowrap; }
.event-preview { color: var(--muted); font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.event-preview:empty { display: none; }
.event-type { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; color: var(--weak); overflow-wrap: anywhere; }
.event-timing { display: grid; justify-items: end; align-content: start; gap: 4px; flex-shrink: 0; font-size: 10px; color: var(--weak); font-variant-numeric: tabular-nums; padding-top: 1px; }
.event-timing small { font-size: 9px; }
.event-chevron { display: block; font-size: 14px; color: var(--muted); }
.event-disclosure[open] .event-chevron { transform: rotate(180deg); }
.event-content { margin: 14px 0 0; padding: 14px; background: var(--surface-soft, #F3F6FA); border: 1px solid var(--line); border-radius: 7px; min-width: 0; }
.event-content h4 { margin: 0 0 12px; color: var(--text-strong); font-size: 11px; font-weight: 500; }
.event-content .v3-event-data { margin: 10px 0; padding: 12px; max-height: 380px; color: var(--text-strong); background: var(--surface-strong, #fff); border: 1px solid var(--line); border-radius: 5px; font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; }
.event-metadata { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 14px; font-size: 10px; color: var(--muted); }
.event-metadata strong { padding-left: 4px; font-weight: 500; color: var(--text-strong); }
.message-disclosure { padding: 10px 0; border-top: 1px solid var(--line); }
.message-disclosure > summary { display: flex; gap: 10px; align-items: baseline; color: var(--muted); font-size: 10px; line-height: 1.6; cursor: pointer; }
.message-disclosure > summary > span:last-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
.message-role { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-strong); font-size: 10px; flex-shrink: 0; }
.event-raw { margin-top: 12px; }
.event-raw > summary { cursor: pointer; color: var(--muted); font-size: 10px; padding: 3px 0; }
.event-call-id { color: var(--weak); font-size: 9px; overflow-wrap: anywhere; }
.timeline-footer { border-top: 1px solid var(--line); padding-top: 18px; display: flex; justify-content: center; color: var(--weak); font-size: 10px; }
.execution-empty { display: grid; gap: 9px; margin: 0; padding: 32px 18px; color: var(--muted); font-size: 12px; line-height: 1.8; }
.execution-empty strong { font-weight: 500; color: var(--text-strong); }
.execution-empty p { margin: 0; }
@media (max-width: 1150px) { .execution-filters form { grid-template-columns: repeat(3, minmax(0, 1fr)); } .execution-workbench { grid-template-columns: 290px minmax(0, 1fr); gap: 16px; } .execution-inspector { padding: 20px; } .execution-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } .execution-facts > div:last-child { grid-column: 1 / -1; } }
@media (max-width: 900px) { .execution-workbench { grid-template-columns: 1fr; } .execution-registry { position: static; } .execution-list { min-height: 0; max-height: 340px; } .execution-inspector { min-height: 320px; } .inspector-placeholder { min-height: 270px; } .execution-list-item { gap: 7px; } .execution-list-item > strong { -webkit-line-clamp: 1; } .execution-facts { grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(80px, 1fr); } .execution-facts > div:last-child { grid-column: auto; } }
@media (max-width: 560px) { .execution-filters { padding: 16px; } .execution-filters form { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .execution-inspector { padding: 18px; } .execution-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } .execution-facts > div:last-child { grid-column: 1 / -1; } .execution-response-summary > div { grid-template-columns: 1fr; gap: 5px; } .timeline-heading > div { display: grid; gap: 6px; } .timeline-event { padding-left: 15px; } .event-content { padding: 10px; } .execution-outcome { gap: 9px; } .execution-event-count { margin-left: 0; } .event-disclosure > summary { gap: 9px; } .event-title { flex-wrap: wrap; } .inspector-placeholder { padding: 22px 8px; } }
</style>
