<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MemoriesResponseSchema, type MemoryRecord } from '../../../../packages/contracts/src/index';
import { MemoryMaintenanceResponseSchema, MemoryProposalSchema, type MemoryScope } from '../../../../packages/contracts/src/memory-maintenance';
import { runtimeRequest, runtimeAction } from '../../api/typescript';
const state=ref(MemoryMaintenanceResponseSchema.parse({proposals:[],policies:[],jobs:[]})), memories=ref<MemoryRecord[]>([]), selected=ref(''), busy=ref(false), error=ref(''), enabled=ref(false), autoApply=ref(false), interval=ref(1440);
const notice = ref(''); const policyRevision = ref(0);
const draft = useUnsavedDraft('记忆定期整理策略', () => ({ enabled: enabled.value, autoApply: autoApply.value, interval: interval.value }));
let refreshVersion = 0;
let timer:ReturnType<typeof setInterval>|undefined;
function key(record:MemoryScope){return JSON.stringify([record.agentId,record.libraryId,record.scope,record.principal.platform,record.principal.sessionType??'private',record.scope==='agent'?'':record.principal.sessionId,record.scope==='sender'?record.principal.senderId:'']);}
const scopes=computed(()=>{const found=new Map<string,MemoryScope>();for(const memory of memories.value){const scope:MemoryScope={agentId:memory.agentId,libraryId:memory.libraryId,scope:memory.scope,principal:memory.principal};found.set(key(scope),scope);}for(const item of state.value.policies) found.set(key(item.scope),item.scope);return [...found.entries()].map(([id,scope])=>({id,scope}));});
const scope=computed(()=>scopes.value.find(item=>item.id===selected.value)?.scope);
const policy=computed(()=>state.value.policies.find(item=>scope.value&&key(item.scope)===key(scope.value)));
async function refresh(){const version=++refreshVersion;const [data,records]=await Promise.all([runtimeRequest('memory-maintenance',MemoryMaintenanceResponseSchema),runtimeRequest('memory',MemoriesResponseSchema)]);if(version!==refreshVersion)return;state.value=data;memories.value=records.memories;if(!draft.dirty.value) loadPolicy();}
async function action(work:()=>Promise<void>, refreshAfter=true){busy.value=true;error.value='';notice.value='';try{await work();if(refreshAfter)await refresh();}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}finally{busy.value=false;}}
function loadPolicy(){enabled.value=policy.value?.enabled??false;autoApply.value=policy.value?.autoApply??false;interval.value=policy.value?.intervalMinutes??1440;policyRevision.value=policy.value?.revision??0;draft.markSaved();}
function choose(event:Event){if(!(event.target instanceof HTMLSelectElement))return;if(!draft.confirmDiscard()){event.target.value=selected.value;return;}selected.value=event.target.value;loadPolicy();notice.value='';}
async function reloadPolicy():Promise<void>{
  const target=scope.value;
  if(busy.value||!target||!draft.confirmDiscard())return;
  const targetKey=key(target);const version=++refreshVersion;
  await action(async()=>{
    const data=await runtimeRequest('memory-maintenance',MemoryMaintenanceResponseSchema);
    if(version!==refreshVersion||!scope.value||key(scope.value)!==targetKey)return;
    state.value=data;loadPolicy();notice.value='已重新载入此策略的服务端版本，可以继续编辑。';
  },false);
}
function preview(){if(scope.value)void action(async()=>{await runtimeRequest('memory-maintenance/preview',MemoryProposalSchema,scope.value);notice.value='合并预览已生成，请核对来源后再应用。';});}
function savePolicy(){if(!scope.value)return;if(autoApply.value&&!policy.value?.autoApply&&!confirmDestructiveAction('启用自动应用？以后此范围的定期整理会自动用合并结果替换源记忆，无需逐次人工审核。'))return;void action(async()=>{await runtimeAction('memory-maintenance/policy',{policy:{scope:scope.value,enabled:enabled.value,autoApply:autoApply.value,intervalMinutes:interval.value},expectedRevision:policyRevision.value},'PUT');draft.markSaved();notice.value='定期策略已保存并生效。';});}
function apply(id:string){const proposal=state.value.proposals.find(item=>item.id===id);if(!proposal||!confirmDestructiveAction(`应用这份预览的 ${proposal.merges.length} 项合并？源记忆会被合并内容替换，请先核对原始记忆和来源。`))return;void action(async()=>{await runtimeAction(`memory-maintenance/apply/${encodeURIComponent(id)}`,{});notice.value='预览已应用，记忆已更新。';});}
async function cancel(id:string){try{await runtimeAction(`memory-maintenance/cancel/${encodeURIComponent(id)}`,{});await refresh();}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}}
onMounted(()=>{void action(async()=>{});timer=setInterval(()=>{if(!busy.value)void refresh().catch(()=>{});},5000);});onUnmounted(()=>{refreshVersion++;if(timer)clearInterval(timer);});
</script>
<template><section class="ts-fields"><div class="section-title"><div><h2>语义记忆整理</h2><p>使用当前 Agent 的模型生成合并预览。每次仅处理一个权限范围，保留来源；源记忆或配置变化后须重新预览。</p></div><button :disabled="busy" @click="action(async()=>{})">刷新</button></div><p v-if="error" role="alert" class="notice error">{{error}}</p><p v-if="notice" role="status" class="notice ok">{{notice}}</p><p v-if="!busy&&!scopes.length" class="empty-state">暂无可整理的记忆。先到 <RouterLink to="/memories?section=content">记忆内容</RouterLink> 添加记忆，或让 Agent 在对话后提取记忆。</p>
<label>记忆范围<select :value="selected" :disabled="busy" @change="choose"><option value="">选择需要整理的范围</option><option v-for="item in scopes" :key="item.id" :value="item.id">{{item.scope.agentId}} / {{item.scope.libraryId}} / {{item.scope.scope}} / {{item.scope.principal.platform}} / {{item.scope.principal.sessionId}} / {{item.scope.scope==='sender'?item.scope.principal.senderId:'共享'}}</option></select></label><button :disabled="busy||!scope" @click="preview">{{busy?'处理中…':'生成合并预览'}}</button>
<details v-if="scope"><summary>定期整理设置</summary><p role="status">{{draft.dirty.value?'有未保存的策略修改':'此策略独立保存，保存后立即生效'}}</p><label><input v-model="enabled" type="checkbox" :disabled="busy" />启用此范围的定期整理</label><label>间隔（分钟，最少 5）<input v-model.number="interval" type="number" :disabled="busy" min="5" max="10080" /></label><label><input v-model="autoApply" type="checkbox" :disabled="busy" />自动应用通过来源检查的预览</label><p>默认仅生成预览。自动应用会将提案中的源记忆替换为模型合并结果；关闭后保留人工审核。</p><button :disabled="busy||!draft.dirty.value" @click="savePolicy">保存定期策略</button><button :disabled="busy" @click="reloadPolicy">重新载入此策略</button></details>
<div v-for="job in state.jobs.slice(0,10)" :key="job.id" class="maintenance-job"><span>{{job.status}} · {{job.summary}}</span><button v-if="job.status==='running'" :disabled="busy" @click="cancel(job.id)">取消</button></div>
<article v-for="proposal in state.proposals" :key="proposal.id" class="proposal"><div class="section-title"><h3>{{proposal.scope.agentId}} / {{proposal.scope.libraryId}} · {{proposal.status==='pending'?'待审核':'已应用'}}</h3><button v-if="proposal.status==='pending'" :disabled="busy||!proposal.merges.length" @click="apply(proposal.id)">应用此预览</button></div><p>{{new Date(proposal.createdAt).toLocaleString()}} · {{proposal.sources.length}} 条来源 / {{proposal.merges.length}} 项合并</p><p v-if="!proposal.merges.length">没有需要合并的记忆。</p><div v-for="(merge,index) in proposal.merges" :key="index"><h4>建议内容</h4><p>{{merge.text}}</p><details><summary>查看 {{merge.sourceIds.length}} 条原始记忆和来源</summary><blockquote v-for="id in merge.sourceIds" :key="id"><p>{{proposal.sources.find(source=>source.record.id===id)?.record.text}}</p><small>{{proposal.sources.find(source=>source.record.id===id)?.record.source}}</small></blockquote></details></div></article>
</section></template>
<style scoped>label{display:flex;gap:8px;align-items:center;margin:12px 0;flex-wrap:wrap}label input[type=checkbox]{width:auto}select{max-width:100%}.proposal{padding:18px;border:1px solid var(--border-color,#d3e6dc);border-radius:14px;margin:16px 0}p,small{overflow-wrap:anywhere}blockquote{border-left:3px solid #a8d8bb;padding-left:12px}.maintenance-job{display:flex;gap:12px;margin:10px 0;align-items:center}summary{cursor:pointer;margin:12px 0}</style>
