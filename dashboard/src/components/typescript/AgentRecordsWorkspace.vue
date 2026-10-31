<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { AgentRecordDetailSchema, AgentRecordExportSchema, AgentRecordsResponseSchema, type AgentRecord } from '../../../../packages/contracts/src/observability';
import { RunDetailSchema, runtimeStateLabels, type RuntimeConfig, type RunEvent } from '../../../../packages/contracts/src/index';
import { downloadRuntimeArtifact, runtimeAction, runtimeRequest, watchRun } from '../../api/typescript';
import { recoverLegacyCommandDestination } from './run-record-navigation';
import AuditPreview from './AuditPreview.vue';
import RecordFilters from './RecordFilters.vue';
import { agentStatusLabels, routeOutcomeLabels, recordFiltersFromQuery, recordOffset, recordSearchParams, recordPlatform, formatRecordTime, formatRecordDuration, formatRecordMetric, recordedTokenTotal, executionSteps, finalRecordedReply, compactRunEvent } from './observability-model';

const props=defineProps<{config:RuntimeConfig;disabled?:boolean}>();
const route=useRoute();const router=useRouter();const filters=ref(recordFiltersFromQuery(route.query));
const records=ref<AgentRecord[]>([]);const total=ref(0);const limit=ref(50);const listLoading=ref(false);const detailLoading=ref(false);const actionBusy=ref(false);const error=ref('');const notice=ref('');const confirmStop=ref(false);const streamStatus=ref('');
const detail=ref<ReturnType<typeof AgentRecordDetailSchema.parse>>();let listVersion=0;let detailVersion=0;let disposed=false;let listController:AbortController|undefined;let detailController:AbortController|undefined;let stream:AbortController|undefined;let refreshTimer:ReturnType<typeof setTimeout>|undefined;
const offset=computed(()=>recordOffset(route.query.offset));const selectedId=computed(()=>typeof route.query.run==='string'?route.query.run:typeof route.query.record==='string'?route.query.record:'');
const busy=computed(()=>listLoading.value||detailLoading.value||actionBusy.value||props.disabled);
const active=computed(()=>!!detail.value&&['queued','running','paused'].includes(detail.value.record.status));
const steps=computed(()=>executionSteps(detail.value?.events ?? []));const finalReply=computed(()=>finalRecordedReply(detail.value?.events ?? []));
const pendingApproval=computed(()=>detail.value?.record.status==='paused'?[...detail.value.events].reverse().find(event=>event.type==='paused'):undefined);
const otherEvents=computed(()=>detail.value?.events.filter(event=>!['model_call','tool','message_delta','message_snapshot'].includes(event.type)) ?? []);
const platformOptions=computed(()=>{const data=new Map(props.config.platforms.map(item=>[item.id,`${item.type==='napcat'?'QQ / NapCat':item.type==='telegram'?'Telegram':'微信'} · ${item.displayName||item.id}`]));for(const record of records.value)if(record.platform&&!data.has(record.platform))data.set(record.platform,`${recordPlatform(record.platform,record.platformType)} · ${record.platform}`);return [...data].map(([id,label])=>({id,label}));});
const agentOptions=computed(()=>props.config.agents.map(item=>({id:item.id,label:item.displayName})));
function agentName(id:string):string{return props.config.agents.find(item=>item.id===id)?.displayName || id;}
function callStatus(status:string):string{return status==='started'?'执行中':status==='completed'?'已完成':status==='failed'?'失败':'已取消';}
function sourceLabel(source:string|null):string{return source==='compression'?'上下文压缩':source==='finalization'?'收尾回复':'模型调用';}
function stopStream():void{stream?.abort();stream=undefined;if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=undefined;}
function watchActiveRun(id:string):void{
  if(!active.value||props.disabled){stopStream();streamStatus.value=active.value?'自动更新已暂停':'已结束';return;}
  if(stream&&!stream.signal.aborted)return;
  const controller=new AbortController();stream=controller;streamStatus.value='执行中自动更新';
  void watchRun(id,controller.signal,(event:RunEvent)=>{
    if(disposed||event.runId!==selectedId.value||controller.signal.aborted)return;
    if(event.type==='message_delta')return;
    if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=undefined;void loadDetail(true);},250);
  }).then(()=>{if(!disposed&&!controller.signal.aborted&&selectedId.value===id){stream=undefined;if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=undefined;void loadDetail(true);},1000);}}).catch(cause=>{if(!controller.signal.aborted){if(stream===controller)stream=undefined;streamStatus.value='自动更新已中断。请刷新记录。';if(!(cause instanceof Error&&cause.name==='AbortError'))error.value=cause instanceof Error?cause.message:'自动更新失败。请刷新记录。';}});
}
async function loadList():Promise<void>{const version=++listVersion;listController?.abort();listController=new AbortController();listLoading.value=true;error.value='';try{const data=await runtimeRequest(`agent-records?${recordSearchParams(recordFiltersFromQuery(route.query),'agent',offset.value)}`,AgentRecordsResponseSchema,undefined,'GET',listController.signal);if(disposed||version!==listVersion)return;records.value=data.records;total.value=data.total;limit.value=data.limit;}catch(cause){if(version===listVersion&&!(cause instanceof Error&&cause.name==='AbortError'))error.value=cause instanceof Error?cause.message:'Agent 记录读取失败。请重试。';}finally{if(version===listVersion)listLoading.value=false;}}
async function loadDetail(preserve=false):Promise<void>{
  const version=++detailVersion;detailController?.abort();
  if(!preserve){stopStream();detail.value=undefined;confirmStop.value=false;notice.value='';error.value='';}
  if(!selectedId.value){detailLoading.value=false;return;}
  const id=selectedId.value;const controller=new AbortController();detailController=controller;detailLoading.value=!preserve;
  try{
    const data=await runtimeRequest(`agent-records/${encodeURIComponent(id)}`,AgentRecordDetailSchema,undefined,'GET',controller.signal);
    if(disposed||version!==detailVersion)return;
    detail.value=data;records.value=records.value.map(item=>item.id===id?data.record:item);watchActiveRun(id);
  }catch(cause){
    if(disposed||version!==detailVersion||controller.signal.aborted)return;
    try{
      const destination=await recoverLegacyCommandDestination(id,cause,controller.signal);
      if(disposed||version!==detailVersion||controller.signal.aborted)return;
      if(destination){await router.replace(destination);return;}
    }catch(lookupCause){
      if(disposed||version!==detailVersion||controller.signal.aborted)return;
      error.value=lookupCause instanceof Error?lookupCause.message:'记录类型读取失败。请刷新重试。';return;
    }
    error.value=cause instanceof Error?cause.message:'Agent 详情读取失败。请重试。';
  }finally{if(version===detailVersion)detailLoading.value=false;}
}
async function apply(reset=false):Promise<void>{if(reset)filters.value=recordFiltersFromQuery({});try{recordSearchParams(filters.value,'agent');const value=filters.value;const previous=route.fullPath;await router.replace({query:{platform:value.platform||undefined,sessionType:value.sessionType||undefined,sessionId:value.sessionId||undefined,agentId:value.agentId||undefined,search:value.search.trim()||undefined,from:value.from||undefined,to:value.to||undefined,status:value.status||undefined}});if(previous===route.fullPath)await loadList();}catch(cause){error.value=cause instanceof Error?cause.message:'请检查筛选条件。';}}
async function select(id:string):Promise<void>{if(selectedId.value===id){await loadDetail(true);return;}await router.push({query:{...route.query,run:id,record:undefined}});}
async function page(delta:number):Promise<void>{await router.push({query:{...route.query,offset:String(Math.max(0,offset.value+delta*limit.value)),run:undefined,record:undefined}});}
async function refresh():Promise<void>{await Promise.all([loadList(),loadDetail(true)]);}
async function cancel():Promise<void>{const id=selectedId.value;if(!id||actionBusy.value)return;actionBusy.value=true;error.value='';try{await runtimeAction(`runs/${encodeURIComponent(id)}/cancel`,{});if(selectedId.value!==id)return;confirmStop.value=false;notice.value='已提交停止请求。已完成的工具操作不会撤回。';await loadDetail(true);await loadList();}catch(cause){error.value=cause instanceof Error?cause.message:'停止请求失败。请检查当前状态后重试。';}finally{actionBusy.value=false;}}
async function approve(approved:boolean):Promise<void>{const approval=pendingApproval.value;const id=selectedId.value;if(!id||!approval||approval.type!=='paused'||actionBusy.value)return;actionBusy.value=true;error.value='';try{await runtimeRequest(`runs/${encodeURIComponent(id)}/approval`,RunDetailSchema,{approvalId:approval.approvalId,approved});if(selectedId.value!==id)return;notice.value=approved?'已提交批准。后续结果见执行轨迹。':'已提交拒绝。后续结果见执行轨迹。';await loadDetail(true);await loadList();}catch(cause){error.value=cause instanceof Error?cause.message:'审批提交失败。请刷新确认当前状态。';}finally{actionBusy.value=false;}}
async function exportRecord():Promise<void>{const id=selectedId.value;if(!id)return;try{const data=await runtimeRequest(`agent-records/${encodeURIComponent(id)}/export`,AgentRecordExportSchema);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`priestessbot-agent-${id.slice(0,12)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice.value='Agent 审计记录已导出。导出内容仍遵守脱敏和长度限制。';}catch(cause){error.value=cause instanceof Error?cause.message:'导出失败。请重试。';}}
async function download(id:string,name:string):Promise<void>{try{await downloadRuntimeArtifact(id,name);}catch(cause){error.value=cause instanceof Error?cause.message:'文件下载失败。请重试。';}}
onMounted(()=>{void refresh();});
watch([()=>route.query.platform,()=>route.query.sessionType,()=>route.query.sessionId,()=>route.query.agentId,()=>route.query.search,()=>route.query.from,()=>route.query.to,()=>route.query.status,()=>route.query.offset],()=>{filters.value=recordFiltersFromQuery(route.query);void loadList();});
watch(selectedId,()=>{void loadDetail();});
watch(()=>props.disabled,value=>{if(value)stopStream();else if(detail.value)watchActiveRun(detail.value.record.id);});
onBeforeUnmount(()=>{disposed=true;listVersion++;detailVersion++;listController?.abort();detailController?.abort();stopStream();});
</script>
<template><section class="record-workspace agent-records-workspace" aria-label="Agent 记录工作区"><header class="section-title"><div><h2>Agent 记录</h2><p>按一次运行查看输入、模型轮次、工具参数和结果、用量与产物。</p></div><button type="button" :disabled="busy" @click="refresh">刷新记录</button></header><p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="notice" class="notice ok" role="status">{{notice}}</p><RecordFilters v-model="filters" kind="agent" :busy="!!busy" :platforms="platformOptions" :agents="agentOptions" @apply="apply()" @reset="apply(true)"/>
  <div class="record-columns"><aside class="record-list" aria-label="Agent 记录列表"><div class="record-list-count"><strong>{{total}} 条匹配记录</strong><small v-if="total">{{offset+1}}–{{Math.min(offset+records.length,total)}}</small></div><p v-if="listLoading" class="empty-state" role="status">正在读取 Agent 记录…</p><button v-for="item in records" :key="item.id" type="button" :class="{selected:selectedId===item.id}" @click="select(item.id)"><strong>{{agentName(item.agentId)}} · {{agentStatusLabels[item.status]}}</strong><small>{{recordPlatform(item.platform,item.platformType)}} · {{item.sessionType==='group'?'群聊':item.sessionType==='private'?'私聊':'会话类型未记录'}} · {{item.sessionName||item.sessionId||'—'}}</small><span>{{item.summary||item.id}}</span><small>{{formatRecordTime(item.createdAt)}}</small></button><p v-if="!listLoading&&!records.length" class="empty-state">没有匹配的 Agent 记录。未进入 Agent 的消息请到路由记录检查。</p><div class="record-pagination"><button type="button" :disabled="busy||offset===0" @click="page(-1)">上一页</button><button type="button" :disabled="busy||offset+records.length>=total" @click="page(1)">下一页</button></div></aside>
    <section v-if="detail" class="record-detail" aria-label="Agent 运行详情"><header class="record-detail-heading"><div><p class="record-eyebrow">{{formatRecordTime(detail.record.createdAt)}}</p><h3>{{agentName(detail.record.agentId)}} · {{agentStatusLabels[detail.record.status]}}</h3><small>{{detail.record.id}}</small></div><button type="button" @click="exportRecord">导出审计记录</button></header>
      <div class="record-toolbar"><span class="muted">{{streamStatus}}</span><button v-if="active&&!confirmStop" type="button" class="danger" :disabled="actionBusy" @click="confirmStop=true">停止运行</button><template v-if="confirmStop"><span>停止此运行？已完成的工具操作不会撤回。</span><button type="button" :disabled="actionBusy" @click="cancel">确认停止</button><button type="button" :disabled="actionBusy" @click="confirmStop=false">继续运行</button></template></div>
      <p v-if="detail.record.legacy||!detail.record.telemetryComplete" class="notice">此记录没有完整观测数据。缺失项显示“未知”或“未记录”，不会补造模型调用和工具结果。</p>
      <dl class="record-metrics"><div><dt>总耗时</dt><dd>{{formatRecordDuration(detail.record.durationMs)}}</dd></div><div><dt>首字耗时</dt><dd>{{formatRecordDuration(detail.record.firstTokenMs)}}</dd></div><div><dt>模型调用</dt><dd>{{formatRecordMetric(detail.record.modelCalls)}}</dd></div><div><dt>工具调用</dt><dd>{{formatRecordMetric(detail.record.toolCalls)}}</dd></div><div><dt>输入 / 输出 Token</dt><dd>{{formatRecordMetric(detail.record.inputTokens)}} / {{formatRecordMetric(detail.record.outputTokens)}}</dd></div></dl>
      <dl class="record-facts"><div><dt>模型 / 引擎</dt><dd>{{detail.record.model||'未记录'}} · {{detail.record.engine||'未记录'}}</dd></div><div><dt>来源</dt><dd>{{recordPlatform(detail.record.platform,detail.record.platformType)}} · {{detail.record.platform||'未记录'}}</dd></div><div><dt>会话</dt><dd>{{detail.record.sessionType==='group'?'群聊':detail.record.sessionType==='private'?'私聊':'未记录'}} · {{detail.record.sessionName||detail.record.sessionId||'未记录'}}</dd></div><div><dt>运行态</dt><dd>{{detail.record.runtimeState?runtimeStateLabels[detail.record.runtimeState]:'未记录'}}</dd></div></dl>
      <nav class="record-links" aria-label="Agent 关联对象"><RouterLink class="button-link" :to="detail.record.conversationId?{path:'/sessions',query:{conversation:detail.record.conversationId}}:{path:'/sessions',query:{run:detail.record.id}}">查看完整会话</RouterLink><RouterLink class="button-link" :to="{path:'/execution',query:{run:detail.record.id}}">查看后台进程</RouterLink><RouterLink v-if="detail.record.parentRunId" class="button-link" :to="{path:'/agent-records',query:{run:detail.record.parentRunId}}">查看父 Agent 运行</RouterLink><RouterLink class="button-link" :to="{path:'/agents',query:{agent:detail.record.agentId}}">查看 Agent 配置</RouterLink></nav>
      <section v-if="pendingApproval&&pendingApproval.type==='paused'" class="record-approval" aria-label="工具执行审批"><h4>等待工具审批</h4><p>待执行工具：{{pendingApproval.tools.join('、')}}</p><p>批准不会提升发送者的运行态或资源权限。</p><div class="actions"><button type="button" class="primary" :disabled="actionBusy" @click="approve(true)">批准本次执行</button><button type="button" :disabled="actionBusy" @click="approve(false)">拒绝本次执行</button></div></section>
      <AuditPreview title="本次输入预览" :preview="detail.inputPreview"/>
      <section class="record-summary"><h4>回复结果</h4><pre v-if="finalReply">{{finalReply}}</pre><p v-else class="muted">{{active?'尚未生成最终回复。':'此记录没有保存回复正文。'}}</p></section>
      <section><h4>模型与工具执行轨迹</h4><div v-if="steps.length" class="execution-steps"><details v-for="(step,index) in steps" :key="step.key" class="execution-step" :open="step.status==='failed'||step.status==='started'"><summary><span>{{String(index+1).padStart(2,'0')}}</span><strong>{{step.kind==='model'?sourceLabel(step.source):'工具调用'}} · {{step.name}}</strong><span :class="`step-status-${step.status}`">{{callStatus(step.status)}}</span><span>{{formatRecordDuration(step.durationMs)}}</span></summary><div class="execution-step-body"><dl class="record-facts"><div><dt>调用 ID</dt><dd>{{step.callId}}</dd></div><div><dt>记录时间</dt><dd>{{formatRecordTime(step.timestamp)}}</dd></div><template v-if="step.kind==='model'"><div><dt>输入 / 输出 Token</dt><dd>{{formatRecordMetric(step.inputTokens)}} / {{formatRecordMetric(step.outputTokens)}}</dd></div><div><dt>首字耗时</dt><dd>{{formatRecordDuration(step.firstTokenMs)}}</dd></div></template><div v-else-if="step.modelCall!==null"><dt>对应模型调用</dt><dd>{{step.modelCall}}</dd></div></dl><p v-if="step.summary" class="record-reason">{{step.summary}}</p><AuditPreview :title="step.kind==='model'?'模型输入预览':'工具参数预览'" :preview="step.input"/><AuditPreview :title="step.kind==='model'?'模型输出预览':'工具结果预览'" :preview="step.output"/></div></details></div><p v-else class="muted">{{active?'模型与工具调用开始后，轨迹会在这里更新。':'没有保存模型或工具调用明细。'}}</p></section>
      <section v-if="detail.routes.length"><h4>关联路由</h4><div v-for="item in detail.routes" :key="item.id" class="record-child"><RouterLink :to="{path:'/route-records',query:{record:item.id}}">{{routeOutcomeLabels[item.outcome]}} · {{item.sessionName||item.sessionId}}</RouterLink><span>{{formatRecordTime(item.createdAt)}}</span></div></section>
      <section v-if="detail.children.length"><h4>子 Agent 运行</h4><div v-for="child in detail.children" :key="child.id" class="record-child"><RouterLink :to="{path:'/agent-records',query:{run:child.id}}">{{agentName(child.agentId)}} · {{agentStatusLabels[child.status]}}</RouterLink><span>{{formatRecordMetric(recordedTokenTotal(child.inputTokens,child.outputTokens))}} Token</span></div></section>
      <section v-if="detail.artifacts.length" aria-label="运行产物"><h4>生成的文件</h4><article v-for="artifact in detail.artifacts" :key="artifact.id" class="record-artifact"><div><strong>{{artifact.name}}</strong><p>{{artifact.mimeType}} · {{(artifact.size/1024).toFixed(1)}} KiB</p></div><button type="button" @click="download(artifact.id,artifact.name)">下载产物</button></article></section>
      <details><summary>其他事件（{{otherEvents.length}}）</summary><ol class="record-events"><li v-for="event in otherEvents" :key="`${event.runId}:${event.sequence}`"><small>{{formatRecordTime(event.timestamp)}}</small>{{compactRunEvent(event)}}</li></ol></details>
      <section class="record-audit-note"><strong>审计范围</strong><p>服务器返回脱敏且有长度上限的预览。导出记录同样遵守这些限制。</p><p>已保留 {{detail.audit.retainedEvents}} 个事件。<span v-if="detail.audit.eventsTruncated">较早事件已超出保留范围。</span></p><ul v-if="detail.audit.limitations.length"><li v-for="item in detail.audit.limitations" :key="item">{{item}}</li></ul></section>
    </section><section v-else class="record-detail empty-state" role="status">{{detailLoading?'正在读取 Agent 详情…':'选择一次 Agent 运行，查看模型与工具轨迹。'}}</section>
  </div>
</section></template>
<style scoped src="./records.css"></style>
