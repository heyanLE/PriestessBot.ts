<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ModelPayloadListSchema, type ModelPayloadDocument } from '../../../../packages/contracts/src/model-records';
import type { AuditPreview as Preview } from '../../../../packages/contracts/src/audit';
import { downloadRuntimeFile, runtimeRequest, runtimeText } from '../../api/typescript';
import AuditPreview from './AuditPreview.vue';
import RawModelPayloadViewer from './RawModelPayloadViewer.vue';
import { preferredModelDocument, rawPayloadFilename } from './raw-model-payload';
const props = defineProps<{ runId: string; callId: string; status: string; active: boolean; legacyInput?: Preview | null; legacyOutput?: Preview | null }>();
const documents = ref<ModelPayloadDocument[]>([]); const legacy = ref(false); const manualSelection = ref(false); const selectedId = ref(''); const text = ref<string>();
const loading = ref(false); const reading = ref(false); const downloading = ref(false); const error = ref(''); const loadedRevision = ref('');
let version = 0; let readVersion = 0; let listController: AbortController | undefined; let readController: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false;
const route = computed(() => `agent-records/${encodeURIComponent(props.runId)}/model-calls/${encodeURIComponent(props.callId)}`);
const selected = computed(() => documents.value.find(item => item.id === selectedId.value));
const hasProvider = computed(() => documents.value.some(item => item.kind.startsWith('provider_')));
const revision = (item: ModelPayloadDocument): string => `${item.id}:${item.status}:${item.updatedAt}:${item.bytes}`;
const newer = computed(() => !!selected.value && text.value !== undefined && revision(selected.value) !== loadedRevision.value);
const labels: Readonly<Record<ModelPayloadDocument['kind'], string>> = { provider_request: '实际发送请求', provider_response: '实际收到响应', sdk_request: 'SDK 输入', sdk_response: 'SDK 输出' };
function title(item: ModelPayloadDocument): string { return `${labels[item.kind]}${item.kind.startsWith('provider_') ? ` · 第 ${item.attempt} 次传输` : ''}`; }
function stopTimer(): void { if (timer) clearTimeout(timer); timer = undefined; }
function schedule(): void { stopTimer(); if (props.active && !disposed && (props.status === 'started' || documents.value.some(item => item.status === 'writing'))) timer = setTimeout(() => { void load(false); }, 1500); }
function sameTarget(id: string, callId: string): boolean { return !disposed && props.active && props.runId === id && props.callId === callId; }
async function load(showLoading = true): Promise<void> {
  if (!props.active || disposed) return; const currentVersion = ++version; const runId = props.runId; const callId = props.callId; listController?.abort(); const controller = new AbortController(); listController = controller;
  if (showLoading) loading.value = true; error.value = '';
  try {
    const result = await runtimeRequest(route.value,ModelPayloadListSchema,undefined,'GET',controller.signal);
    if (currentVersion !== version || !sameTarget(runId,callId)) return;
    documents.value = result.documents; legacy.value = result.legacy;
    const preferred = preferredModelDocument(documents.value);
    if (!documents.value.some(item => item.id === selectedId.value) || !manualSelection.value && preferred?.id !== selectedId.value) {
      selectedId.value = preferred?.id ?? '';
    } else if (selected.value && (text.value === undefined || selected.value.status === 'complete' && newer.value)) await read();
  } catch (cause) { if (currentVersion === version && sameTarget(runId,callId) && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '模型数据列表读取失败。请重试。'; }
  finally { if (currentVersion === version) { loading.value = false; schedule(); } }
}
async function read(): Promise<void> {
  const item = selected.value; if (!item || !props.active || disposed) return;
  const currentVersion = ++readVersion; const runId = props.runId; const callId = props.callId; const documentId = item.id; const savedRevision = revision(item); readController?.abort(); const controller = new AbortController(); readController = controller;
  reading.value = true; error.value = '';
  try {
    const content = await runtimeText(`${route.value}/${encodeURIComponent(documentId)}`,controller.signal);
    if (currentVersion !== readVersion || !sameTarget(runId,callId) || documentId !== selectedId.value) return;
    text.value = content; loadedRevision.value = savedRevision;
  } catch (cause) { if (currentVersion === readVersion && sameTarget(runId,callId) && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '模型原文读取失败。请重试。'; }
  finally { if (currentVersion === readVersion) reading.value = false; }
}
async function download(): Promise<void> {
  const item = selected.value; if (!item || downloading.value) return; downloading.value = true; error.value = '';
  try { await downloadRuntimeFile(`${route.value}/${encodeURIComponent(item.id)}?download=1`,rawPayloadFilename(item.kind,item.attempt,item.contentType)); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '原文下载失败。请重试。'; }
  finally { downloading.value = false; }
}
watch(selectedId,() => { text.value = undefined; loadedRevision.value = ''; void read(); });
watch([() => props.runId,() => props.callId],() => { version++; readVersion++; listController?.abort(); readController?.abort(); stopTimer(); documents.value = []; manualSelection.value = false; selectedId.value = ''; text.value = undefined; loadedRevision.value = ''; legacy.value = false; if (props.active) void load(); });
watch(() => props.active,value => { if (value) void load(); else { version++; readVersion++; listController?.abort(); readController?.abort(); stopTimer(); loading.value = false; reading.value = false; } },{ immediate: true });
watch(() => props.status,() => { if (props.active) void load(false); });
onBeforeUnmount(() => { disposed = true; version++; readVersion++; listController?.abort(); readController?.abort(); stopTimer(); });
</script>
<template><section class="raw-model-call" aria-label="完整模型请求与响应"><header><h4>完整模型请求与响应</h4><button type="button" :disabled="loading" @click="load()">{{loading?'正在读取…':'刷新模型数据'}}</button></header><p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="loading&&!documents.length" class="raw-call-note" role="status">正在读取此调用的数据列表…</p>
  <template v-if="documents.length"><div class="raw-call-toolbar"><label>查看内容<select v-model="selectedId" @change="manualSelection=true"><option v-for="item in documents" :key="item.id" :value="item.id">{{title(item)}}{{item.status==='writing'?' · 正在保存':item.status==='failed'?' · 保存未完成':''}}</option></select></label><button type="button" :disabled="!selected||downloading" @click="download">{{downloading?'正在下载…':'下载原文'}}</button></div><template v-if="selected"><div class="raw-call-meta"><span>{{selected.bytes.toLocaleString('zh-CN')}} 字节</span><span>{{selected.contentType}}</span><span v-if="selected.httpStatus">HTTP {{selected.httpStatus}}</span><span>{{selected.status==='complete'?'已完整保存':selected.status==='writing'?'正在保存':'保存未完成'}}</span></div><p v-if="selected.kind.startsWith('sdk_')" class="raw-call-note">这是 SDK 层的数据。<span v-if="hasProvider">实际 HTTP 请求与响应可在上方另选查看。</span><span v-else>此调用尚无 HTTP 正文记录。</span></p><p v-if="selected.kind==='provider_request'" class="raw-call-note">这是 SDK 实际发送的请求正文，包含完整提示词、上下文和工具定义。</p><p v-if="selected.status==='failed'" class="notice error">{{selected.error||'原文保存未完成。这里只能查看已保存的内容。'}}</p><p v-else-if="selected.status==='writing'" class="raw-call-note">此响应仍在保存。任务结束后会自动更新。</p><button v-if="newer" type="button" :disabled="reading" @click="read">读取新增内容</button><p v-if="reading" class="raw-call-note" role="status">正在读取原文…</p><RawModelPayloadViewer v-if="text!==undefined" :key="selected.id" :text="text" :content-type="selected.contentType" :title="title(selected)" :complete="selected.status==='complete'&&!newer"/></template></template>
  <template v-else-if="!loading"><p class="raw-call-note">{{status==='started'?'请求开始后，这里会显示完整数据。':legacy?'此调用没有保存完整原文。旧预览中已省略的内容无法补回。':'此调用暂无可读取的原文。'}}</p><details v-if="legacy&&(legacyInput||legacyOutput)" class="raw-call-legacy"><summary>查看历史预览（不是完整原文）</summary><AuditPreview title="历史模型输入预览" :preview="legacyInput"/><AuditPreview title="历史模型输出预览" :preview="legacyOutput"/></details></template>
</section></template>
<style scoped>
.raw-model-call{display:grid;gap:13px;min-width:0}.raw-model-call>header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.raw-model-call h4{margin:0;font-size:14px}.raw-model-call button{font-size:11px;padding:5px 10px;background:var(--surface);justify-self:start}.raw-call-note{margin:0;color:var(--muted);font-size:11px;line-height:1.8}.raw-call-toolbar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.raw-call-toolbar>label{display:grid;gap:6px;font-size:11px;color:var(--muted);min-width:0;flex:1}.raw-call-toolbar select{width:100%;font-size:12px;padding:8px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:5px}.raw-call-meta{display:flex;gap:6px 15px;flex-wrap:wrap;font-size:10px;color:var(--muted)}.raw-call-legacy{display:grid;gap:15px}.raw-call-legacy>summary{font-size:12px;color:var(--muted);margin-bottom:12px;cursor:pointer}.raw-call-legacy :deep(.audit-preview){margin-top:15px}
</style>
