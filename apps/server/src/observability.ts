import { z } from 'zod';
import type { SQLInputValue } from 'node:sqlite';
import { ArtifactUploadResponseSchema, FlowSimulationSchema, RunEventSchema, RunSummarySchema, type MessageEvent, type RunContext, type AgentDefinition, type FlowSimulation, type RuntimeConfig, type RunEvent } from '../../../packages/contracts/src/index.js';
import { AgentRecordDetailSchema, AgentRecordMetadataSchema, AgentRecordSchema, RouteRecordSchema, type AgentRecord, type AgentRecordMetadata, type RouteRecord } from '../../../packages/contracts/src/observability.js';
import type { AuditPreview } from '../../../packages/contracts/src/audit.js';
import { safeAuditPreview } from '../../../packages/adapters/src/agents/audit.js';
import { StoredRunSchema, type RuntimeStore, type StoredRun } from '../../../packages/core/src/storage.js';

const ValueRow = z.object({ value: z.string() });
const CountRow = z.object({ count: z.number() });
const Identity = z.tuple([z.string(), z.enum(['private', 'group']), z.string(), z.string()]);
const EventCounts = z.object({ firstSequence: z.number().nullable(), modelCalls: z.number(), toolCalls: z.number(), usageCalls: z.number(), inputTokens: z.number(), outputTokens: z.number() });
const LinkSchema = z.object({ runId: z.string(), conversationId: z.string() });
// Persisted metadata includes private storage fields. Keep this shape separate
// from the strict public DTO and project only public fields when returning it.
const StoredArtifactSchema = z.object({
  ...ArtifactUploadResponseSchema.omit({ url: true }).shape,
  file: z.string().optional(),
  owner: z.string().optional(),
  runId: z.string().optional(),
});
const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0), platform: z.string().max(256).optional(), sessionType: z.enum(['private','group']).optional(), sessionId: z.string().max(256).optional(), agentId: z.string().max(256).optional(), search: z.string().max(500).optional(), from: z.coerce.number().nonnegative().optional(), to: z.coerce.number().nonnegative().optional(), outcome: z.enum(['agent','command','ignored','rejected','follow_up']).optional(), status: RunSummarySchema.shape.status.optional() });
export type RecordQuery = z.infer<typeof QuerySchema>;
export function parseRecordQuery(params: URLSearchParams): RecordQuery { return QuerySchema.parse(Object.fromEntries(params)); }
function decode(text: string): unknown { const value: unknown = JSON.parse(text); return value; }
function identity(key: string): z.infer<typeof Identity> | undefined { try { const parsed = Identity.safeParse(decode(key)); return parsed.success ? parsed.data : undefined; } catch { return undefined; } }
const terminal = new Set(['completed','failed','cancelled','interrupted']);

/** Local admin audit projections. No remote telemetry, no model-authored audit claims. */
export class ObservabilityService {
  constructor(private readonly store: RuntimeStore, private readonly config: () => RuntimeConfig, private readonly secrets: () => readonly string[]) {
    store.db.exec("CREATE INDEX IF NOT EXISTS document_created_at ON documents(namespace,json_extract(value,'$.createdAt') DESC)");
    store.db.exec("CREATE INDEX IF NOT EXISTS document_run_created_at ON documents(namespace,json_extract(value,'$.runId'),json_extract(value,'$.createdAt')); CREATE INDEX IF NOT EXISTS document_parent_run ON documents(namespace,json_extract(value,'$.parentRunId'))");
    this.backfillRoutes();
  }
  private preview(value: unknown, maxChars = 4000) { return safeAuditPreview(value, { maxChars, knownSecrets: this.secrets() }); }
  private backfillRoutes(): void {
    if (this.store.get('observability-settings','legacy-routes-v1',z.boolean())) return;
    const rows = this.store.db.prepare("SELECT d.value AS run,t.value AS trace FROM documents d JOIN documents t ON t.namespace='flow-traces' AND t.id=d.id WHERE d.namespace='runs'").all();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const values = z.object({ run: z.string(), trace: z.string() }).parse(row);
        const run = StoredRunSchema.parse(decode(values.run)); const parsed = FlowSimulationSchema.safeParse(decode(values.trace)); const owner = identity(run.sessionKey);
        if (!parsed.success || !owner || this.store.get('route-records',run.id,RouteRecordSchema)) continue;
        const [platform,sessionType,sessionId] = owner; const trace = parsed.data;
        const handled = this.store.db.prepare("SELECT 1 FROM events WHERE run_id=? AND json_extract(value,'$.type')='node' AND json_extract(value,'$.nodeId')='command' AND json_extract(value,'$.status')='completed' AND json_extract(value,'$.summary')!='unhandled' LIMIT 1").get(run.id)!==undefined;
        const outcome = handled ? 'command' : trace.outcome;
        const record = RouteRecordSchema.parse({ id:run.id,createdAt:run.createdAt,durationMs:null,configRevision:null,flowRevision:trace.revision,platform,platformType:this.config().platforms.find(item=>item.id===platform)?.type??(platform==='dashboard'?'telegram':null),sessionType,sessionId,senderId:run.senderId,messageId:null,inputPreview:null,outcome,reason:this.preview(trace.reason??'',1000).text,agentId:trace.agentId??null,runtimeState:trace.runtimeState??null,runId:outcome==='agent'||outcome==='command'?run.id:null,path:this.routePath(trace),legacy:true });
        this.store.put('route-records',record.id,record);
      }
      this.store.put('observability-settings','legacy-routes-v1',true);this.store.db.exec('COMMIT');
    } catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  private routePath(trace: FlowSimulation) { return trace.path.filter(step=>['input','normalize','accept','authorize','route','command','end'].includes(step.nodeId)).map(step=>({...step,summary:this.preview(step.summary,500).text,durationMs:null})); }
  recordRoute(id: string, message: MessageEvent, config: RuntimeConfig, trace: FlowSimulation, durationMs: number, runId: string | null, followUp = false): void {
    const input = message.parts.map(part => part.type==='text'?part.text:part.type==='mention'?`@${part.name??part.userId}`:part.type==='quote'?`[引用 ${part.messageId}]`:part.type==='image'?'[图片]':part.type==='file'?`[文件 ${part.name}]`:'[引用资料]').join('\n');
    const record=RouteRecordSchema.parse({id,createdAt:Date.now(),durationMs:Math.max(0,durationMs),configRevision:config.revision,flowRevision:config.flow.revision,platform:message.platform,platformType:message.platformType,sessionType:message.sessionType,sessionId:message.sessionId,sessionName:message.sessionName??'',senderId:message.senderId,senderName:message.senderName,messageId:message.messageId,inputPreview:this.preview(input,1000),outcome:followUp?'follow_up':trace.outcome,reason:trace.reason??(followUp?'追加到当前任务':''),agentId:trace.agentId??null,runtimeState:trace.runtimeState??null,runId,path:this.routePath(trace),legacy:false});
    this.store.put('route-records',id,record);
  }
  commandHandled(runId: string): void { const route=this.store.get('route-records',runId,RouteRecordSchema);if(route)this.store.put('route-records',runId,{...route,outcome:'command',reason:'由指令处理器接管',path:route.path.map(step=>step.nodeId==='command'?{...step,summary:'指令已由处理器接管'}:step)}); }
  registerAgent(context: RunContext, agent: AgentDefinition, message: MessageEvent): void {
    if(this.store.get('agent-record-metadata',context.runId,AgentRecordMetadataSchema))return;
    const route=this.store.get('route-records',context.runId,RouteRecordSchema);
    if (route && route.outcome !== 'agent') this.store.put('route-records', route.id, { ...route, outcome: 'agent', reason: '进入 Agent 执行' });
    const metadata:AgentRecordMetadata={runId:context.runId,platform:message.platform,platformType:message.platformType,sessionType:message.sessionType,sessionId:message.sessionId,sessionName:message.sessionName??'',model:agent.model,engine:agent.engine,runtimeState:context.runtimeState,configRevision:context.configRevision,flowRevision:context.flowRevision,inputPreview:this.preview(message.parts),startedAt:Date.now(),routeRecordId:route?.id??null,parentRunId:context.parentRunId??null};
    this.store.put('agent-record-metadata',context.runId,AgentRecordMetadataSchema.parse(metadata));
  }
  private filters(query:RecordQuery,base:string,fields:Readonly<Record<string,string>>):{sql:string;values:SQLInputValue[]} {
    const clauses=[base];const values:SQLInputValue[]=[];
    for(const key of ['platform','sessionType','sessionId','agentId','outcome','status'] satisfies (keyof RecordQuery)[]){const value=query[key];const expression=fields[key];if(typeof value==='string'&&value&&expression){clauses.push(`${expression}=?`);values.push(value);}}
    if(query.search){clauses.push(`instr(lower(${fields['search']??'d.value'}),lower(?))>0`);values.push(query.search);}
    if(query.from!==undefined){clauses.push(`${fields['createdAt']??"json_extract(d.value,'$.createdAt')"}>=?`);values.push(query.from);}
    if(query.to!==undefined){clauses.push(`${fields['createdAt']??"json_extract(d.value,'$.createdAt')"}<=?`);values.push(query.to);}
    return {sql:clauses.join(' AND '),values};
  }
  private presentRoute(record: RouteRecord): RouteRecord {
    return { ...record, inputPreview: record.inputPreview ? this.recheckPreview(record.inputPreview) : null, reason: this.preview(record.reason,1000).text, path: record.path.map(step => ({ ...step, summary: this.preview(step.summary,500).text })) };
  }
  routes(query:RecordQuery) {
    const filter=this.filters(query,"d.namespace='route-records'",{platform:"json_extract(d.value,'$.platform')",sessionType:"json_extract(d.value,'$.sessionType')",sessionId:"json_extract(d.value,'$.sessionId')",agentId:"json_extract(d.value,'$.agentId')",outcome:"json_extract(d.value,'$.outcome')"});
    const total=CountRow.parse(this.store.db.prepare(`SELECT count(*) count FROM documents d WHERE ${filter.sql}`).get(...filter.values)).count;
    const records=this.store.db.prepare(`SELECT d.value FROM documents d WHERE ${filter.sql} ORDER BY json_extract(d.value,'$.createdAt') DESC,d.id DESC LIMIT ? OFFSET ?`).all(...filter.values,query.limit,query.offset).map(row=>this.presentRoute(RouteRecordSchema.parse(decode(ValueRow.parse(row).value))));
    return {records,total,offset:query.offset,limit:query.limit};
  }
  route(id:string) { const record=this.store.get('route-records',id,RouteRecordSchema);if(!record)throw new RecordNotFound();const run=record.runId?this.store.get('runs',record.runId,StoredRunSchema):undefined;return {record:this.presentRoute(record),run:run?{...run,summary:this.preview(run.summary).text}:null,relatedAgentRunIds:run&&this.isAgentRun(run.id)?[run.id]:[]}; }
  recordLink(id: string): { kind: 'route' | 'agent'; id: string } {
    if (this.isAgentRun(id)) return { kind: 'agent', id };
    const route = this.store.get('route-records', id, RouteRecordSchema) ?? this.relatedRoutes(id)[0];
    if (route) return { kind: 'route', id: route.id };
    throw new RecordNotFound();
  }
  private isAgentRun(id:string):boolean {return this.store.db.prepare("SELECT 1 FROM documents WHERE namespace='agent-record-metadata' AND id=? UNION ALL SELECT 1 FROM events WHERE run_id=? AND (json_extract(value,'$.type') IN ('started','model_call') OR (json_extract(value,'$.type')='node' AND json_extract(value,'$.nodeId') IN ('context','agent'))) LIMIT 1").get(id,id)!==undefined;}
  agents(query:RecordQuery) {
    const join="documents d LEFT JOIN documents m ON m.namespace='agent-record-metadata' AND m.id=d.id";
    const base="d.namespace='runs' AND (m.id IS NOT NULL OR EXISTS(SELECT 1 FROM events e WHERE e.run_id=d.id AND (json_extract(e.value,'$.type') IN ('started','model_call') OR (json_extract(e.value,'$.type')='node' AND json_extract(e.value,'$.nodeId') IN ('context','agent')))))";
    const platform="coalesce(json_extract(m.value,'$.platform'),CASE WHEN json_valid(json_extract(d.value,'$.sessionKey')) THEN json_extract(json_extract(d.value,'$.sessionKey'),'$[0]') END)";
    const type="coalesce(json_extract(m.value,'$.sessionType'),CASE WHEN json_valid(json_extract(d.value,'$.sessionKey')) THEN json_extract(json_extract(d.value,'$.sessionKey'),'$[1]') END)";
    const session="coalesce(json_extract(m.value,'$.sessionId'),CASE WHEN json_valid(json_extract(d.value,'$.sessionKey')) THEN json_extract(json_extract(d.value,'$.sessionKey'),'$[2]') END)";
    const filter=this.filters(query,base,{platform,sessionType:type,sessionId:session,agentId:"json_extract(d.value,'$.agentId')",status:"json_extract(d.value,'$.status')"});
    const total=CountRow.parse(this.store.db.prepare(`SELECT count(*) count FROM ${join} WHERE ${filter.sql}`).get(...filter.values)).count;
    const records=this.store.db.prepare(`SELECT d.value FROM ${join} WHERE ${filter.sql} ORDER BY json_extract(d.value,'$.createdAt') DESC,d.id DESC LIMIT ? OFFSET ?`).all(...filter.values,query.limit,query.offset).map(row=>this.agentSummary(StoredRunSchema.parse(decode(ValueRow.parse(row).value))));
    return {records,total,offset:query.offset,limit:query.limit};
  }
  private relatedRoutes(runId:string):RouteRecord[] {return this.store.db.prepare("SELECT value FROM documents WHERE namespace='route-records' AND json_extract(value,'$.runId')=? ORDER BY json_extract(value,'$.createdAt') LIMIT 200").all(runId).map(row=>this.presentRoute(RouteRecordSchema.parse(decode(ValueRow.parse(row).value))));}
  private agentSummary(run:StoredRun):AgentRecord {
    const metadata=this.store.get('agent-record-metadata',run.id,AgentRecordMetadataSchema);const owner=identity(run.sessionKey);const routes=this.relatedRoutes(run.id);
    const counts=EventCounts.parse(this.store.db.prepare(`SELECT min(sequence) firstSequence,
      count(DISTINCT CASE WHEN json_extract(value,'$.type')='model_call' THEN json_extract(value,'$.callId') END) modelCalls,
      count(DISTINCT CASE WHEN json_extract(value,'$.type')='tool' THEN json_extract(value,'$.callId') END) toolCalls,
      coalesce(sum(CASE WHEN json_extract(value,'$.type')='usage' AND coalesce(json_extract(value,'$.source'),'model')!='delegation' THEN 1 ELSE 0 END),0) usageCalls,
      coalesce(sum(CASE WHEN json_extract(value,'$.type')='usage' AND coalesce(json_extract(value,'$.source'),'model')!='delegation' THEN json_extract(value,'$.inputTokens') ELSE 0 END),0) inputTokens,
      coalesce(sum(CASE WHEN json_extract(value,'$.type')='usage' AND coalesce(json_extract(value,'$.source'),'model')!='delegation' THEN json_extract(value,'$.outputTokens') ELSE 0 END),0) outputTokens
      FROM (SELECT sequence,value FROM events WHERE run_id=? ORDER BY sequence DESC LIMIT 2000)`).get(run.id));
    const link=this.store.get('management-run-links',run.id,LinkSchema);const conversationId=link&&this.store.db.prepare("SELECT 1 FROM documents WHERE namespace='management-conversations' AND id=?").get(link.conversationId)?link.conversationId:null;
    const timing=this.store.db.prepare("SELECT json_extract(value,'$.firstTokenMs') firstTokenMs FROM events WHERE run_id=? AND json_extract(value,'$.type')='model_call' AND json_extract(value,'$.source')='model' AND json_type(value,'$.firstTokenMs') IS NOT NULL ORDER BY sequence LIMIT 1").get(run.id);
    const firstTokenMs=timing?z.object({firstTokenMs:z.number().nonnegative()}).parse(timing).firstTokenMs:null;
    const platform=metadata?.platform??owner?.[0]??null;
    return AgentRecordSchema.parse({...run,summary:this.preview(run.summary).text,platform,platformType:metadata?.platformType??this.config().platforms.find(item=>item.id===platform)?.type??(platform==='dashboard'?'telegram':null),sessionType:metadata?.sessionType??owner?.[1]??null,sessionId:metadata?.sessionId??owner?.[2]??null,sessionName:metadata?.sessionName??'',conversationId,routeRecordIds:routes.map(route=>route.id),model:metadata?.model??null,engine:metadata?.engine??null,runtimeState:metadata?.runtimeState??routes[0]?.runtimeState??null,modelCalls:counts.modelCalls||(counts.usageCalls?counts.usageCalls:metadata?0:null),toolCalls:counts.toolCalls||(metadata?0:null),inputTokens:counts.usageCalls||metadata?counts.inputTokens:null,outputTokens:counts.usageCalls||metadata?counts.outputTokens:null,durationMs:terminal.has(run.status)&&metadata?Math.max(0,run.updatedAt-metadata.startedAt):null,firstTokenMs,telemetryComplete:!!metadata&&counts.modelCalls>0&&(counts.firstSequence??0)===0,legacy:!metadata});
  }
  private recheckPreview(value: AuditPreview): AuditPreview {
    const safe = this.preview(value.text, 8000);
    return { ...safe, originalChars: value.originalChars, truncated: value.truncated || safe.truncated, redacted: value.redacted || safe.redacted };
  }
  private auditEvents(events:readonly RunEvent[]):RunEvent[] {
    const result:RunEvent[]=[];let pending:Extract<RunEvent,{type:'message_delta'}>|undefined;
    const flush=():void=>{if(pending){result.push({...pending,type:'message_snapshot',text:this.preview(pending.text,8000).text});pending=undefined;}};
    for(const event of events){
      if(event.type==='message_delta'){if(pending&&pending.turnId===event.turnId)pending={...event,text:pending.text+event.text};else{flush();pending={...event};}continue;}
      flush();
      switch(event.type){
        case 'message_snapshot':case 'completed':result.push({...event,text:this.preview(event.text,8000).text});break;
        case 'tool':result.push({...event,summary:this.preview(event.summary,1000).text,...(event.inputPreview?{inputPreview:this.recheckPreview(event.inputPreview)}:{}),...(event.outputPreview?{outputPreview:this.recheckPreview(event.outputPreview)}:{})});break;
        case 'model_call':result.push({...event,...(event.inputPreview?{inputPreview:this.recheckPreview(event.inputPreview)}:{}),...(event.outputPreview?{outputPreview:this.recheckPreview(event.outputPreview)}:{}),...(event.error?{error:this.preview(event.error,500).text}:{})});break;
        case 'node':result.push({...event,summary:this.preview(event.summary,500).text});break;
        case 'failed':result.push({...event,error:{...event.error,message:this.preview(event.error.message,500).text}});break;
        case 'cancelled':result.push({...event,reason:this.preview(event.reason,500).text});break;
        default:result.push(event);
      }
    }
    flush();return result.map(event=>RunEventSchema.parse(event));
  }
  agent(id:string) {
    const run=this.store.get('runs',id,StoredRunSchema);if(!run||!this.isAgentRun(id))throw new RecordNotFound();
    const events=this.store.events(id);const record=this.agentSummary(run);const metadata=this.store.get('agent-record-metadata',id,AgentRecordMetadataSchema);
    const children=this.store.db.prepare("SELECT value FROM documents WHERE namespace='runs' AND json_extract(value,'$.parentRunId')=? ORDER BY json_extract(value,'$.createdAt') LIMIT 100").all(id).map(row=>StoredRunSchema.parse(decode(ValueRow.parse(row).value))).filter(child=>this.isAgentRun(child.id)).map(child=>this.agentSummary(child));
    const artifacts=this.store.db.prepare("SELECT value FROM documents WHERE namespace='artifacts' AND json_extract(value,'$.runId')=? LIMIT 100").all(id).map(row=>{
      const item=StoredArtifactSchema.parse(decode(ValueRow.parse(row).value));
      return ArtifactUploadResponseSchema.parse({id:item.id,url:`artifact:${item.id}`,name:item.name,mimeType:item.mimeType,size:item.size});
    });
    const first=events[0]?.sequence??null;const limitations=['模型记录表示 SDK 调用，不推测供应商内部重试。','预览已脱敏并限制长度；工具输出是模型实际收到的结果摘录。','不记录或推测模型隐藏思考。'];
    if(record.legacy)limitations.push('旧记录没有完整模型调用明细，未知数据保持为空。');if(first!==null&&first>0)limitations.push('早期事件已超过保留上限，统计仅基于当前保留事件。');
    return AgentRecordDetailSchema.parse({record,inputPreview:metadata?.inputPreview?this.recheckPreview(metadata.inputPreview):null,events:this.auditEvents(events),children,routes:this.relatedRoutes(id),artifacts,audit:{version:1,retainedEvents:events.length,firstSequence:first,lastSequence:events.at(-1)?.sequence??null,eventsTruncated:first!==null&&first>0,redaction:'bounded_redacted',limitations}});
  }
}
export class RecordNotFound extends Error {}
