<script setup lang="ts">
import { randomId } from '../utils/random-id';
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import QRCode from 'qrcode';
import { PhFlowArrow, PhRobot, PhBooks, PhChatsCircle, PhPlugsConnected, PhList, PhArrowClockwise, PhTerminalWindow, PhHouse, PhGear, PhShieldCheck, PhPuzzlePiece, PhStack, PhBrain } from '@phosphor-icons/vue';
import { ConfigSnapshotSchema, ConfigValidationSchema, FlowSimulationSchema, KnowledgeResponseSchema, KnowledgeSearchResponseSchema, MemoriesResponseSchema, MessageEventSchema, PlatformsResponseSchema, RunsResponseSchema, RuntimeConfigSchema, WeixinQrSessionSchema, runtimeStateLabels, type RuntimeConfig, type FlowSimulation, type MemoryRecord, type KnowledgeDocument, type KnowledgeHit, type ContentPart, type MessageEvent } from '../../../packages/contracts/src/index';
import { authorizeRuntime, runtimeRequest, runtimeAction, RUNTIME_AUTH_EXPIRED_EVENT, RuntimeRequestError } from '../api/typescript';
import JobsPanel from '../components/typescript/JobsPanel.vue';
import ExecutionOperations from '../components/typescript/ExecutionOperations.vue';
import FlowEditor from '../components/typescript/FlowEditor.vue';
import ConfigurationEditor from '../components/typescript/ConfigurationEditor.vue';
import ResourceEditor from '../components/typescript/ResourceEditor.vue';
import { runtimeNavigation, runtimeDomains, runtimeAreaLinks, runtimeDomainFor, areaLinkActive, matchesRuntimeNavigation } from '../components/typescript/navigation';
const AgentWorkbench = defineAsyncComponent(() => import('../components/typescript/AgentWorkbench.vue'));
const PlatformWorkbench = defineAsyncComponent(() => import('../components/typescript/PlatformWorkbench.vue'));
const CapabilityLibrary = defineAsyncComponent(() => import('../components/typescript/CapabilityLibrary.vue'));
const RouteRecordsWorkspace = defineAsyncComponent(() => import('../components/typescript/RouteRecordsWorkspace.vue'));
const AgentRecordsWorkspace = defineAsyncComponent(() => import('../components/typescript/AgentRecordsWorkspace.vue'));
import { AgentRecordsResponseSchema } from '../../../packages/contracts/src/observability';
import { resolveRunRecordDestination } from '../components/typescript/run-record-navigation';
import type { AgentWorkbenchSavePayload, AgentWorkbenchBindingDraft } from '../components/typescript/AgentWorkbench.types';
import { AgentWorkbenchSavedSchema } from '../../../packages/contracts/src/agent-workbench';
import { PersonaListSchema, type PersonaBinding } from '../../../packages/contracts/src/management';
import PersonaWorkspace from '../components/typescript/PersonaWorkspace.vue';
import ConversationWorkspace from '../components/typescript/ConversationWorkspace.vue';
import PersistentChat from '../components/typescript/PersistentChat.vue';
import PluginWorkspace from '../components/typescript/PluginWorkspace.vue';
import SearchSettings from '../components/typescript/SearchSettings.vue';
import { PluginToolCatalogueSchema } from '../../../packages/contracts/src/plugins';
import NativeExtensionsPanel from '../components/typescript/NativeExtensionsPanel.vue';
import MemoryMaintenancePanel from '../components/typescript/MemoryMaintenancePanel.vue';
import WorkspaceFilesPanel from '../components/typescript/WorkspaceFilesPanel.vue';
import OperatorSettings from '../components/typescript/OperatorSettings.vue';
import { ExtensionsResponseSchema } from '../../../packages/contracts/src/extensions';
import { ManagementSessionSchema } from '../../../packages/contracts/src/operator';
import WorkflowGuide from '../components/typescript/WorkflowGuide.vue';
import { runtimeConfigSignature, changedConfigPages, mergeRuntimeConfig, rebaseAgentSave, agentPublicationChanges, parseEditorConfiguration } from '../utils/workflow-model';
import { useUnsavedDraft, unsavedDrafts, confirmUnsavedDrafts, confirmDestructiveAction } from '../composables/unsaved';
import '../styles/typescript.css';
import '../styles/dashboard-workspace.css';
const router = useRouter(); const route = useRoute();
const tab = computed(() => runtimeNavigation.find(item => item.path === route.path)?.id ?? 'welcome');
const navigationQuery = ref('');
const visibleNavigation = computed(() => runtimeNavigation.filter(item => matchesRuntimeNavigation(item, navigationQuery.value)));
const pageHeading = ref<HTMLElement>();
const icons = {plugins:PhPuzzlePiece,search:PhBooks,personas:PhRobot,conversations:PhChatsCircle,files:PhBooks,welcome:PhHouse,chat:PhChatsCircle,platforms:PhPlugsConnected,providers:PhStack,agents:PhRobot,extensions:PhPuzzlePiece,permissions:PhShieldCheck,knowledge:PhBooks,memories:PhBrain,flow:PhFlowArrow,runs:PhChatsCircle,execution:PhTerminalWindow,settings:PhGear,resources:PhBooks,tools:PhPuzzlePiece,routeRecords:PhFlowArrow};
const domainIcons = {workbench:PhHouse,agents:PhRobot,platforms:PhChatsCircle,resources:PhBooks,settings:PhGear};
const currentPage = computed(() => runtimeNavigation.find(item=>item.id===tab.value));
const configurationSection = computed(() => tab.value==='permissions'?'grants':undefined);
const resourceSection = computed(() => tab.value==='providers'?'connections':tab.value==='extensions'?'extensions':undefined);
const activeSection = computed(() => tab.value === 'extensions' ? extensionTab.value : tab.value === 'execution' ? environmentTab.value : tab.value === 'knowledge' || tab.value === 'memories' ? libraryTab.value : '');
const activeDomain = computed(() => runtimeDomainFor(tab.value, activeSection.value));
const activeDomainItem = computed(() => runtimeDomains.find(item => item.id === activeDomain.value));
const areaLinks = computed(() => runtimeAreaLinks[activeDomain.value]);
const toolsArea = computed(() => ['tools','search','plugins','extensions'].includes(tab.value));
const libraryTab = ref<'content'|'settings'|'maintenance'>('content');
const extensionTab = ref<'resources'|'native'>('resources');
const extraToolOptions=ref<{id:string;label:string;detail:string}[]>([]);
async function refreshExtensionTools(){const [result,plugins]=await Promise.all([runtimeRequest('extensions',ExtensionsResponseSchema),runtimeRequest('plugins/tools',PluginToolCatalogueSchema)]);extraToolOptions.value=[...plugins.tools,...result.extensions.flatMap(extension=>[...extension.manifest.tools,...extension.manifest.commands].map(operation=>({id:operation.name,label:`${extension.manifest.name} · ${operation.name}`,detail:operation.description})))];}
const environmentTab = ref<'processes'|'settings'>('processes');
const mobileQuery=window.matchMedia('(max-width: 760px)');const isMobile=ref(mobileQuery.matches);function updateMobile(event:MediaQueryListEvent){isMobile.value=event.matches;if(!event.matches)mobileNav.value=false;}mobileQuery.addEventListener('change',updateMobile);
const mobileNav = ref(false); const token = ref(''); const connected = ref(false); const sessionExpired = ref(false); const busyCount = ref(0); const busy = computed(() => busyCount.value > 0); const error = ref(''); const notice = ref(''); const configConflict = ref(false);
const config = ref<RuntimeConfig>(); const publishedConfig = ref<RuntimeConfig>(); const revision = ref(0); const baseline = ref(''); const dirty = computed(() => !!config.value && runtimeConfigSignature(config.value) !== baseline.value);
const modifiedPages = computed(() => config.value && publishedConfig.value ? changedConfigPages(publishedConfig.value, config.value) : []);
const modifiedLabels = computed(() => runtimeNavigation.filter(item => modifiedPages.value.includes(item.id)).map(item => item.label));
const selectedTitle = computed(() => tab.value==='agents' ? (typeof route.query.agent==='string'?config.value?.agents.find(item=>item.id===route.query.agent)?.displayName ?? '找不到此 Agent':config.value?.agents[0]?.displayName ?? 'Agent') : tab.value==='execution' ? environmentTab.value==='settings'?'执行环境':'后台进程' : currentPage.value?.label ?? '工作台');
const showGlobalDraft = computed(() => configConflict.value || dirty.value && (tab.value!=='agents' || modifiedPages.value.some(page=>page!=='agents')));
const savedAgentBinding = ref<PersonaBinding>(); const agentBindingDraft = ref<AgentWorkbenchBindingDraft>();
interface ReviewBase { config: RuntimeConfig; revision: number; active: number; paused: number; labels: string[]; }
type PublicationReview = ReviewBase & ({ kind: 'global' } | { kind: 'agent'; payload: AgentWorkbenchSavePayload });
const publicationReview = ref<PublicationReview>(); const publicationDialog = ref<HTMLDialogElement>();
const rollbackRevision = ref(0); const simulation = ref<FlowSimulation>(); const sample = ref('你好，介绍一下你能做什么'); const mentionBot=ref(false); const senderId = ref('local'); const sessionId = ref('dashboard'); const sessionType=ref<MessageEvent['sessionType']>('private'); const platformId = ref('dashboard');
const runs = ref<ReturnType<typeof RunsResponseSchema.parse>['runs']>([]);
const platformStatuses = ref<ReturnType<typeof PlatformsResponseSchema.parse>['platforms']>([]); const weixinId = ref(''); const qr = ref<ReturnType<typeof WeixinQrSessionSchema.parse>>(); const qrImage = ref('');
const jobRefresh=ref(0);
const memories = ref<MemoryRecord[]>([]); const documents = ref<KnowledgeDocument[]>([]); const hits = ref<KnowledgeHit[]>([]); const memoryLibrary = ref(''); const knowledgeLibrary = ref(''); const memoryText = ref(''); const editingMemoryId=ref(''); const editingMemoryText=ref(''); const memoryScope = ref<MemoryRecord['scope']>('sender'); const memoryAgent = ref(''); const query = ref('');
const newMemoryDraft = useUnsavedDraft('新增记忆', () => memoryText.value, '/memories');
const memoryEditDraft = useUnsavedDraft('记忆编辑', () => editingMemoryText.value, '/memories');
const memoryListScope = ref<'all'|'selected'>('all');
const visibleMemories = computed(() => memoryListScope.value === 'all' ? memories.value : memories.value.filter(item => item.agentId === memoryAgent.value && item.principal.platform === platformId.value && item.principal.sessionId === sessionId.value && item.principal.senderId === senderId.value && (item.principal.sessionType ?? 'private') === sessionType.value));
let simulationGeneration=0;
const host = window.location.host;
const statusLabels: Readonly<Record<string,string>> = { disabled:'未启用', starting:'连接中', connected:'已连接', error:'连接失败', stopped:'已停止', pending:'等待扫码', scanned:'已扫码，等待确认', confirmed:'登录成功', expired:'二维码已过期', failed:'失败', indexing:'索引中', ready:'可检索', queued:'排队中', running:'执行中', paused:'等待审批', completed:'已完成', cancelled:'已取消', interrupted:'已中断' };
function canReplaceConfiguration(keepAgentEdits=false):boolean{const edits=unsavedDrafts.value.filter(item=>!keepAgentEdits||item.page!=='/agents');if(!edits.length)return true;error.value=`还有独立编辑未保存：${edits.map(item=>item.label).join('、')}。请先保存或取消这些编辑。`;return false;}

async function action(fn: () => Promise<void>) { busyCount.value++; error.value=''; notice.value=''; try { await fn(); } catch (cause) { error.value=cause instanceof Error ? cause.message : String(cause); } finally { busyCount.value--; } }
function install(snapshot: ReturnType<typeof ConfigSnapshotSchema.parse>) { const first=publishedConfig.value===undefined;config.value=snapshot.config; publishedConfig.value=RuntimeConfigSchema.parse(snapshot.config); revision.value=snapshot.revision; baseline.value=runtimeConfigSignature(snapshot.config);configConflict.value=false;if(first||!snapshot.config.agents.some(item=>item.id===memoryAgent.value))memoryAgent.value=snapshot.config.flow.routing.defaultAgentId;if(first||!snapshot.config.memoryLibraries.some(item=>item.id===memoryLibrary.value))memoryLibrary.value=snapshot.config.memoryLibraries[0]?.id??'';if(first||!snapshot.config.knowledgeLibraries.some(item=>item.id===knowledgeLibrary.value))knowledgeLibrary.value=snapshot.config.knowledgeLibraries[0]?.id??''; rollbackRevision.value=Math.max(0,snapshot.revision-1);memories.value=[];documents.value=[];hits.value=[]; }
async function loadRuntime() { install(await runtimeRequest('config',ConfigSnapshotSchema)); connected.value=true; await Promise.all([refreshRuns(),refreshPlatforms(),refreshExtensionTools()]); if(tab.value==='memories'&&memoryLibrary.value)await refreshMemories(); if(tab.value==='knowledge'&&knowledgeLibrary.value)await refreshKnowledge(); }
async function connect() { await action(async()=>{ authorizeRuntime(token.value); try { await runtimeRequest('auth/login',ManagementSessionSchema,{}); } finally { authorizeRuntime(''); } token.value='';sessionExpired.value=false; if(!connected.value)await loadRuntime();notice.value=connected.value && (dirty.value || unsavedDrafts.value.length)?'已重新登录。当前草稿已保留。':''; }); }
async function disconnect() { if(!confirmUnsavedDrafts(undefined,dirty.value?['运行配置']:[]))return; await action(async()=>{try{await runtimeAction('auth/logout',{});}catch(cause){if(!(cause instanceof RuntimeRequestError)||cause.status!==401)throw cause;}authorizeRuntime('');connected.value=false;sessionExpired.value=false;config.value=undefined;publishedConfig.value=undefined;runs.value=[];platformStatuses.value=[];memories.value=[];documents.value=[];hits.value=[];extraToolOptions.value=[];qr.value=undefined;qrImage.value='';memoryText.value='';editingMemoryText.value='';editingMemoryId.value='';newMemoryDraft.markSaved();memoryEditDraft.markSaved();}); }
async function openChat(id:string){await router.push({path:'/chat',query:{conversation:id}});}
onMounted(()=>{void action(async()=>{const session=await runtimeRequest('auth/session',ManagementSessionSchema);if(session.authenticated)await loadRuntime();});});
async function reload() { if(!canReplaceConfiguration())return;if(dirty.value&&!confirmDestructiveAction('放弃全部未保存的运行配置，载入服务端版本？独立保存的数据不受此操作影响。'))return; await action(async()=>{ install(await runtimeRequest('config',ConfigSnapshotSchema)); simulation.value=undefined; notice.value='已载入服务端配置。'; }); }
async function validate() { await action(async()=>{ if(!config.value)return; const result=await runtimeRequest('config/validate',ConfigValidationSchema,{config:parseEditorConfiguration(config.value)}); if(!result.valid)throw new Error(result.issues.join('\n')); notice.value='配置校验通过，可以发布。'; }); }
async function confirmPublication(always=false, operation='发布运行配置'): Promise<boolean> {
  const latest = (await runtimeRequest('runs', RunsResponseSchema)).runs;
  const active = latest.filter(item => item.status === 'running' || item.status === 'queued').length;
  const paused = latest.filter(item => item.status === 'paused').length;
  return !always && !(active || paused) || confirmDestructiveAction(`${operation}？当前有 ${active} 个运行/排队任务，${paused} 个等待审批任务。应用配置会中断活动任务，并使旧审批失效。`);
}
async function activeTaskCounts(): Promise<{ active: number; paused: number }> {
  const current = (await runtimeRequest('runs', RunsResponseSchema)).runs;
  return { active: current.filter(item => item.status === 'running' || item.status === 'queued').length, paused: current.filter(item => item.status === 'paused').length };
}
async function publish() {
  if (!canReplaceConfiguration()) return;
  await action(async () => {
    if (!config.value) return;
    const value = parseEditorConfiguration(config.value);
    const validation = await runtimeRequest('config/validate', ConfigValidationSchema, { config: value });
    if (!validation.valid) throw new Error(validation.issues.join('\n'));
    publicationReview.value = { kind: 'global', config: value, revision: revision.value, labels: [...modifiedLabels.value], ...await activeTaskCounts() };
  });
}
async function saveAgent(payload: AgentWorkbenchSavePayload): Promise<void> {
  await action(async () => {
    if (!config.value || !publishedConfig.value) return;
    const agent = config.value.agents.find(item => item.id === payload.agentId);
    if (!agent) throw new Error('目标 Agent 已不存在。');
    const candidate = parseEditorConfiguration({ ...publishedConfig.value, agents: publishedConfig.value.agents.some(item => item.id === agent.id) ? publishedConfig.value.agents.map(item => item.id === agent.id ? agent : item) : [...publishedConfig.value.agents, agent] });
    const validation = await runtimeRequest('config/validate', ConfigValidationSchema, { config: candidate });
    if (!validation.valid) throw new Error(`此 Agent 引用了未保存或无效的资源。请先保存或修正下列资源。\n${validation.issues.join('\n')}`);
    const personas = await runtimeRequest('personas', PersonaListSchema);
    const personaName = personas.personas.find(item=>item.id===payload.personaId)?.name;
    const labels = [`Agent：${agent.displayName}`, ...agentPublicationChanges(publishedConfig.value.agents.find(item=>item.id===agent.id), agent), payload.personaId ? `人格：${personaName ?? payload.personaId}` : '人格：当前 Agent 的独立设定'];
    publicationReview.value = { kind: 'agent', payload, config: candidate, revision: revision.value, labels, ...await activeTaskCounts() };
  });
}
function closePublication(): void { if (!busy.value) publicationReview.value = undefined; }
async function commitPublication(): Promise<void> {
  const review = publicationReview.value;
  if (!review) return;
  await action(async () => {
    if (!config.value || !publishedConfig.value) return;
    const counts = await activeTaskCounts();
    if (counts.active > review.active || counts.paused > review.paused) { publicationReview.value = { ...review, ...counts }; throw new Error('出现了新的活动任务。请检查更新后的影响范围，再确认发布。'); }
    try {
      if (review.kind === 'global') {
        install(await runtimeRequest('config', ConfigSnapshotSchema, { expectedRevision: review.revision, config: review.config }, 'PUT'));
        notice.value = '运行配置已发布并应用。';
      } else {
        const agent = review.config.agents.find(item => item.id === review.payload.agentId);
        if (!agent) throw new Error('目标 Agent 已不存在。');
        const result = await runtimeRequest(`agents/${encodeURIComponent(agent.id)}/workbench`, AgentWorkbenchSavedSchema, { agent, personaId: review.payload.personaId, expectedRevision: review.revision, expectedBindingRevision: review.payload.expectedBindingRevision }, 'PUT');
        const remaining = rebaseAgentSave(publishedConfig.value, config.value, result.config, agent.id);
        install(result); config.value = remaining.config; savedAgentBinding.value = result.binding;
        notice.value = `${agent.displayName} 与人格绑定已一起发布。${remaining.conflicts.length ? '其余草稿有冲突，请在发布前核对。' : '其他页面及 Agent 的未发布修改已保留。'}`;
        configConflict.value = remaining.conflicts.length > 0;
      }
    } catch (cause) { if (cause instanceof RuntimeRequestError && cause.status === 409) configConflict.value = true; throw cause; }
    publicationReview.value = undefined;
    await Promise.all([refreshPlatforms(), refreshRuns()]);
  });
}
watch(publicationReview, async value => { await nextTick(); const dialog = publicationDialog.value; if (!dialog) return; if (value && !dialog.open) dialog.showModal(); else if (!value && dialog.open) dialog.close(); });
function showPlatformCapabilities(_platformId: string, type: string): void { void router.push({ path: '/tools', query: { platform: type } }); }

async function mergeLatest() { if(!canReplaceConfiguration(true))return;await action(async()=>{ if(!config.value || !publishedConfig.value)return;const latest=await runtimeRequest('config',ConfigSnapshotSchema);const result=mergeRuntimeConfig(publishedConfig.value,config.value,latest.config);const currentAgent=typeof route.query.agent==='string'?route.query.agent:config.value.agents[0]?.id;if(tab.value==='agents'&&currentAgent&&!result.config.agents.some(item=>item.id===currentAgent)&&unsavedDrafts.value.some(item=>item.page==='/agents'))throw new Error('当前 Agent 已从服务端删除。当前输入已保留。请先复制测试输入并取消人格修改，再载入最新配置。');if(result.conflicts.length){configConflict.value=true;throw new Error(`以下部分双方都修改过：${runtimeNavigation.filter(item=>result.conflicts.includes(item.id)).map(item=>item.label).join('、')}。当前草稿已保留，请先导出草稿，再对照最新配置处理。`);}install(latest);config.value=result.config;configConflict.value=false;notice.value='已合并互不冲突的修改；检查草稿后保存配置。';}); }
async function rollback() { if(!canReplaceConfiguration())return;await action(async()=>{ if(!await confirmPublication(true,`恢复 r${rollbackRevision.value} 并发布为新修订`))return;install(await runtimeRequest('config/rollback',ConfigSnapshotSchema,{revision:rollbackRevision.value,expectedRevision:revision.value})); notice.value='历史配置已恢复为新修订。'; }); }
function downloadDraft() { if(!config.value)return; const url=URL.createObjectURL(new Blob([JSON.stringify(config.value,null,2)],{type:'application/json'})); const link=document.createElement('a'); link.href=url; link.download=`priestess-draft-r${revision.value}.json`; link.click(); URL.revokeObjectURL(url); notice.value='草稿已导出。'; }
async function importDraft(event:Event) { if(!(event.target instanceof HTMLInputElement))return; const file=event.target.files?.[0]; if(!file)return;if(!canReplaceConfiguration()){event.target.value='';return;} if(dirty.value&&!confirmDestructiveAction('导入会替换当前未保存的运行配置，继续？')){event.target.value='';return;} if(file.size>5*1024*1024){error.value='配置文件不能超过 5 MiB。';event.target.value='';return;}await action(async()=>{ const raw:unknown=JSON.parse(await file.text()); config.value=parseEditorConfiguration(raw); notice.value='草稿已载入，尚未发布。'; }); }
function message(text:string,parts:ContentPart[]=[]) { const platform=config.value?.platforms.find(item=>item.id===platformId.value); return MessageEventSchema.parse({platform:platformId.value,platformType:platform?.type ?? 'telegram',sessionId:sessionId.value,sessionType:sessionType.value,senderId:senderId.value,senderName:'控制台',messageId:randomId(),timestamp:Date.now(),parts:[{type:'text',text},...(sessionType.value==='group'&&mentionBot.value?[{type:'mention',userId:'dashboard'}]:[]),...parts],botId:'dashboard'}); }
async function simulate() { await action(async()=>{ if(!config.value)return; const request=simulationGeneration;const result=await runtimeRequest('flow/simulate',FlowSimulationSchema,{config:parseEditorConfiguration(config.value),message:message(sample.value)});if(request===simulationGeneration)simulation.value=result; }); }
async function refreshRuns() { runs.value=(await runtimeRequest('agent-records?limit=50',AgentRecordsResponseSchema)).records; }
async function openJobRun(id:string){await action(async()=>{await router.push(await resolveRunRecordDestination(id));});}
async function refreshPlatforms() { platformStatuses.value=(await runtimeRequest('platforms',PlatformsResponseSchema)).platforms; }
async function startQr() { await action(async()=>{qr.value=await runtimeRequest(`platforms/${encodeURIComponent(weixinId.value)}/qr`,WeixinQrSessionSchema,{});qrImage.value=await QRCode.toDataURL(qr.value.qrUrl,{width:240,margin:2,color:{dark:'#2d281f',light:'#fffdf7'}});}); }
async function loginWeixin(id:string) { weixinId.value=id; await startQr(); }
async function pollQr() { if(!qr.value)return; await action(async()=>{qr.value=await runtimeRequest(`platforms/${encodeURIComponent(weixinId.value)}/qr/${encodeURIComponent(qr.value?.id ?? '')}`,WeixinQrSessionSchema);await refreshPlatforms();}); }
async function refreshMemories() { const id=memoryLibrary.value;const result=await runtimeRequest(`memory?libraryId=${encodeURIComponent(id)}`,MemoriesResponseSchema);if(id===memoryLibrary.value)memories.value=result.memories; }
async function saveMemory() { await action(async()=>{const agent=publishedConfig.value?.agents.find(item=>item.id===memoryAgent.value);if(!agent)throw new Error('请先创建 Agent');await runtimeAction('memory',{libraryId:memoryLibrary.value,agentId:agent.id,principal:{platform:platformId.value,senderId:senderId.value,sessionId:sessionId.value,sessionType:sessionType.value},scope:memoryScope.value,text:memoryText.value,source:'dashboard',confidence:1});memoryText.value='';newMemoryDraft.markSaved();await refreshMemories();notice.value='记忆已保存。';}); }
function editMemory(memory:MemoryRecord){if(!memoryEditDraft.confirmDiscard())return;editingMemoryId.value=memory.id;editingMemoryText.value=memory.text;memoryEditDraft.markSaved();}
function cancelMemoryEdit(){if(!memoryEditDraft.confirmDiscard())return;editingMemoryId.value='';editingMemoryText.value='';memoryEditDraft.markSaved();}
async function changeMemoryLibrary(event:Event){if(!(event.target instanceof HTMLSelectElement))return;if(!confirmUnsavedDrafts('/memories')){event.target.value=memoryLibrary.value;return;}memoryLibrary.value=event.target.value;memoryText.value='';editingMemoryId.value='';editingMemoryText.value='';newMemoryDraft.markSaved();memoryEditDraft.markSaved();await action(refreshMemories);}
async function updateMemory(){const id=editingMemoryId.value;if(!id)return;await action(async()=>{await runtimeAction(`memory/${encodeURIComponent(id)}`,{text:editingMemoryText.value},'PUT');editingMemoryId.value='';editingMemoryText.value='';memoryEditDraft.markSaved();await refreshMemories();notice.value='记忆已更新。';});}
async function consolidateMemory(){if(!confirmDestructiveAction(`整理 Agent ${memoryAgent.value} 在 ${platformId.value} / ${sessionType.value==='group'?'群聊':'私聊'} ${sessionId.value} / 发送者 ${senderId.value} 的记忆？将合并相同内容并清理过期记录。其他范围不受影响。`))return;await action(async()=>{await runtimeAction('memory/consolidate',{agentId:memoryAgent.value,principal:{platform:platformId.value,senderId:senderId.value,sessionId:sessionId.value,sessionType:sessionType.value},libraryId:memoryLibrary.value});await refreshMemories();notice.value='当前作用域记忆已整理。';});}
async function deleteMemory(id:string) { if(!confirmDestructiveAction('永久删除这条记忆？此操作立即生效。'))return;await action(async()=>{await runtimeAction(`memory/${encodeURIComponent(id)}`,undefined,'DELETE');await refreshMemories();}); }
async function refreshKnowledge() { const id=knowledgeLibrary.value;const result=await runtimeRequest(`knowledge?libraryId=${encodeURIComponent(id)}`,KnowledgeResponseSchema);if(id===knowledgeLibrary.value)documents.value=result.documents; }
async function importKnowledge(event:Event) { if(!(event.target instanceof HTMLInputElement))return;const libraryId=knowledgeLibrary.value;const file=event.target.files?.[0];if(!file||!libraryId)return;await action(async()=>{if(file.size>10*1024*1024)throw new Error('文件超过 10 MiB');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{if(typeof reader.result!=='string'){reject(new Error('读取文件失败'));return;}resolve(reader.result.split(',')[1] ?? '');};reader.onerror=()=>reject(new Error('读取文件失败'));reader.readAsDataURL(file);});await runtimeAction('knowledge',{libraryId,name:file.name,mimeType:file.name.endsWith('.pdf')?'application/pdf':file.name.endsWith('.md')?'text/markdown':'text/plain',encoding:'base64',content:base64});await refreshKnowledge();jobRefresh.value++;notice.value='文件已提交索引。';}); }
async function updateDocument(id:string,mode:'reindex'|'delete') { if(mode==='delete'&&!confirmDestructiveAction('删除这份文档及其检索索引？此操作立即生效。'))return;await action(async()=>{await runtimeAction(`knowledge/${encodeURIComponent(id)}${mode==='reindex'?'/reindex':''}`,mode==='reindex'?{}:undefined,mode==='delete'?'DELETE':'POST');await refreshKnowledge();jobRefresh.value++;}); }
async function searchKnowledge() { await action(async()=>{hits.value=(await runtimeRequest(`knowledge/search?libraryId=${encodeURIComponent(knowledgeLibrary.value)}&query=${encodeURIComponent(query.value)}`,KnowledgeSearchResponseSchema)).hits;}); }
function protectDraft(event:BeforeUnloadEvent) { if(dirty.value || unsavedDrafts.value.length){event.preventDefault();event.returnValue='';} }
window.addEventListener('beforeunload',protectDraft);
function authExpired(){sessionExpired.value=true;publicationReview.value=undefined;}
window.addEventListener(RUNTIME_AUTH_EXPIRED_EVENT,authExpired);
const removeRouteGuard=router.beforeEach((to,from)=>{
  if(to.fullPath===from.fullPath)return true;
  if(to.path==='/agents'&&from.path==='/agents'&&to.query.agent===from.query.agent)return true;
  if(to.path==='/sessions'&&from.path==='/sessions'&&to.query.conversation===from.query.conversation&&to.query.run===from.query.run)return true;
  const leavesRuntime=!to.meta.typescriptRuntime;
  return confirmUnsavedDrafts(from.path,leavesRuntime&&dirty.value?['运行配置']:[]);
});
function setSection(value:string){void router.push({path:route.path,query:{...route.query,section:value}});}
function applySection(){
  const section=route.query.section;
  if(tab.value==='memories'&&libraryTab.value==='content'&&(section==='settings'||section==='maintenance')){memoryText.value='';editingMemoryId.value='';editingMemoryText.value='';newMemoryDraft.markSaved();memoryEditDraft.markSaved();}
  libraryTab.value=section==='settings'?'settings':section==='maintenance'&&tab.value==='memories'?'maintenance':'content';
  extensionTab.value=section==='native'?'native':'resources';
  environmentTab.value=section==='settings'?'settings':'processes';
}
applySection();
watch(()=>route.query.section,applySection);
watch([sample,senderId,sessionId,platformId,sessionType,mentionBot],()=>{simulationGeneration++;simulation.value=undefined;});
watch(config,()=>{simulationGeneration++;simulation.value=undefined;},{deep:true});
watch(memoryLibrary,()=>{memories.value=[];editingMemoryId.value='';});watch(knowledgeLibrary,()=>{documents.value=[];hits.value=[];});
watch(weixinId,()=>{qr.value=undefined;qrImage.value='';});
watch(tab,(_page,previous)=>{notice.value='';error.value='';mobileNav.value=false;navigationQuery.value='';applySection();if(previous==='memories'){memoryText.value='';editingMemoryId.value='';editingMemoryText.value='';newMemoryDraft.markSaved();memoryEditDraft.markSaved();}void nextTick(()=>pageHeading.value?.focus());if(!connected.value)return;void action(async()=>{if(tab.value==='agents')await refreshExtensionTools();if(tab.value==='runs'||tab.value==='welcome')await refreshRuns();if(tab.value==='platforms'||tab.value==='welcome')await refreshPlatforms();if(tab.value==='memories'&&memoryLibrary.value)await refreshMemories();if(tab.value==='knowledge'&&knowledgeLibrary.value)await refreshKnowledge();});});
onBeforeUnmount(()=>{mobileQuery.removeEventListener('change',updateMobile);window.removeEventListener('beforeunload',protectDraft);window.removeEventListener(RUNTIME_AUTH_EXPIRED_EVENT,authExpired);removeRouteGuard();});
</script>
<template>
<div class="app-shell ts-shell ts-product-shell" :class="{'is-agent-workspace':tab==='agents'}">
  <a href="#ts-main" class="skip-link">跳到主要内容</a>
  <aside class="shell-sidebar" :class="{'is-open':mobileNav}" :inert="isMobile && !mobileNav" @keydown.esc="mobileNav=false"><div class="sidebar-frame">
    <RouterLink class="shell-brand" to="/"><span class="shell-brand-mark"><img src="/assets/priestess-icon.jpg" alt="普瑞赛斯"></span><span class="shell-brand-copy"><strong>普瑞赛斯</strong><small>PriestessBot</small></span></RouterLink>
    <label class="ts-nav-search"><span>查找功能</span><input v-model="navigationQuery" type="search" placeholder="人格、群文件、模型…" @keydown.esc.stop="navigationQuery=''"></label>
    <nav v-if="navigationQuery.trim()" class="shell-nav ts-search-results" aria-label="功能搜索结果"><p v-if="!visibleNavigation.length" class="muted">没有匹配功能。<button @click="navigationQuery=''">清除搜索</button></p><RouterLink v-for="item in visibleNavigation" :key="item.id" class="nav-link" :to="item.path" @click="mobileNav=false"><component :is="icons[item.id]" :size="18" aria-hidden="true"/><span>{{item.label}}<small>{{item.group}}</small></span></RouterLink></nav>
    <nav v-else class="shell-nav ts-primary-navigation" aria-label="运行控制台导航"><RouterLink v-for="item in runtimeDomains" :key="item.id" class="nav-link" :class="{'is-current':activeDomain===item.id}" :aria-current="activeDomain===item.id?'page':undefined" :aria-label="item.label" :to="item.path" @click="mobileNav=false"><component :is="domainIcons[item.id]" :size="24" aria-hidden="true"/><span>{{item.label}}</span><span v-if="modifiedPages.some(page=>runtimeDomainFor(page,page==='execution'?'settings':undefined)===item.id)" class="ts-nav-dirty" aria-hidden="true" title="有未保存配置"></span></RouterLink></nav>
    <div class="sidebar-runtime"><span class="runtime-dot" :class="{ok:connected && !sessionExpired}"></span><span>{{sessionExpired?'登录已过期':connected?'管理服务已连接':'等待登录'}}</span></div>
  </div></aside>
  <button v-if="mobileNav" class="sidebar-scrim" aria-label="关闭导航" @click="mobileNav=false"></button>
  <div class="shell-main"><header class="shell-topbar"><button class="mobile-menu-button" aria-label="打开导航" :aria-expanded="mobileNav" @click="mobileNav=!mobileNav"><PhList :size="22"/></button><div class="topbar-page-meta"><div class="page-breadcrumb"><span>{{activeDomainItem?.label}}</span><span>/</span><span>{{currentPage?.label}}</span></div><h1 ref="pageHeading" tabindex="-1">{{selectedTitle}}</h1></div><div class="topbar-actions"><span class="connection-badge"><span class="runtime-dot" :class="{ok:connected && !sessionExpired}"></span><small>{{host}}</small></span><button v-if="connected" class="ts-quiet-button" :disabled="busy" @click="disconnect">退出登录</button></div></header>
  <nav v-if="areaLinks.length" class="ts-area-navigation" aria-label="页面分区"><RouterLink v-for="item in areaLinks" :key="item.path + (item.section ?? '')" :class="{active:areaLinkActive(item,tab,activeSection)}" :aria-current="areaLinkActive(item,tab,activeSection)?'page':undefined" :to="item.section?{path:item.path,query:{section:item.section}}:item.path">{{item.label}}</RouterLink></nav>
  <main id="ts-main" class="workspace ts-workspace">
    <p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="notice" class="notice ok" role="status">{{notice}}</p>
    <form v-if="!connected || sessionExpired" class="panel ts-login" @submit.prevent="connect"><h2>{{sessionExpired?'重新登录管理服务':'登录管理服务'}}</h2><p class="muted">{{sessionExpired?'登录已过期，当前草稿仍保留在此页面。重新登录后可以继续编辑。':'使用 NAS 管理令牌登录。首次使用请向服务管理员获取令牌。'}}</p><label>管理令牌<input v-model="token" :disabled="busy" type="password" autocomplete="off" placeholder="服务端管理令牌"></label><button class="primary" :disabled="busy">{{busy?'登录中…':sessionExpired?'重新登录':'登录'}}</button><small class="muted">登录有效期 8 小时，刷新可自动恢复；退出后立即失效。</small></form>
    <template v-if="connected && config && publishedConfig">
      <section v-if="showGlobalDraft" class="v3-config-bar ts-config-summary" aria-label="运行配置草稿">
        <div class="config-revision"><strong>运行配置 r{{revision}}</strong><span>{{dirty?'有未发布修改（跨页面保留）':'运行配置已发布'}}</span><small v-if="dirty">修改范围：{{modifiedLabels.join('、')}}</small></div>
        <div class="toolbar"><button v-if="dirty" :disabled="busy" @click="downloadDraft">导出当前草稿</button><button :disabled="busy || sessionExpired" @click="reload"><PhArrowClockwise :size="15"/>{{dirty?'放弃运行配置修改':'刷新配置'}}</button><button class="primary" :disabled="busy || !dirty || sessionExpired" @click="publish">发布运行配置</button></div>
        <details class="ts-save-explanation ts-wide"><summary>保存范围与运行影响</summary><p>发布以上页面的运行配置；会中断运行中和排队任务，使旧审批失效。人格库、插件和搜索配置使用所在页面的保存操作。保存前可再次核对影响。</p></details>
        <p v-if="unsavedDrafts.length" class="notice ts-wide">另有独立编辑尚未保存：{{unsavedDrafts.map(item=>item.label).join('、')}}。请先在对应区域保存或取消。</p>
        <div v-if="configConflict" class="notice error ts-wide" role="alert">服务端版本已变化，当前草稿仍保留。<div class="toolbar"><button :disabled="busy || sessionExpired" @click="mergeLatest">合并互不冲突的修改</button><button :disabled="busy" @click="downloadDraft">导出当前草稿</button><button :disabled="busy || sessionExpired" @click="reload">放弃草稿并载入最新配置</button></div></div>
      </section>
      <fieldset class="ts-page-content" :disabled="sessionExpired || busy">
      <details v-if="!['agents','platforms','resources','tools','runs','routeRecords'].includes(tab)" class="ts-context-help"><summary>操作说明与相关入口</summary><WorkflowGuide :page="tab" :section="activeSection" :draft="config" :published="publishedConfig" :platform-statuses="platformStatuses"/></details>
      <nav v-if="toolsArea" class="ts-local-navigation" aria-label="工具管理类型"><RouterLink to="/tools" :class="{active:tab==='tools'}">能力目录</RouterLink><RouterLink to="/plugins" :class="{active:tab==='plugins'}">插件设置</RouterLink><RouterLink to="/search" :class="{active:tab==='search'}">网络搜索</RouterLink><RouterLink to="/extensions" :class="{active:tab==='extensions'}">MCP、Skills 与扩展</RouterLink></nav>
      <nav v-if="tab==='chat'||tab==='conversations'" class="ts-local-navigation" aria-label="会话视图"><RouterLink to="/sessions" :class="{active:tab==='conversations'}">全部会话记录</RouterLink><RouterLink to="/chat" :class="{active:tab==='chat'}">控制台对话</RouterLink></nav>
      <section v-if="tab==='agents'" class="ts-agent-page"><AgentWorkbench v-model="config" :published-config="publishedConfig" :extra-tool-options="extraToolOptions" :busy="busy||sessionExpired" :saved-binding="savedAgentBinding" @save="saveAgent" @binding-draft="agentBindingDraft=$event" @inspect-run="openJobRun"/></section>
      <section v-if="tab==='tools'" class="panel"><CapabilityLibrary/></section>
      <section v-if="tab==='resources'" class="ts-resource-hub"><div class="section-title"><div><h2>共享资源</h2><p>集中维护内容与能力，在 Agent 中按需装配。</p></div><RouterLink class="button-link" to="/agents">去配置 Agent</RouterLink></div>
        <RouterLink to="/personas" class="ts-resource-row"><PhRobot :size="24"/><div><h3>人格</h3><p>角色设定、示例对话与回复规则。请在 Agent 中分配人格。</p></div><span>管理人格 →</span></RouterLink>
        <RouterLink to="/knowledge-base" class="ts-resource-row"><PhBooks :size="24"/><div><h3>知识库</h3><p>{{publishedConfig.knowledgeLibraries.length}} 个已保存资料库 · 文档、索引与检索验证。</p></div><span>管理资料 →</span></RouterLink>
        <RouterLink to="/memories" class="ts-resource-row"><PhBrain :size="24"/><div><h3>长期记忆</h3><p>{{publishedConfig.memoryLibraries.length}} 个已保存记忆库 · 来源、作用域与自动整理。</p></div><span>整理记忆 →</span></RouterLink>
        <RouterLink to="/tools" class="ts-resource-row"><PhPuzzlePiece :size="24"/><div><h3>工具与插件</h3><p>通用能力、QQ / Telegram / 微信专属能力，以及 MCP 与 Skills。</p></div><span>查看能力 →</span></RouterLink>
      </section>

      <section v-if="tab==='welcome'" class="ts-fields">
        <div class="panel ts-welcome"><img src="/assets/priestess-icon.jpg" alt="PriestessBot"><div><p class="ts-eyebrow">PRIESTESS WORKSPACE</p><h2>欢迎回来</h2><p class="muted">连接机器人，为 Agent 配置模型，开始你的第一段对话。</p><div class="toolbar"><RouterLink class="button-link primary" to="/chat">开始对话</RouterLink><RouterLink class="button-link" to="/platforms">管理机器人</RouterLink></div></div></div>
        <div class="ts-overview-grid"><RouterLink to="/platforms" class="panel ts-stat"><PhPlugsConnected :size="23"/><strong>{{publishedConfig.platforms.length}}</strong><span>机器人</span><small>{{platformStatuses.filter(item=>item.status==='connected').length}} 个已连接</small></RouterLink><RouterLink to="/providers" class="panel ts-stat"><PhStack :size="23"/><strong>{{publishedConfig.connections.length}}</strong><span>模型服务</span><small>管理 API 与协议</small></RouterLink><RouterLink to="/agents" class="panel ts-stat"><PhRobot :size="23"/><strong>{{publishedConfig.agents.length}}</strong><span>Agent</span><small>{{publishedConfig.agents.filter(item=>item.enabled).length}} 个已启用</small></RouterLink><RouterLink to="/agent-records" class="panel ts-stat"><PhChatsCircle :size="23"/><strong>{{runs.length}}</strong><span>最近 Agent 记录</span><small>查看模型与工具调用</small></RouterLink></div>

        <section class="panel"><div class="section-title"><h2>机器人状态</h2><button :disabled="busy" @click="action(refreshPlatforms)">刷新状态</button></div><p v-if="!publishedConfig.platforms.length" class="empty-state">还没有机器人，前往“机器人”添加第一个连接。</p><RouterLink v-for="platform in publishedConfig.platforms" :key="platform.id" to="/platforms" class="ts-platform-row"><span class="runtime-dot" :class="{ok:platformStatuses.find(item=>item.id===platform.id)?.status==='connected'}"></span><strong>{{platform.displayName || platform.id}}</strong><span class="chip">{{platform.type}}</span><small>{{statusLabels[platformStatuses.find(item=>item.id===platform.id)?.status ?? 'starting']}}</small></RouterLink></section>
      </section>
      <section v-if="tab==='flow'" class="panel"><div class="section-title"><div><h2>消息处理流程</h2><p>统一接入 Telegram、NapCat 与微信，最终运行到选定的 Agent。</p></div><span class="chip">固定拓扑 · 节点可编辑</span></div><fieldset class="v3-fieldset" :disabled="busy"><FlowEditor v-model="config" :trace="simulation?.path"/></fieldset>
        <details class="ts-simulation"><summary>模拟消息路由</summary><form class="ts-form-grid" @submit.prevent="simulate"><label>平台实例<input v-model="platformId" list="platform-options"></label><label>发送者<input v-model="senderId"></label><label>会话 ID<input v-model="sessionId"></label><label>会话类型<select v-model="sessionType"><option value="private">私聊</option><option value="group">群聊</option></select></label><label v-if="sessionType==='group'" class="ts-check"><input v-model="mentionBot" type="checkbox">提及机器人</label><label class="ts-wide">消息<input v-model="sample"></label><button :disabled="busy" class="primary">模拟草稿</button><small class="muted">只检查路由与权限，不调用模型或发送 IM 消息。</small></form><div v-if="simulation" class="ts-simulation-result"><strong>{{simulation.outcome}} · {{simulation.agentId || simulation.reason}}</strong><span v-if="simulation.runtimeState" class="chip">{{runtimeStateLabels[simulation.runtimeState]}}</span><ol><li v-for="(step,index) in simulation.path" :key="index"><strong>{{step.nodeId}}</strong> · {{step.summary}} <small>{{step.durationMs}} ms</small></li></ol></div></details>
      </section>
      <section v-if="configurationSection" class="panel"><ConfigurationEditor v-model="config" :section="configurationSection"/></section>
      <section v-if="tab==='platforms'" class="ts-platform-page"><PlatformWorkbench v-model="config" :published-platforms="publishedConfig.platforms" :statuses="platformStatuses" :busy="busy||sessionExpired" @refresh="action(refreshPlatforms)" @open-capabilities="showPlatformCapabilities"><template #platform-login="{platform}"><div v-if="platform.type==='weixin'" class="ts-fields"><h3>微信登录</h3><p class="muted">保存机器人配置后扫码登录。</p><div class="toolbar"><button type="button" :disabled="busy || dirty" @click="loginWeixin(platform.id)">生成登录二维码</button><button type="button" :disabled="busy || !qr || weixinId!==platform.id" @click="pollQr">检查扫码状态</button></div><div v-if="qr && weixinId===platform.id" class="ts-qr"><img v-if="qrImage && !['confirmed','expired','failed'].includes(qr.status)" :src="qrImage" alt="微信登录二维码" width="240" height="240"><p role="status">{{statusLabels[qr.status]}}</p></div></div></template></PlatformWorkbench></section>
      <section v-if="tab==='plugins'" class="panel"><PluginWorkspace/></section><section v-if="tab==='search'" class="panel"><SearchSettings/></section>
      <section v-if="resourceSection" class="panel"><nav v-if="tab==='extensions'" class="ts-tabs" aria-label="扩展类型"><button :class="{active:extensionTab==='resources'}" @click="setSection('resources')">MCP 与 Skills</button><button :class="{active:extensionTab==='native'}" @click="setSection('native')">原生扩展</button></nav><NativeExtensionsPanel v-if="tab==='extensions' && extensionTab==='native'"/><fieldset v-else class="v3-fieldset" :disabled="busy"><ResourceEditor v-model="config" :section="resourceSection"/></fieldset></section>
      <section v-if="tab==='settings'" class="panel ts-fields"><OperatorSettings/><h2>配置管理</h2><p class="muted">保存前自动校验配置；历史恢复会创建一个新版本。</p><div class="toolbar"><button :disabled="busy" @click="downloadDraft">导出当前草稿</button><button :disabled="busy" @click="validate">检查配置</button></div><details class="ts-simulation"><summary>草稿与历史恢复</summary><div class="ts-form-grid"><label>导入配置草稿<input type="file" accept="application/json,.json" @change="importDraft"></label><label>恢复历史修订<input v-model.number="rollbackRevision" type="number" min="0"></label><button :disabled="busy || dirty" @click="rollback">恢复为新修订</button></div><p class="muted">恢复操作使用当前修订校验，避免覆盖其他人的更新。导入的草稿需校验发布后生效。</p></details></section>
      <section v-if="tab==='memories'" class="panel ts-fields"><nav class="ts-tabs" aria-label="长期记忆页面"><button :class="{active:libraryTab==='content'}" @click="setSection('content')">记忆内容</button><button :class="{active:libraryTab==='settings'}" @click="setSection('settings')">记忆库管理</button><button :class="{active:libraryTab==='maintenance'}" @click="setSection('maintenance')">智能整理</button></nav><MemoryMaintenancePanel v-if="libraryTab==='maintenance'"/><ResourceEditor v-else-if="libraryTab==='settings'" v-model="config" section="memoryLibraries"/><template v-else><div class="section-title"><div><h2>长期记忆</h2><p>按发送者、会话和 Agent 限定作用域，并保留来源。</p></div><button :disabled="busy || !memoryLibrary" @click="action(refreshMemories)">刷新记忆</button></div><label>记忆库<select :value="memoryLibrary" @change="changeMemoryLibrary"><option value="">选择记忆库</option><option v-for="library in publishedConfig.memoryLibraries" :key="library.id" :value="library.id">{{library.displayName}}</option></select></label><p v-if="!publishedConfig.memoryLibraries.length" class="notice">请先在“记忆库管理”中创建记忆库并保存。</p><form v-if="memoryLibrary" class="ts-fields" @submit.prevent="saveMemory"><div class="ts-form-grid"><label>记忆所属 Agent<select v-model="memoryAgent"><option v-for="agent in publishedConfig.agents" :key="agent.id" :value="agent.id">{{agent.displayName}}</option></select></label><label>记忆作用域<select v-model="memoryScope"><option value="sender">当前发送者</option><option value="session">当前会话</option><option value="agent">当前 Agent</option></select></label><label>平台实例<input v-model="platformId"></label><label>发送者<input v-model="senderId"></label><label>会话 ID<input v-model="sessionId"></label><label>会话类型<select v-model="sessionType"><option value="private">私聊</option><option value="group">群聊</option></select></label></div><label>新增记忆<textarea v-model="memoryText" required rows="2"></textarea></label><button :disabled="busy">保存记忆</button></form><div v-if="memoryLibrary" class="toolbar"><button :disabled="busy || !memoryAgent" @click="consolidateMemory">整理当前作用域</button><small class="muted">合并内容相同的记忆并清理过期记录，保留来源。</small></div><label v-if="memoryLibrary">列表范围<select v-model="memoryListScope"><option value="all">整个记忆库（所有可管理范围）</option><option value="selected">仅当前 Agent / 平台 / 会话 / 发送者</option></select></label><p v-if="memoryLibrary && !visibleMemories.length" class="empty-state">该列表范围没有记忆。可以切换范围，或在上方新增记忆。</p><article v-for="memory in visibleMemories" :key="memory.id" class="card"><form v-if="editingMemoryId===memory.id" class="ts-fields" @submit.prevent="updateMemory"><label>编辑记忆内容<textarea v-model="editingMemoryText" required maxlength="20000"></textarea></label><div class="toolbar"><button class="primary" :disabled="busy">保存修改</button><button type="button" :disabled="busy" @click="cancelMemoryEdit">取消编辑</button></div></form><p v-else>{{memory.text}}</p><small>{{memory.scope}} · {{memory.principal.platform}} / {{memory.principal.sessionType==='group'?'群聊':'私聊'}} / {{memory.principal.sessionId}} · {{memory.principal.senderId}} · {{memory.source}}</small><div class="toolbar"><button v-if="editingMemoryId!==memory.id" :disabled="busy" @click="editMemory(memory)">编辑记忆</button><button class="danger" :disabled="busy" @click="deleteMemory(memory.id)">删除</button></div></article>
      </template></section>
      <section v-if="tab==='knowledge'" class="panel ts-fields"><nav class="ts-tabs" aria-label="知识库页面"><button :class="{active:libraryTab==='content'}" @click="setSection('content')">文档与检索</button><button :class="{active:libraryTab==='settings'}" @click="setSection('settings')">知识库设置</button></nav><ResourceEditor v-if="libraryTab==='settings'" v-model="config" section="knowledgeLibraries"/><template v-else>
        <div class="section-title"><div><h2>知识库</h2><p>导入文本、Markdown 或 PDF，查看索引结果与检索引用。</p></div><button :disabled="busy || !knowledgeLibrary" @click="action(refreshKnowledge)">刷新索引</button></div><div class="ts-form-grid"><p class="notice ts-wide">检索模式：{{publishedConfig.embedding?`Embedding 模型 ${publishedConfig.embedding.model}`:'本地哈希向量 + 关键词检索（非语义模型）'}}{{publishedConfig.reranker?` · Reranker ${publishedConfig.reranker.model}`:' · 未配置 Reranker'}}</p><label>知识库<select v-model="knowledgeLibrary" @change="action(refreshKnowledge)"><option value="">选择知识库</option><option v-for="library in publishedConfig.knowledgeLibraries" :key="library.id" :value="library.id">{{library.displayName}}</option></select></label><label>导入文件（最大 10 MiB）<input type="file" accept=".txt,.md,.pdf" :disabled="busy || !knowledgeLibrary" @change="importKnowledge"></label></div><div class="table-wrap"><table class="table"><thead><tr><th>文档</th><th>索引状态</th><th>版本 / 分块</th><th>操作</th></tr></thead><tbody><tr v-for="document in documents" :key="document.id"><td>{{document.name}}<p v-if="document.error" class="danger">{{document.error}}</p></td><td>{{statusLabels[document.status] ?? document.status}}</td><td>v{{document.version}} / {{document.chunkCount}}</td><td><div class="toolbar"><button :disabled="busy" @click="updateDocument(document.id,'reindex')">重建索引</button><button :disabled="busy" class="danger" @click="updateDocument(document.id,'delete')">删除</button></div></td></tr></tbody></table></div><p v-if="!documents.length" class="empty-state">暂无已载入文档</p><form class="toolbar" @submit.prevent="searchKnowledge"><input v-model="query" aria-label="检索问题" placeholder="输入检索问题" required><button :disabled="busy || !knowledgeLibrary">检索</button></form><article v-for="hit in hits" :key="hit.id" class="card"><strong>{{hit.documentName}} · v{{hit.version}}<span v-if="hit.page"> · 第 {{hit.page}} 页</span></strong><p>{{hit.text}}</p><small>得分 {{hit.score.toFixed(3)}}</small></article><JobsPanel :refresh-token="jobRefresh" @inspect="openJobRun"/></template>
      </section>
      <PersistentChat v-if="tab==='chat'" @inspect-run="openJobRun"/>
      <ConversationWorkspace v-if="tab==='conversations'" @inspect-run="openJobRun" @open-chat="openChat"/>
      <PersonaWorkspace v-if="tab==='personas'"/>
      <WorkspaceFilesPanel v-if="tab==='files'"/>
      <RouteRecordsWorkspace v-if="tab==='routeRecords'" :config="publishedConfig" :disabled="sessionExpired||busy"/>
      <AgentRecordsWorkspace v-if="tab==='runs'" :config="publishedConfig" :disabled="sessionExpired||busy"/>
      <section v-if="tab==='execution'" class="ts-fields"><div class="toolbar ts-execution-switch"><RouterLink class="button-link" :to="{path:'/execution',query:{section:environmentTab==='processes'?'settings':'processes'}}">{{environmentTab==='processes'?'配置执行环境':'查看运行进程'}}</RouterLink></div><ExecutionOperations v-if="environmentTab==='processes'" :initial-run-id="typeof route.query.run==='string'?route.query.run:undefined" @open-settings="setSection('settings')" @inspect="openJobRun"/><div v-else class="panel"><ResourceEditor v-model="config" section="environments"/></div></section>
      <datalist id="platform-options"><option v-for="platform in config.platforms" :key="platform.id" :value="platform.id"></option></datalist>
      </fieldset>
    </template>
  </main></div>
  <dialog ref="publicationDialog" class="ts-publication-dialog" aria-labelledby="publication-title" @cancel.prevent="closePublication">
    <template v-if="publicationReview"><header class="section-title"><h2 id="publication-title">{{publicationReview.kind==='agent'?'发布当前 Agent':'发布运行配置'}}</h2><button type="button" :disabled="busy" @click="closePublication">返回编辑</button></header>
    <p class="muted">先检查修改范围，再确认发布。</p><ul class="ts-publication-scope"><li v-for="label in publicationReview.labels" :key="label">{{label}}</li></ul>
    <p v-if="publicationReview.kind==='agent'" class="notice">只保存当前 Agent 与人格绑定。其他配置草稿保留。</p>
    <p class="notice">当前有 {{publicationReview.active}} 个运行或排队任务，{{publicationReview.paused}} 个待审批任务。发布会中断运行中和排队任务。旧审批会失效。服务端会重新配置运行服务。</p>
    <p v-if="error" class="notice error" role="alert">{{error}}</p><footer class="toolbar"><button type="button" :disabled="busy" @click="closePublication">继续编辑</button><button type="button" class="primary" :disabled="busy||sessionExpired" @click="commitPublication">{{busy?'正在发布…':'确认发布'}}</button></footer></template>
  </dialog>
</div>
</template>
