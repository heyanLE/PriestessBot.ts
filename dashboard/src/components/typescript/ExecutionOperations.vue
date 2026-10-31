<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { EnvironmentsResponseSchema, ProcessesResponseSchema, RunsResponseSchema, type EnvironmentsResponse, type ProcessesResponse } from '../../../../packages/contracts/src/index';
import { RouterLink } from 'vue-router';
import { confirmDestructiveAction } from '../../composables/unsaved';
import { runtimeAction, runtimeRequest } from '../../api/typescript';
const emit=defineEmits<{ 'open-settings': []; inspect: [runId: string] }>();
const props=defineProps<{ initialRunId?:string }>();
const environments=ref<EnvironmentsResponse['environments']>([]);
const processes=ref<ProcessesResponse['processes']>([]);
const runs=ref<ReturnType<typeof RunsResponseSchema.parse>['runs']>([]);
const runId=ref(props.initialRunId ?? '');
const busy=ref(false), error=ref(''), notice=ref('');
const labels:Readonly<Record<string,string>>={running:'执行中',completed:'已完成',failed:'失败',cancelled:'已终止'};
async function action(fn:()=>Promise<void>){busy.value=true;error.value='';notice.value='';try{await fn();}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}finally{busy.value=false;}}
async function loadProcesses(){const selected=runId.value;if(!selected){processes.value=[];return;}const result=await runtimeRequest(`processes?runId=${encodeURIComponent(selected)}`,ProcessesResponseSchema);if(runId.value===selected)processes.value=result.processes;}
async function refresh(){const [environmentResult,runResult]=await Promise.all([runtimeRequest('environments',EnvironmentsResponseSchema),runtimeRequest('runs',RunsResponseSchema)]);environments.value=environmentResult.environments;runs.value=runResult.runs;await loadProcesses();}
async function changeRun(){processes.value=[];await action(loadProcesses);}
async function kill(id:string){const selected=runId.value;if(!selected || !confirmDestructiveAction('终止此进程？SDK Docker 会同时停止该任务容器中的其他进程，已写入的工作文件会保留。'))return;await action(async()=>{await runtimeAction(`processes/${encodeURIComponent(id)}/kill`,{runId:selected});await loadProcesses();notice.value='已提交终止请求，进程状态以最新查询为准。';});}
onMounted(()=>{void action(refresh);});
watch(() => props.initialRunId, value => { if (value && value !== runId.value) { runId.value = value; void changeRun(); } });
</script>
<template>
<section class="panel ts-fields">
  <p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="notice" class="notice ok" role="status">{{notice}}</p>
  <div class="section-title"><div><h2>执行环境能力</h2><p>查看已注册后端的可用性与隔离方式。</p></div><button :disabled="busy" @click="action(refresh)">刷新执行环境</button></div>
  <div class="table-wrap"><table class="table"><thead><tr><th>环境</th><th>后端</th><th>可用性</th><th>隔离方式</th></tr></thead><tbody><tr v-for="environment in environments" :key="environment.id"><td>{{environment.id}}</td><td>{{environment.type==='sdk_docker'?'SDK Docker':environment.type==='local'?'本机进程':'Docker'}}</td><td><span :class="['inline-status',environment.available?'ok':'warn']">{{environment.available?'可用':'不可用'}}</span></td><td>{{environment.isolation==='container'?'容器隔离':'受信任宿主机'}}</td></tr></tbody></table></div>
  <p v-if="!busy && !environments.length" class="empty-state">尚未配置执行环境。<button @click="emit('open-settings')">前往环境配置</button>添加工作根目录。</p>
  <div class="section-title"><div><h2>后台进程</h2><p>先选择运行，再查看进程输出。终止立即生效，由服务端校验归属。</p></div><button :disabled="busy || !runId" @click="action(loadProcesses)">刷新进程</button></div>
  <label>所属运行<select v-model="runId" :disabled="busy" @change="changeRun"><option value="">选择运行</option><option v-for="run in runs" :key="run.id" :value="run.id">{{run.agentId || '路由'}} · {{run.id}}</option></select></label>
  <div class="toolbar"><button v-if="runId" @click="emit('inspect', runId)">查看所属执行记录</button><RouterLink to="/files">管理工作文件</RouterLink></div><p v-if="!busy && !runId" class="empty-state">选择一次运行查看进程，也可以先到 <RouterLink to="/runs">执行记录</RouterLink> 找到需要排查的任务。</p><p v-if="!busy && runId && !processes.length" class="empty-state">该运行暂无后台进程</p>
  <article v-for="process in processes" :key="process.id" class="card ts-fields"><div class="section-title compact"><div><strong>{{process.id}}</strong><p>{{labels[process.status]}}<span v-if="process.exitCode !== undefined"> · 退出码 {{process.exitCode}}</span></p></div><button v-if="process.status==='running'" class="danger" :disabled="busy" @click="kill(process.id)">终止进程</button></div><p v-if="process.truncated" class="notice">输出已截断，仅显示当前保留片段。</p><pre class="code-block">{{process.output || '暂无输出'}}</pre><small class="muted">输出位置 {{process.offset}}</small></article>
</section>
</template>
