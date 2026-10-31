<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useUnsavedDraft } from '../../composables/unsaved';
import { WorkspaceEnvironmentListSchema, WorkspaceListSchema, WorkspaceTextSchema, type WorkspaceEntry } from '../../../../typescript/packages/contracts/src/operator';
import { runtimeRequest, runtimeAction, downloadRuntimeFile } from '../../api/typescript';
const environments = ref<ReturnType<typeof WorkspaceEnvironmentListSchema.parse>['environments']>([]);
const environmentId = ref(''); const directory = ref(''); const entries = ref<WorkspaceEntry[]>([]); const selected = ref<WorkspaceEntry>(); const preview = ref(''); const error = ref(''); const notice = ref(''); const busy = ref(false); const folderName = ref(''); const moveTo = ref(''); const confirmingDelete = ref(false); const truncated = ref(false);
const folderDraft = useUnsavedDraft('新建工作文件夹', () => folderName.value);
const moveDraft = useUnsavedDraft('文件移动路径', () => moveTo.value);
const breadcrumbs = computed(() => directory.value.split('/').filter(Boolean).map((name, index, all) => ({ name, path: all.slice(0, index + 1).join('/') })));
function endpoint(action = '', file = directory.value): string { return `files${action ? `/${action}` : ''}?${new URLSearchParams({ environmentId: environmentId.value, path: file })}`; }
async function perform(operation: () => Promise<void>) { busy.value = true; error.value = ''; notice.value = ''; try { await operation(); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; } }
function clearSelection() { selected.value = undefined; preview.value = ''; confirmingDelete.value = false; moveTo.value = ''; moveDraft.markSaved(); }
async function refresh(resetSelection = true) { if (!environmentId.value) return; const result = await runtimeRequest(endpoint(), WorkspaceListSchema); entries.value = result.entries; directory.value = result.path; truncated.value = result.truncated; if (resetSelection) clearSelection(); }
async function navigate(value: string) { if (!folderDraft.confirmDiscard() || !moveDraft.confirmDiscard()) return; folderName.value = ''; folderDraft.markSaved(); directory.value = value; entries.value = []; clearSelection(); await perform(refresh); }
async function changeEnvironment(event: Event) { if (!(event.target instanceof HTMLSelectElement)) return; const select = event.target; if (!folderDraft.confirmDiscard() || !moveDraft.confirmDiscard()) { select.value = environmentId.value; return; } environmentId.value = select.value; folderName.value = ''; folderDraft.markSaved(); directory.value = ''; entries.value = []; clearSelection(); await perform(refresh); }
async function refreshDirectory() { if (!moveDraft.confirmDiscard()) return; await perform(refresh); }
function select(entry: WorkspaceEntry) { if (!moveDraft.confirmDiscard()) return; selected.value = entry; moveTo.value = entry.path; preview.value = ''; confirmingDelete.value = false; moveDraft.markSaved(); }
async function newFolder() { if (!folderName.value.trim()) return; await perform(async () => { await runtimeAction(endpoint('mkdir', [directory.value, folderName.value.trim()].filter(Boolean).join('/')), {}); folderName.value = ''; folderDraft.markSaved(); await refresh(false); notice.value = '文件夹已创建。'; }); }
async function upload(event: Event) { if (!(event.target instanceof HTMLInputElement)) return; const file = event.target.files?.[0]; if (!file) return; await perform(async () => { if (file.size > 10_000_000) throw new Error('文件不能超过 10 MB'); const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] ?? '') : reject(new Error('无法读取文件')); reader.onerror = () => reject(new Error('无法读取文件')); reader.readAsDataURL(file); }); await runtimeAction(endpoint('upload', [directory.value, file.name].filter(Boolean).join('/')), { content }); await refresh(false); notice.value = '上传完成，同名文件不会被覆盖。'; }); event.target.value = ''; }
async function showPreview() { const entry = selected.value; if (!entry) return; await perform(async () => { const result = await runtimeRequest(endpoint('read', entry.path), WorkspaceTextSchema); preview.value = result.text; }); }
async function download() { const entry = selected.value; if (entry) await perform(() => downloadRuntimeFile(endpoint('download', entry.path), entry.name)); }
async function move() { const entry = selected.value; if (!entry) return; await perform(async () => { await runtimeAction(endpoint('move', entry.path), { to: moveTo.value }); await refresh(); notice.value = '已移动。'; }); }
async function remove() { const entry = selected.value; if (!entry || !confirmingDelete.value) return; await perform(async () => { await runtimeAction(endpoint('', entry.path), undefined, 'DELETE'); await refresh(); notice.value = '已删除。'; }); }
onMounted(() => { void perform(async () => { environments.value = (await runtimeRequest('files/environments', WorkspaceEnvironmentListSchema)).environments; environmentId.value = environments.value[0]?.id ?? ''; await refresh(); }); });
</script>
<template>
<section class="panel ts-fields">
  <div class="section-title"><div><h2>工作目录</h2><p>管理已配置执行环境的文件和文件夹。最多上传/下载 10 MB，非空文件夹不能直接删除。创建、上传和移动提交后立即生效；删除需要确认。</p></div><button :disabled="busy || !environmentId" @click="refreshDirectory">刷新目录</button></div>
  <p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="notice" class="notice ok" role="status">{{notice}}</p>
  <p v-if="!environments.length" class="empty-state">尚未配置执行环境，请先到 <RouterLink to="/execution?section=settings">环境配置</RouterLink> 添加工作根目录。</p>
  <template v-else>
    <label>执行环境<select :value="environmentId" :disabled="busy" @change="changeEnvironment"><option v-for="environment in environments" :key="environment.id" :value="environment.id">{{environment.id}} · {{environment.type}} · {{environment.root}}</option></select></label>
    <nav class="toolbar" aria-label="工作目录路径"><button :disabled="busy" @click="navigate('')">根目录</button><button v-for="part in breadcrumbs" :key="part.path" :disabled="busy" @click="navigate(part.path)">{{part.name}}</button></nav>
    <div class="file-actions"><form class="toolbar" @submit.prevent="newFolder"><label>新建文件夹<input v-model="folderName" required placeholder="文件夹名称" :disabled="busy"></label><button :disabled="busy">创建文件夹</button></form><label>上传文件<input type="file" :disabled="busy" @change="upload"></label></div>
    <p v-if="truncated" class="notice">当前目录超过 1000 个条目，仅显示前 1000 个。</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>类型</th><th>大小</th><th>操作</th></tr></thead><tbody><tr v-for="entry in entries" :key="entry.path"><td><button :disabled="busy || entry.kind==='symlink' || entry.kind==='other'" @click="entry.kind==='directory'?navigate(entry.path):select(entry)">{{entry.kind==='directory'?'▸ ':''}}{{entry.name}}</button></td><td>{{entry.kind==='directory'?'文件夹':entry.kind==='file'?'文件':entry.kind==='symlink'?'符号链接（不可操作）':'其他'}}</td><td>{{entry.kind==='file'?`${(entry.size/1024).toFixed(1)} KB`:'—'}}</td><td><button v-if="entry.kind==='directory' || entry.kind==='file'" :disabled="busy" @click="select(entry)">管理</button></td></tr></tbody></table></div>
    <p v-if="!entries.length" class="empty-state">这是一个空文件夹。使用上方“创建文件夹”或“上传文件”添加内容。</p>
    <section v-if="selected" class="card ts-fields"><h3>{{selected.name}}</h3><div class="toolbar"><button v-if="selected.kind==='file'" :disabled="busy" @click="showPreview">预览文本</button><button v-if="selected.kind==='file'" :disabled="busy" @click="download">下载</button><button class="danger" :disabled="busy" @click="confirmingDelete=!confirmingDelete">删除</button></div><div v-if="confirmingDelete" class="notice"><p>确认删除 {{selected.path}}？此操作无法撤销；文件夹必须为空。</p><button class="danger" :disabled="busy" @click="remove">确认删除</button><button @click="confirmingDelete=false">取消</button></div><form class="toolbar" @submit.prevent="move"><label>重命名 / 移动到（相对根目录）<input v-model="moveTo" required :disabled="busy"></label><button :disabled="busy || moveTo===selected.path">移动</button></form><p v-if="moveDraft.dirty.value" class="muted">新路径尚未应用，点击“移动”生效。</p><pre v-if="preview" class="code-block">{{preview}}</pre></section>
  </template>
</section>
</template>
<style scoped>.file-actions{display:flex;justify-content:space-between;gap:20px;align-items:end;flex-wrap:wrap}.file-actions label{font-size:13px}.table td>button{max-width:100%;overflow-wrap:anywhere}.notice button{margin:8px 8px 0 0}pre{max-height:400px}</style>
