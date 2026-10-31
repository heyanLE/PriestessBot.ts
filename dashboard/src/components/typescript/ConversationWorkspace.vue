<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import { randomId } from '../../utils/random-id';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { runtimeAction, runtimeRequest } from '../../api/typescript';
import { ContinuedConversationSchema, ConversationDetailSchema, ConversationExportSchema, ConversationListSchema, ConversationSchema, type Conversation } from '../../../../packages/contracts/src/management';
import { conversationFiltersFromQuery, filterConversations, conversationOrigin } from './conversation-workspace-model';
import { ConfigSnapshotSchema, RunDetailSchema, type AgentDefinition } from '../../../../packages/contracts/src/index';
const route = useRoute(); const router = useRouter();
let initialized = false; let disposed = false; let selectionVersion = 0; let listVersion = 0;
const emit = defineEmits<{ 'inspect-run': [id: string]; 'open-chat': [id: string] }>();
const conversations = ref<Conversation[]>([]); const filters = ref(conversationFiltersFromQuery(route.query)); const search = ref(filters.value.search); const selected = ref<ReturnType<typeof ConversationDetailSchema.parse>>(); const title = ref(''); const error = ref(''); const busyCount = ref(0); const busy = computed(() => busyCount.value > 0); const confirmDelete = ref(false);
const agents = ref<AgentDefinition[]>([]); const platforms = ref<{id:string;label:string}[]>([]);
const enabledAgents = computed(() => agents.value.filter(agent=>agent.enabled)); const continuationAgent = ref(''); const continuationRequest = ref(randomId());
const draft = useUnsavedDraft('会话标题', () => title.value);
const notice = ref('');
const filtered = computed(() => filterConversations(conversations.value, filters.value));
const platformOptions = computed(() => { const options=new Map(platforms.value.map(item=>[item.id,item.label])); for(const item of conversations.value)if(!options.has(item.platform))options.set(item.platform,`${conversationOrigin(item)} · ${item.platform}`); if(filters.value.platform&&!options.has(filters.value.platform))options.set(filters.value.platform,filters.value.platform); return [...options].map(([id,label])=>({id,label})); });
const agentOptions = computed(() => { const options=new Map<string,string>(agents.value.map(item=>[item.id,item.displayName])); for(const item of conversations.value)if(item.agentId&&!options.has(item.agentId))options.set(item.agentId,item.agentId); if(filters.value.agentId&&!options.has(filters.value.agentId))options.set(filters.value.agentId,filters.value.agentId); return [...options].map(([id,label])=>({id,label})); });
function agentName(id:string):string{return agents.value.find(item=>item.id===id)?.displayName || id || '未分配 Agent';}
function platformName(conversation:Conversation):string{return platforms.value.find(item=>item.id===conversation.platform)?.label || (conversation.platform==='dashboard'?'控制台':`${conversationOrigin(conversation)} · ${conversation.platform}`);}
async function applyFilters(reset=false):Promise<void>{if(reset){filters.value=conversationFiltersFromQuery({});search.value='';} const value=filters.value; const previous=route.fullPath; const failure=await router.replace({query:{...route.query,platform:value.platform||undefined,sessionType:value.sessionType==='all'?undefined:value.sessionType,sessionId:value.sessionId||undefined,agent:value.agentId||undefined,archived:value.archived==='all'?undefined:value.archived,search:search.value.trim()||undefined}});if(failure){filters.value=conversationFiltersFromQuery(route.query);search.value=filters.value.search;}else if(previous===route.fullPath)await act(load);}
function formatTime(value:number):string{return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(value);}
async function load(): Promise<void> {
  const version = ++listVersion;
  const [data, config] = await Promise.all([runtimeRequest(`conversations?archived=all&search=${encodeURIComponent(search.value.trim())}`, ConversationListSchema), runtimeRequest('config', ConfigSnapshotSchema)]);
  if (version !== listVersion || disposed) return;
  agents.value = config.config.agents;
  platforms.value = config.config.platforms.map(item=>({id:item.id,label:`${item.type==='napcat'?'QQ / NapCat':item.type==='telegram'?'Telegram':'微信'} · ${item.displayName||item.id}`}));
  if (!enabledAgents.value.some(a => a.id === continuationAgent.value)) continuationAgent.value = enabledAgents.value.find(a=>a.id===config.config.flow.routing.defaultAgentId)?.id ?? enabledAgents.value[0]?.id ?? '';
  conversations.value = data.conversations;
}
async function act(fn: () => Promise<void>): Promise<void> { busyCount.value++; error.value = ''; try { await fn(); } catch(e) { error.value = e instanceof Error ? e.message : '操作失败'; } finally { busyCount.value--; } }
async function open(id: string): Promise<void> { if (busy.value || route.query.conversation === id) return; await router.push({ query: { ...route.query, conversation: id, run: undefined } }); }
async function syncRouteSelection(): Promise<void> {
  const version = ++selectionVersion;
  selected.value = undefined; title.value = ''; draft.markSaved(); confirmDelete.value = false; notice.value = '';
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
    title.value = data.conversation.title; draft.markSaved();

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
    selected.value = data; title.value = data.conversation.title; draft.markSaved();
    conversations.value = conversations.value.map(item => item.id === current.id ? data.conversation : item);
    confirmDelete.value = false; notice.value = '已重新载入当前会话的服务端版本，可以继续编辑。';
  });
}
async function continueHistory(): Promise<void> { if (busy.value || !draft.confirmDiscard()) return; const version = selectionVersion; await act(async () => { const current = selected.value?.conversation; if (!current) return; const result = await runtimeRequest(`conversations/${current.id}/continue`, ContinuedConversationSchema, { agentId: continuationAgent.value, expectedRevision: current.revision, requestId: continuationRequest.value }); if (version !== selectionVersion) return; draft.markSaved(); emit('open-chat', result.conversation.id); }); }
async function save(toggleArchive = false): Promise<void> {
  if (busy.value) return;
  if (toggleArchive && selected.value && !selected.value.conversation.archived && !confirmDestructiveAction('归档此会话并保存当前标题？归档后需取消归档才能继续此会话。')) return;
  const version = selectionVersion;
  await act(async () => {
    const current = selected.value?.conversation; if (!current) return;
    await runtimeRequest(`conversations/${current.id}`, ConversationSchema, { title: title.value, folderId: current.folderId, archived: toggleArchive ? !current.archived : current.archived, expectedRevision: current.revision }, 'PUT');
    if (version !== selectionVersion) return;
    await load(); if (version !== selectionVersion) return;
    const data = await runtimeRequest(`conversations/${current.id}`, ConversationDetailSchema);
    if (version !== selectionVersion) return;
    selected.value = data; title.value = data.conversation.title; draft.markSaved();
    notice.value = toggleArchive ? (data.conversation.archived ? '会话已归档。' : '会话已取消归档。') : '会话标题已保存。';
  });
}
async function remove(): Promise<void> { if (busy.value) return; const version = selectionVersion; await act(async () => { const current = selected.value?.conversation; if (!current) return; await runtimeAction(`conversations/${current.id}`, { expectedRevision: current.revision }, 'DELETE'); if (version !== selectionVersion) return; selected.value = undefined; title.value = ''; draft.markSaved(); confirmDelete.value = false; await load(); if (version === selectionVersion) notice.value = '会话已删除。'; }); }
async function cancel(): Promise<void> { if (!confirmDestructiveAction('停止此会话中正在执行和排队的任务？已完成的消息会保留。')) return; await act(async () => { if (selected.value) await runtimeAction(`conversations/${selected.value.conversation.id}/cancel`, {}); notice.value = '已提交停止请求。'; }); }
async function exportConversation(): Promise<void> { await act(async () => { if (!selected.value) return; const data = await runtimeRequest(`conversations/${selected.value.conversation.id}/export`, ConversationExportSchema); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `conversation-${data.conversation.id.slice(0,12)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }
onMounted(() => { void act(async () => { await load(); if (disposed || route.path !== '/sessions') return; initialized = true; await syncRouteSelection(); }); });
watch([() => route.query.platform, () => route.query.sessionType, () => route.query.sessionId, () => route.query.agent, () => route.query.archived, () => route.query.search], () => { filters.value=conversationFiltersFromQuery(route.query);search.value=filters.value.search; if(initialized&&route.path==='/sessions')void act(load); });
watch([() => route.query.conversation, () => route.query.run], () => { if (initialized && route.path === '/sessions') void act(syncRouteSelection); }, { flush: 'sync' });
onBeforeUnmount(() => { disposed = true; selectionVersion++; listVersion++; });
</script>
<template>
<section class="management-workspace conversation-workspace">
  <header><div><h2>全部平台会话</h2><p>统一查看 QQ / NapCat、Telegram、微信和控制台的聊天记录。修改标题单独保存。</p></div><div class="actions"><RouterLink class="button-link" to="/route-records">查看路由记录</RouterLink><button :disabled="busy" @click="act(load)">刷新会话</button></div></header>
  <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
  <form class="conversation-filters" @submit.prevent="applyFilters()"><label>平台实例<select v-model="filters.platform" :disabled="busy" @change="applyFilters()"><option value="">全部平台</option><option v-for="item in platformOptions" :key="item.id" :value="item.id">{{item.label}}</option></select></label><label>会话类型<select v-model="filters.sessionType" :disabled="busy" @change="applyFilters()"><option value="all">群聊与私聊</option><option value="group">仅群聊</option><option value="private">仅私聊</option></select></label><label>Agent<select v-model="filters.agentId" :disabled="busy" @change="applyFilters()"><option value="">全部 Agent</option><option v-for="item in agentOptions" :key="item.id" :value="item.id">{{item.label}}</option></select></label><label>记录状态<select v-model="filters.archived" :disabled="busy" @change="applyFilters()"><option value="all">全部会话</option><option value="active">活跃会话</option><option value="archived">已归档</option></select></label><label>会话 ID<input v-model="filters.sessionId" placeholder="精确匹配群号或私聊 ID" :disabled="busy"/></label><label class="conversation-search">关键词<input v-model="search" placeholder="搜索标题、消息或发送者" aria-label="搜索会话" :disabled="busy"/></label><div class="actions"><button :disabled="busy">搜索</button><button type="button" :disabled="busy" @click="applyFilters(true)">清空筛选</button></div></form>
  <div class="conversation-flat-layout"><aside class="management-list conversation-list" aria-label="会话列表"><div class="conversation-list-label"><strong>{{filtered.length}} 条匹配会话</strong><small>已读取 {{conversations.length}} 条</small></div><button v-for="item in filtered" :key="item.id" :class="{selected:selected?.conversation.id===item.id}" :disabled="busy" @click="open(item.id)"><strong>{{item.title}}</strong><span class="conversation-badges"><span>{{conversationOrigin(item)}}</span><span>{{item.sessionType==='group'?'群聊':'私聊'}}</span><span v-if="item.archived">已归档</span></span><small>{{agentName(item.agentId)}} · {{item.sessionId}}</small><small>{{formatTime(item.updatedAt)}}</small></button><div v-if="!filtered.length" class="conversation-empty"><p>{{conversations.length?'当前筛选没有匹配的会话。请清空筛选，或选择其他平台。':'尚未读取到会话。先确认机器人已连接并收到消息。'}}</p><RouterLink to="/route-records">检查消息是否进入路由</RouterLink><RouterLink to="/chat">新建控制台对话</RouterLink></div></aside>
  <div v-if="selected" class="management-editor conversation-detail"><form @submit.prevent="save()"><label>会话标题<input v-model="title" :disabled="busy" required maxlength="200"/></label><p class="muted">{{platformName(selected.conversation)}} · {{selected.conversation.sessionType==='group'?'群聊 · 共享公开对话':'私聊 · 独立对话'}} · {{selected.conversation.sessionId}}</p><p class="muted">{{agentName(selected.conversation.agentId)}} · 第 {{selected.conversation.generation+1}} 段历史</p><p class="muted" role="status">{{draft.dirty.value?'标题尚未保存':'标题已保存'}}</p><div class="actions"><button :disabled="busy || !draft.dirty.value">保存标题</button><button type="button" :disabled="busy" @click="reloadCurrent">重新载入当前会话</button><button type="button" :disabled="busy" @click="save(true)">{{selected.conversation.archived?'取消归档':'归档'}}</button><button type="button" :disabled="busy" @click="exportConversation">导出会话</button><button v-if="selected.conversation.platform==='dashboard'&&!selected.conversation.archived" type="button" @click="emit('open-chat',selected.conversation.id)">继续聊天</button></div></form>
    <nav class="actions" aria-label="关联记录"><RouterLink class="button-link" :to="{path:'/route-records',query:{platform:selected.conversation.platform,sessionType:selected.conversation.sessionType,sessionId:selected.conversation.sessionId}}">此会话的路由记录</RouterLink><RouterLink class="button-link" :to="{path:'/agent-records',query:{platform:selected.conversation.platform,sessionType:selected.conversation.sessionType,sessionId:selected.conversation.sessionId,agentId:selected.conversation.agentId}}">此会话的 Agent 记录</RouterLink></nav>
    <p v-if="selected.conversation.platform!=='dashboard'" class="muted">这是 IM 平台会话。回复请在对应平台发送；也可以从历史新建控制台对话。</p>
    <p v-if="selected.conversation.continuedFrom" class="muted">历史来源：<button @click="open(selected.conversation.continuedFrom.conversationId)">{{selected.conversation.continuedFrom.title}}</button></p>
    <details v-if="selected.entries.length" class="continuation-panel"><summary>从这段历史继续</summary><p>新建控制台会话并保留原记录。不恢复旧权限，也不重放工具操作。</p><label>续接 Agent<select v-model="continuationAgent" :disabled="busy"><option v-for="agent in enabledAgents" :key="agent.id" :value="agent.id">{{agent.displayName}} · {{agent.id}}</option></select></label><button :disabled="busy||!continuationAgent" @click="continueHistory">从历史继续</button><p v-if="!enabledAgents.length">先到 <RouterLink to="/agents">Agent</RouterLink> 创建并启用一个 Agent。</p></details>
    <p v-if="selected.conversation.recovered" class="muted">此会话从旧记录恢复。没有保存的消息正文不会补造。</p>
    <div class="transcript" role="log" aria-label="会话消息"><article v-for="entry in selected.entries" :key="entry.id" class="entry" :class="entry.role"><small>{{entry.senderName || entry.senderId}} · {{formatTime(entry.timestamp)}}</small><template v-for="(part,index) in entry.parts" :key="index"><p v-if="part.type==='text'">{{part.text}}</p><p v-else-if="part.type==='file'">附件：{{part.name}}</p><p v-else-if="part.type==='image'">[图片]</p><div v-else-if="part.type==='quote'" class="quoted-message"><small>引用 {{part.senderName || part.senderId || '未知发送者'}} · {{part.messageId}}</small><p>{{part.text || '原消息无文字'}}</p><p v-if="part.attachments?.length">{{part.attachments.map(item=>item.type==='image'?'[引用图片]':`[引用文件：${item.name}]`).join(' ')}}</p><small v-if="part.availability==='partial'||part.availability==='unavailable'">引用内容不完整或部分附件不可用</small></div><p v-else-if="part.type==='mention'">@{{part.name || part.userId}}</p><p v-else-if="part.type==='reference'">{{part.label}}</p></template></article><p v-if="!selected.entries.length">此会话暂无已保存的消息正文。</p></div>
    <details><summary>关联处理记录（{{selected.runIds.length}}）</summary><div class="actions"><button v-for="id in selected.runIds" :key="id" @click="emit('inspect-run',id)">{{id.slice(0,8)}}</button></div></details>
    <div class="actions"><button :disabled="busy" @click="cancel">停止此会话任务</button><button v-if="!confirmDelete" :disabled="busy" @click="confirmDelete=true">删除会话…</button><template v-else><span>将删除消息记录并取消任务。</span><button :disabled="busy" @click="remove">确认删除</button><button @click="confirmDelete=false">取消</button></template></div>
  </div><div v-else class="management-editor empty" role="status">{{busy?'正在读取会话…':'选择一条会话，查看消息和关联记录。'}}</div></div>
</section>
</template>
<style scoped src="./management.css"></style>
<style scoped>
.conversation-workspace{padding:0}.conversation-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 24px}.conversation-filters .conversation-search{grid-column:span 2}.conversation-filters .actions{align-items:end}.conversation-flat-layout{display:grid;grid-template-columns:minmax(245px,330px) minmax(0,1fr);gap:24px;align-items:start}.conversation-list{max-height:72vh;overflow:auto;padding-right:5px}.conversation-list-label{display:flex;justify-content:space-between;gap:12px;padding:0 0 10px;font-size:13px}.conversation-badges{display:flex;flex-wrap:wrap;gap:7px;font-size:11px;color:var(--accent-ink)}.conversation-badges>span{padding:2px 6px;background:var(--accent-soft);border-radius:4px}.conversation-list>button{padding:14px}.conversation-list>button>strong{font-size:14px;overflow-wrap:anywhere}.conversation-empty{display:grid;gap:12px;font-size:13px;padding:18px 0}.conversation-detail form{display:grid;gap:12px}.conversation-detail{border-radius:8px}.conversation-detail .continuation-panel{border-top:1px solid var(--line);padding-top:15px}.conversation-detail .continuation-panel summary{font-size:13px;cursor:pointer}.conversation-detail .continuation-panel>label{margin:14px 0}.conversation-detail .transcript{max-height:65vh}.conversation-detail .actions a{font-size:12px}.conversation-detail>nav{padding-bottom:16px;border-bottom:1px solid var(--line)}@media(max-width:1000px){.conversation-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.conversation-filters .conversation-search{grid-column:auto}.conversation-flat-layout{grid-template-columns:245px minmax(0,1fr)}.conversation-detail{grid-column:auto}}@media(max-width:760px){.conversation-flat-layout{grid-template-columns:1fr}.conversation-list{max-height:340px;overflow:auto}.conversation-detail{grid-column:1}.conversation-filters{grid-template-columns:1fr 1fr}.conversation-filters .conversation-search{grid-column:1/-1}.conversation-filters>.actions{grid-column:1/-1}.conversation-workspace header{align-items:flex-start}.conversation-workspace h2{font-size:20px}}
</style>
