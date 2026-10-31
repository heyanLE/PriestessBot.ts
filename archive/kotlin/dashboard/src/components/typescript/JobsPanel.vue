<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { computed, onMounted, ref, watch } from 'vue';
import { JobsResponseSchema, type RuntimeJob } from '../../../../typescript/packages/contracts/src/index';
import { runtimeRequest } from '../../api/typescript';
const props=defineProps<{refreshToken:number}>();
const emit=defineEmits<{inspect:[runId:string]}>();
const jobs=ref<RuntimeJob[]>([]),busy=ref(false),error=ref('');
const kind=ref<'all'|RuntimeJob['kind']>('all');
const visible=computed(()=>jobs.value.filter(job=>kind.value==='all'||job.kind===kind.value));
const kindLabels:Readonly<Record<RuntimeJob['kind'],string>>={memory_extraction:'记忆提取',knowledge_import:'知识索引'};
const labels:Readonly<Record<RuntimeJob['status'],string>>={queued:'排队中',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已取消'};
function time(value:number){return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(value);}
async function refresh(){busy.value=true;error.value='';try{jobs.value=(await runtimeRequest('jobs',JobsResponseSchema)).jobs;}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}finally{busy.value=false;}}
onMounted(()=>{void refresh();});watch(()=>props.refreshToken,()=>{void refresh();});
</script>
<template>
<section class="ts-fields" aria-label="后台资源任务">
  <div class="section-title"><div><h2>后台资源任务</h2><p>查看所有资源的记忆提取与知识索引状态。</p></div><div class="toolbar"><select v-model="kind" aria-label="任务类型"><option value="all">全部类型</option><option value="memory_extraction">记忆提取</option><option value="knowledge_import">知识索引</option></select><button :disabled="busy" @click="refresh">刷新任务</button></div></div>
  <p v-if="error" class="notice error" role="alert">{{error}}</p>
  <div class="table-wrap"><table class="table"><thead><tr><th>任务</th><th>状态</th><th>更新时间</th><th>说明与关联运行</th></tr></thead><tbody><tr v-for="job in visible" :key="job.id"><td>{{kindLabels[job.kind]}}<br><small>{{job.id}}</small></td><td :class="{danger:job.status==='failed'}">{{labels[job.status]}}</td><td>{{time(job.updatedAt)}}</td><td><p>{{job.summary}}</p><button v-if="job.runId" @click="emit('inspect',job.runId)">查看关联运行</button></td></tr></tbody></table></div>
  <p v-if="!busy && !error && !visible.length" class="empty-state">暂无对应的后台任务。<RouterLink to="/knowledge-base">导入知识文档</RouterLink>或<RouterLink to="/memories">查看长期记忆</RouterLink>。</p>
</section>
</template>
