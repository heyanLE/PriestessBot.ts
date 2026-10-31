import { runtimeStateLabels, type RunEvent, type PlatformType, type FlowNodeId } from '../../../../packages/contracts/src/index';
import { RouteOutcomeSchema, type RouteRecordDetailSchema, type AgentRecord, type RouteRecord } from '../../../../packages/contracts/src/observability';
import type { AuditPreview } from '../../../../packages/contracts/src/audit';

export const agentStatusLabels: Readonly<Record<AgentRecord['status'],string>> = {queued:'排队中',running:'执行中',paused:'等待审批',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export const routeOutcomeLabels: Readonly<Record<RouteRecord['outcome'],string>> = {agent:'进入 Agent',command:'处理指令',ignored:'已忽略',rejected:'已拒绝',follow_up:'追加到现有任务'};
type RouteDetail = ReturnType<typeof RouteRecordDetailSchema.parse>;
export function routeAgentRunIds(detail:RouteDetail):string[] { return [...new Set(detail.relatedAgentRunIds)]; }
export function routeProcessingState(detail:RouteDetail):{label:string;summary:string;note:string}|null {
  if(detail.relatedAgentRunIds.length||!detail.run)return null;
  const note=detail.record.outcome==='command'?'此消息由指令处理器接管，未启动 Agent。':detail.run.status==='queued'?'任务正在排队，尚未启动 Agent。':'此处理没有关联 Agent 运行。';
  return {label:agentStatusLabels[detail.run.status],summary:detail.run.summary,note};
}
export const routeNodeLabels: Readonly<Record<FlowNodeId,string>> = {input:'消息接入',normalize:'消息整理',accept:'消息准入',authorize:'运行态授权',route:'Agent 分配',command:'指令识别',context:'上下文范围',agent:'Agent 检查',deliver:'回复检查',end:'结束路由判断'};
const routeSummaryLabels: Readonly<Record<string,string>> = {
  'Accepted':'消息满足接入条件', 'Normal conversation':'普通对话，继续交给 Agent', 'Complete':'路由判断完成',
  'Message exceeds character budget':'消息超过字符上限', 'Conversation is not in the allowlist':'此会话不在允许列表中',
  'Private messages disabled':'已关闭私聊接入', 'Group message does not mention or reply to this bot':'群消息未提及或回复此机器人',
  'No enabled Agent selected':'未找到可用的目标 Agent', 'Authorization failed':'运行态授权失败',
  'Chat capability denied':'当前运行态没有对话权限', 'Authorized memory and knowledge only':'仅使用已授权的记忆和知识库', 'Preview only':'此步骤仅检查配置',
};
export function routeSummaryText(summary:string):string { return routeSummaryLabels[summary] ?? summary; }
export function routeStepSummary(step:RouteRecord['path'][number]):string {
  const translated=routeSummaryText(step.summary);if(translated!==step.summary)return translated;
  if(step.nodeId==='authorize'&&(step.summary==='operator'||step.summary==='senior_operator'||step.summary==='elite_operator'))return `分配运行态：${runtimeStateLabels[step.summary]}`;
  if(step.nodeId==='normalize'){const count=/^(\d+) content parts$/.exec(step.summary)?.[1];if(count)return `已整理 ${count} 个消息片段`;}
  if(step.nodeId==='command'&&step.summary.startsWith('Command: '))return `识别到指令：${step.summary.slice(9)}`;
  if(step.nodeId==='route'&&step.status==='passed')return `选择 Agent：${step.summary}`;
  if(step.nodeId==='input'&&(step.summary.endsWith('/private')||step.summary.endsWith('/group'))){const split=step.summary.lastIndexOf('/');return `${step.summary.slice(0,split)} · ${step.summary.slice(split+1)==='group'?'群聊':'私聊'}`;}
  return step.summary;
}
export interface RecordFilters { platform: string; sessionType: ''|'private'|'group'; sessionId: string; agentId: string; search: string; from: string; to: string; status: ''|AgentRecord['status']; outcome: ''|RouteRecord['outcome']; }
function scalar(value: unknown): string { return typeof value==='string'?value:''; }
export function recordFiltersFromQuery(query: Readonly<Record<string,unknown>>): RecordFilters {
  const type=scalar(query['sessionType']);const status=scalar(query['status']);const outcome=RouteOutcomeSchema.safeParse(query['outcome']);
  const recognizedStatus=status==='queued'||status==='running'||status==='paused'||status==='completed'||status==='failed'||status==='cancelled'||status==='interrupted';
  return {platform:scalar(query['platform']),sessionType:type==='private'||type==='group'?type:'',sessionId:scalar(query['sessionId']),agentId:scalar(query['agentId']),search:scalar(query['search']),from:scalar(query['from']),to:scalar(query['to']),status:recognizedStatus?status:'',outcome:outcome.success?outcome.data:''};
}
export function recordOffset(value: unknown): number { const number=Number(scalar(value));return Number.isSafeInteger(number)&&number>=0?number:0; }
function timestamp(value: string): number | undefined { if(!value)return undefined;const number=/^\d+$/.test(value)?Number(value):new Date(value).getTime();if(!Number.isFinite(number))throw new Error('时间格式无效。请重新选择起止时间。');return number; }
export function recordSearchParams(filters: RecordFilters, kind: 'route'|'agent', offset=0, limit=50): string {
  const from=timestamp(filters.from);const to=timestamp(filters.to);if(from!==undefined&&to!==undefined&&from>to)throw new Error('开始时间晚于结束时间。请调整时间范围。');
  const params=new URLSearchParams({offset:String(offset),limit:String(limit)});
  for(const key of ['platform','sessionType','sessionId','agentId','search']){
    const value=key==='platform'?filters.platform:key==='sessionType'?filters.sessionType:key==='sessionId'?filters.sessionId:key==='agentId'?filters.agentId:filters.search;
    if(value.trim())params.set(key,value.trim());
  }
  if(from!==undefined)params.set('from',String(from));if(to!==undefined)params.set('to',String(to));
  if(kind==='agent'&&filters.status)params.set('status',filters.status);if(kind==='route'&&filters.outcome)params.set('outcome',filters.outcome);
  return params.toString();
}
export function formatRecordTime(value: number): string { return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(value); }
export function formatRecordDuration(value: number | null | undefined): string { return value===null||value===undefined?'未记录':value<1000?`${Math.round(value)} ms`:`${(value/1000).toFixed(2)} 秒`; }
export function formatRecordMetric(value: number | null | undefined): string { return value===null||value===undefined?'未知':value.toLocaleString('zh-CN'); }
export function recordedTokenTotal(input: number | null, output: number | null): number | null { return input===null||output===null?null:input+output; }
export function recordPlatform(platform: string | null, type: PlatformType | null): string { return platform==='dashboard'?'控制台':type==='napcat'?'QQ / NapCat':type==='telegram'?'Telegram':type==='weixin'?'微信':platform || '来源未记录'; }

export interface ExecutionStep {
  readonly key: string; readonly kind: 'model'|'tool'; readonly callId: string; readonly firstSequence: number; readonly timestamp: number;
  name: string; source: 'model'|'compression'|'finalization'|null; status: 'started'|'completed'|'failed'|'cancelled';
  input: AuditPreview|null; output: AuditPreview|null; durationMs: number|null; firstTokenMs: number|null; inputTokens: number|null; outputTokens: number|null; modelCall: number|null; summary: string;
}
/** Pair start/end events by actual call ID; missing data remains unknown, never inferred. */
export function executionSteps(events: readonly RunEvent[]): ExecutionStep[] {
  const calls=new Map<string,ExecutionStep>(); const seen=new Set<string>();
  for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)){
    const eventKey=`${event.runId}:${event.sequence}`;if(seen.has(eventKey))continue;seen.add(eventKey);
    if(event.type!=='model_call'&&event.type!=='tool')continue;
    const key=`${event.runId}:${event.type}:${event.callId}`;
    const current:ExecutionStep=calls.get(key) ?? {key,kind:event.type==='model_call'?'model':'tool',callId:event.callId,firstSequence:event.sequence,timestamp:event.timestamp,name:'',source:null,status:event.status,input:null,output:null,durationMs:null,firstTokenMs:null,inputTokens:null,outputTokens:null,modelCall:null,summary:''};
    current.name=event.type==='model_call'?event.model:event.name;current.status=event.status;
    current.input=event.inputPreview ?? current.input;current.output=event.outputPreview ?? current.output;current.durationMs=event.durationMs ?? current.durationMs;
    if(event.type==='model_call'){current.source=event.source;current.firstTokenMs=event.firstTokenMs ?? current.firstTokenMs;current.inputTokens=event.inputTokens ?? current.inputTokens;current.outputTokens=event.outputTokens ?? current.outputTokens;current.summary=event.error ?? current.summary;}
    else {current.modelCall=event.modelCall ?? current.modelCall;current.summary=event.summary || current.summary;}
    calls.set(key,current);
  }
  return [...calls.values()].sort((a,b)=>a.firstSequence-b.firstSequence);
}
export function finalRecordedReply(events: readonly RunEvent[]): string {
  const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);const completed=ordered.filter(event=>event.type==='completed').at(-1);
  if(completed?.type==='completed')return completed.text;
  const snapshot=ordered.filter(event=>event.type==='message_snapshot').at(-1);
  return snapshot?.type==='message_snapshot'?snapshot.text:'';
}
export function compactRunEvent(event: RunEvent): string {
  switch(event.type){case 'started':return `开始运行 ${event.agentId}`;case 'node':return `${event.nodeId} · ${event.status} · ${event.summary}`;case 'model_call':return `${event.model} · ${event.status}`;case 'tool':return `${event.name} · ${event.status}`;case 'usage':return `输入 ${event.inputTokens} / 输出 ${event.outputTokens} Token`;case 'completed':return 'Agent 已完成';case 'failed':return event.error.message;case 'cancelled':return event.reason;case 'paused':return `等待审批：${event.tools.join('、')}`;case 'message_delta':case 'message_snapshot':return event.text;}
}
