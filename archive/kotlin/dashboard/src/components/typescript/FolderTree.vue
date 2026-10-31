<script setup lang="ts">
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import { computed, onMounted, ref } from 'vue';
import { runtimeAction, runtimeRequest } from '../../api/typescript';
import { FolderListSchema, FolderSchema, type FolderKind, type ManagedFolder } from '../../../../typescript/packages/contracts/src/management';
const props = defineProps<{ kind: FolderKind; modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; changed: [] }>();
const folders = ref<ManagedFolder[]>([]); const editing = ref<ManagedFolder>(); const name = ref(''); const parentId = ref(''); const form = ref(false); const error = ref(''); const busy = ref(false);
const notice = ref('');
const draft = useUnsavedDraft('文件夹编辑', () => ({ name: name.value, parentId: parentId.value }));
const rows = computed(() => { const result: { folder: ManagedFolder; depth: number }[] = []; const visit = (parent: string | null, depth: number): void => { for (const folder of folders.value.filter(f => f.parentId === parent)) { result.push({ folder, depth }); visit(folder.id, depth + 1); } }; visit(null, 0); return result; });
const parentOptions = computed(() => rows.value.filter(row => { let current: ManagedFolder | undefined = row.folder; const visited = new Set<string>(); while(current) { if(current.id === editing.value?.id || visited.has(current.id)) return false; visited.add(current.id); const parent: string | null = current.parentId; current = folders.value.find(folder => folder.id === parent); } return true; }));
function close(): void { if(!draft.confirmDiscard()) return; form.value=false;name.value='';parentId.value='';draft.markSaved(); }
async function load(): Promise<void> { folders.value = (await runtimeRequest(`folders?kind=${props.kind}`, FolderListSchema)).folders; }
function begin(folder?: ManagedFolder): void { if(busy.value || !draft.confirmDiscard()) return; editing.value = folder; name.value = folder?.name ?? ''; parentId.value = folder?.parentId ?? (props.modelValue === 'all' ? '' : props.modelValue); form.value = true; error.value = ''; notice.value = ''; draft.markSaved(); }
async function save(): Promise<void> { busy.value = true; error.value = ''; try { const item = editing.value; const data = { name: name.value, kind: props.kind, parentId: parentId.value || null }; await runtimeRequest(item ? `folders/${item.id}` : 'folders', FolderSchema, item ? { ...data, expectedRevision: item.revision } : data, item ? 'PUT' : 'POST'); form.value = false; name.value = ''; parentId.value = ''; draft.markSaved(); await load(); notice.value = '文件夹已保存。'; emit('changed'); } catch(e) { error.value = e instanceof Error ? e.message : '保存失败'; } finally { busy.value = false; } }
async function remove(): Promise<void> { if (!editing.value || !confirmDestructiveAction(`删除空文件夹“${editing.value.name}”？删除后无法撤销；包含内容的文件夹不会被删除。`)) return; busy.value = true; error.value = ''; try { await runtimeAction(`folders/${editing.value.id}`, { expectedRevision: editing.value.revision }, 'DELETE'); if (props.modelValue === editing.value.id) emit('update:modelValue', 'all'); form.value = false; name.value = ''; parentId.value = ''; draft.markSaved(); await load(); notice.value = '空文件夹已删除。'; emit('changed'); } catch(e) { error.value = e instanceof Error ? e.message : '删除失败'; } finally { busy.value = false; } }
onMounted(() => { void load().catch(e => { error.value = e instanceof Error ? e.message : '加载失败'; }); });
</script>
<template>
  <nav class="folders" aria-label="文件夹">
    <div class="folder-heading"><strong>文件夹</strong><button type="button" :disabled="busy" @click="begin()">＋ 新建</button></div>
    <button type="button" :class="{ active: modelValue === 'all' }" @click="emit('update:modelValue', 'all')">全部</button>
    <button type="button" :class="{ active: modelValue === '' }" @click="emit('update:modelValue', '')">未分组</button>
    <div v-for="row in rows" :key="row.folder.id" class="folder-row" :style="{ paddingLeft: `${row.depth * 12}px` }"><button type="button" :class="{ active: modelValue === row.folder.id }" @click="emit('update:modelValue', row.folder.id)">▱ {{ row.folder.name }}</button><button type="button" :aria-label="`编辑文件夹 ${row.folder.name}`" @click="begin(row.folder)">⋯</button></div>
    <form v-if="form" @submit.prevent="save"><label>名称<input v-model="name" :disabled="busy" required maxlength="120" /></label><label>父文件夹<select v-model="parentId" :disabled="busy"><option value="">根目录</option><option v-for="row in parentOptions" :key="row.folder.id" :value="row.folder.id">{{ '　'.repeat(row.depth) }}{{ row.folder.name }}</option></select></label><p role="status">{{draft.dirty.value?'文件夹修改尚未保存':'文件夹独立保存，保存后立即生效'}}</p><div class="folder-actions"><button :disabled="busy || !name.trim()">保存文件夹</button><button type="button" :disabled="busy" @click="close">取消</button><button v-if="editing" type="button" :disabled="busy" @click="remove">删除空文件夹</button></div></form>
    <p v-if="notice" role="status">{{ notice }}</p><p v-if="error" role="alert" class="error">{{ error }}</p>
  </nav>
</template>
<style scoped>
.folders{display:flex;flex-direction:column;gap:6px;min-width:170px}.folder-heading,.folder-row,.folder-actions{display:flex;gap:6px;align-items:center}.folder-heading{justify-content:space-between;margin-bottom:8px}.folder-row>button:first-child{flex:1;text-align:left}button{border:1px solid var(--border,#d9e5dd);background:var(--surface,#fff);color:inherit;border-radius:8px;padding:7px 10px;cursor:pointer}.active{background:#e5f2e9;border-color:#70a78a;color:#285c43}form{padding:10px;border:1px solid #d9e5dd;border-radius:8px;display:grid;gap:8px}label{display:grid;gap:4px;font-size:12px}input,select{min-width:0;width:100%;box-sizing:border-box;border:1px solid #cbded0;border-radius:6px;padding:7px;background:#fff}.folder-actions{flex-wrap:wrap}.error{color:#a13b36;font-size:12px;overflow-wrap:anywhere}
</style>
