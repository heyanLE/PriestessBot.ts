<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import { randomId } from '../../utils/random-id';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { runtimeAction, runtimeRequest } from '../../api/typescript';
import { ContinuedConversationSchema, ConversationDetailSchema, ConversationExportSchema, ConversationListSchema, ConversationSchema, FolderListSchema, type Conversation, type ManagedFolder } from '../../../../typescript/packages/contracts/src/management';
import FolderTree from './FolderTree.vue';
import { ConfigSnapshotSchema, RunDetailSchema, type AgentDefinition } from '../../../../typescript/packages/contracts/src/index';
const route = useRoute(); const router = useRouter();
let initialized = false; let disposed = false; let selectionVersion = 0; let listVersion = 0;
const emit = defineEmits<{ 'inspect-run': [id: string]; 'open-chat': [id: string] }>();
const conversations = ref<Conversation[]>([]); const folders = ref<ManagedFolder[]>([]); const folder = ref('all'); const search = ref(''); const archived = ref(false); const selected = ref<ReturnType<typeof ConversationDetailSchema.parse>>(); const title = ref(''); const folderId = ref(''); const error = ref(''); const busyCount = ref(0); const busy = computed(() => busyCount.value > 0); const confirmDelete = ref(false);
const agents = ref<AgentDefinition[]>([]); const continuationAgent = ref(''); const continuationRequest = ref(randomId());
const draft = useUnsavedDraft('会话标题与分组', () => ({ title: title.value, folderId: folderId.value }));
const notice = ref('');
const filtered = computed(() => conversations.value.filter(c => folder.value === 'all' || c.folderId === (folder.value || null)));
async function load(): Promise<void> { const version = ++listVersion; const [data, tree, config] = await Promise.all([runtimeRequest(`conversations?archived=${archived.value}&search=${encodeURIComponent(search.value)}`, ConversationListSchema), runtimeRequest('folders?kind=conversation', FolderListSchema), runtimeRequest('config', ConfigSnapshotSchema)]); if (version !== listVersion) return; agents.value = config.config.agents.filter(a => a.enabled); if (!agents.value.some(a => a.id === continuationAgent.value)) continuationAgent.value = config.config.flow.routing.defaultAgentId; conversations.value = data.conversations; folders.value = tree.folders; }
async function act(fn: () => Promise<void>): Promise<void> { busyCount.value++; error.value = ''; try { await fn(); } catch(e) { error.value = e instanceof Error ? e.message : '操作失败'; } finally { busyCount.value--; } }
async function open(id: string): Promise<void> { if (busy.value || route.query.conversation === id) return; await router.push({ query: { ...route.query, conversation: id, run: undefined } }); }
async function syncRouteSelection(): Promise<void> {
  const version = ++selectionVersion;
  selected.value = undefined; title.value = ''; folderId.value = ''; draft.markSaved(); confirmDelete.value = false; notice.value = '';
  let id = typeof route.query.conversation === 'string' ? route.query.conversation : '';
  try {
    if (!id && typeof route.query.run === 'string') {
      const execution = await runtimeRequest(`runs/${encodeURIComponent(route.query.run)}`, RunDetailSchema);
      if (version !== selectionVersion) return;
      const all = await runtimeRequest('conversations?archived=all', ConversationListSchema);
      if (version !== selectionVersion) return;
      const matches = all.conversations.filter(item => item.sessionKey === execution.run.sessionKey && item.agentId === execution.run.agentId && item.generation === execution.run.generation);
      if (matches.length !== 1) throw new Error(matches.length ? '有多个会话与此运行关联，请通过搜索选择会话。' : '此运行没有可恢复的会话记录，可能尚未进入 Agent 或会话已删除。');
      id = matches[0]?.id ?? '';
    }
    if (!id) return;
    const data = await runtimeRequest(`conversations/${encodeURIComponent(id)}`, ConversationDetailSchema);
    if (version !== selectionVersion) return;
    selected.value = data; continuationRequest.value = randomId();
    if (agents.value.some(agent => agent.id === data.conversation.agentId)) continuationAgent.value = data.conversation.agentId;
    title.value = data.conversation.title; folderId.value = data.conversation.folderId ?? ''; draft.markSaved();
    archived.value = data.conversation.archived; search.value = ''; folder.value = 'all';
    await load();
  } catch (cause) { if (version === selectionVersion) throw cause; }
}
async function reloadCurrent(): Promise<void> {
  const current = selected.value?.conversation;
  if (busy.value || !current || !draft.confirmDiscard()) return;
  notice.value = '';
  const version = selectionVersion;
  await act(async () => {
    const data = await runtimeRequest(`conversations/${encodeURIComponent(current.id)}`, ConversationDetailSchema);
    if (version !== selectionVersion || selected.value?.conversation.id !== current.id) return;
    selected.value = data; title.value = data.conversation.title; folderId.value = data.conversation.folderId ?? ''; draft.markSaved();
    conversations.value = conversations.value.map(item => item.id === current.id ? data.conversation : item);
    confirmDelete.value = false; notice.value = '已重新载入当前会话的服务端版本，可以继续编辑。';
  });
}
async function continueHistory(): Promise<void> { if (busy.value || !draft.confirmDiscard()) return; const version = selectionVersion; await act(async () => { const current = selected.value?.conversation; if (!current) return; const result = await runtimeRequest(`conversations/${current.id}/continue`, ContinuedConversationSchema, { agentId: continuationAgent.value, expectedRevision: current.revision, requestId: continuationRequest.value }); if (version !== selectionVersion) return; draft.markSaved(); emit('open-chat', result.conversation.id); }); }
async function save(toggleArchive = false): Promise<void> {
  if (busy.value) return;
  if (toggleArchive && selected.value && !selected.value.conversation.archived && !confirmDestructiveAction('归档此会话并保存当前标题与分组？归档后需取消归档才能继续此会话。')) return;
  const version = selectionVersion;
  await act(async () => {
    const current = selected.value?.conversation; if (!current) return;
    await runtimeRequest(`conversations/${current.id}`, ConversationSchema, { title: title.value, folderId: folderId.value || null, archived: toggleArchive ? !current.archived : current.archived, expectedRevision: current.revision }, 'PUT');
    if (version !== selectionVersion) return;
    await load(); if (version !== selectionVersion) return;
    const data = await runtimeRequest(`conversations/${current.id}`, ConversationDetailSchema);
    if (version !== selectionVersion) return;
    selected.value = data; title.value = data.conversation.title; folderId.value = data.conversation.folderId ?? ''; draft.markSaved();
    notice.value = toggleArchive ? (data.conversation.archived ? '会话已归档。' : '会话已取消归档。') : '标题与分组已保存。';
  });
}
async function remove(): Promise<void> { if (busy.value) return; const version = selectionVersion; await act(async () => { const current = selected.value?.conversation; if (!current) return; await runtimeAction(`conversations/${current.id}`, { expectedRevision: current.revision }, 'DELETE'); if (version !== selectionVersion) return; selected.value = undefined; title.value = ''; folderId.value = ''; draft.markSaved(); confirmDelete.value = false; await load(); if (version === selectionVersion) notice.value = '会话已删除。'; }); }
async function cancel(): Promise<void> { if (!confirmDestructiveAction('停止此会话中正在执行和排队的任务？已完成的消息会保留。')) return; await act(async () => { if (selected.value) await runtimeAction(`conversations/${selected.value.conversation.id}/cancel`, {}); notice.value = '已提交停止请求。'; }); }
async function exportConversation(): Promise<void> { await act(async () => { if (!selected.value) return; const data = await runtimeRequest(`conversations/${selected.value.conversation.id}/export`, ConversationExportSchema); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `conversation-${data.conversation.id.slice(0,12)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }
onMounted(() => { void act(async () => { await load(); if (disposed || route.path !== '/sessions') return; initialized = true; await syncRouteSelection(); }); });
watch(() => [route.query.conversation, route.query.run], () => { if (initialized && route.path === '/sessions') void act(syncRouteSelection); }, { flush: 'sync' });
onBeforeUnmount(() => { disposed = true; selectionVersion++; listVersion++; });
</script>
<template><section class="management-workspace"><header><div><h2>会话管理</h2><p>先选择会话，再编辑标题与分组。修改单独保存；归档、删除和停止任务立即生效。</p></div><button :disabled="busy" @click="act(load)">刷新</button></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><div class="management-columns conversation-layout"><FolderTree v-model="folder" kind="conversation" @changed="act(load)"/><div class="management-list"><form class="actions" @submit.prevent="act(load)"><input v-model="search" placeholder="搜索标题、消息或发送者" aria-label="搜索会话"/><button :disabled="busy">搜索</button></form><label><select v-model="archived" @change="act(load)"><option :value="false">活跃会话</option><option :value="true">已归档</option></select></label><button v-for="item in filtered" :key="item.id" :class="{ selected: selected?.conversation.id === item.id }" :disabled="busy" @click="open(item.id)"><strong>{{ item.title }}</strong><small>{{ item.platform }} · {{ item.agentId }} · {{ new Date(item.updatedAt).toLocaleString() }}</small></button><p v-if="!filtered.length">暂无匹配的会话。可以清空搜索或切换归档筛选，也可以<RouterLink to="/chat">新建对话</RouterLink>。</p></div><div v-if="selected" class="management-editor"><form @submit.prevent="save()"><label>会话标题<input v-model="title" :disabled="busy" required maxlength="200"/></label><label>文件夹<select v-model="folderId" :disabled="busy"><option value="">未分组</option><option v-for="item in folders" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><p class="muted">{{ selected.conversation.sessionType==='group'?'群聊 · 共享公开对话':'私聊 · 独立对话' }} · {{ selected.conversation.sessionId }} · 第 {{ selected.conversation.generation + 1 }} 段历史</p><p class="muted" role="status">{{ draft.dirty.value ? '标题或分组尚未保存' : '标题与分组已保存' }}</p><div class="actions"><button :disabled="busy || !draft.dirty.value">保存标题与分组</button><button type="button" :disabled="busy" @click="reloadCurrent">重新载入当前会话</button><button type="button" :disabled="busy" @click="save(true)">{{ selected.conversation.archived ? '取消归档' : '归档' }}</button><button type="button" :disabled="busy" @click="exportConversation">导出</button><button v-if="selected.conversation.platform === 'dashboard' && !selected.conversation.archived" type="button" @click="emit('open-chat', selected.conversation.id)">继续聊天</button></div></form><p v-if="selected.conversation.continuedFrom" class="muted">历史来源：<button @click="open(selected.conversation.continuedFrom.conversationId)">{{ selected.conversation.continuedFrom.title }}</button></p><div v-if="selected.entries.length" class="continuation-panel"><p>从这段历史新建控制台会话，保留原会话。历史以带来源的对话载入，不会恢复旧权限或重放工具操作。</p><label>续接 Agent<select v-model="continuationAgent" :disabled="busy"><option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.displayName }} · {{ agent.id }}</option></select></label><button :disabled="busy || !continuationAgent" @click="continueHistory">从历史继续</button><p v-if="!agents.length">先到 <RouterLink to="/agents">Agent</RouterLink> 创建并启用一个 Agent。</p></div><p v-if="selected.conversation.recovered" class="muted">这是一条从旧执行记录恢复的会话；没有原始消息的历史不会补造。</p><div class="transcript" role="log"><article v-for="entry in selected.entries" :key="entry.id" class="entry" :class="entry.role"><small>{{ entry.senderName || entry.senderId }} · {{ new Date(entry.timestamp).toLocaleString() }}</small><template v-for="(part, index) in entry.parts" :key="index"><p v-if="part.type === 'text'">{{ part.text }}</p><p v-else-if="part.type === 'file'">附件：{{ part.name }}</p><p v-else-if="part.type === 'image'">[图片]</p><div v-else-if="part.type === 'quote'" class="quoted-message"><small>引用 {{part.senderName || part.senderId || '未知发送者'}} · {{part.messageId}}</small><p>{{part.text || '原消息无文字'}}</p><p v-if="part.attachments?.length">{{part.attachments.map(item=>item.type==='image'?'[引用图片]':`[引用文件：${item.name}]`).join(' ')}}</p><small v-if="part.availability==='partial'||part.availability==='unavailable'">引用内容不完整或部分附件不可用</small></div><p v-else-if="part.type === 'mention'">@{{ part.name || part.userId }}</p><p v-else-if="part.type === 'reference'">{{ part.label }}</p></template></article><p v-if="!selected.entries.length">此会话暂无可恢复的消息正文。</p></div><details><summary>执行记录（{{ selected.runIds.length }}）</summary><div class="actions"><button v-for="id in selected.runIds" :key="id" @click="emit('inspect-run', id)">{{ id.slice(0, 8) }}</button></div></details><div class="actions"><button :disabled="busy" @click="cancel">停止此会话任务</button><button v-if="!confirmDelete" :disabled="busy" @click="confirmDelete = true">删除会话…</button><template v-else><span>将删除消息记录并取消任务。</span><button :disabled="busy" @click="remove">确认删除</button><button @click="confirmDelete = false">取消</button></template></div></div><div v-else class="management-editor empty" role="status">{{ busy ? '正在读取会话…' : '选择会话查看完整记录。' }}</div></div></section></template>
<style scoped src="./management.css"></style>
