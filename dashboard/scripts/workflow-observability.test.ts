import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunEventSchema } from '../../packages/contracts/src/index.ts';
import { RouteRecordDetailSchema } from '../../packages/contracts/src/observability.ts';
import { ConversationSchema } from '../../packages/contracts/src/management.ts';
import { executionSteps, finalRecordedReply, formatRecordDuration, formatRecordMetric, recordedTokenTotal, recordFiltersFromQuery, recordSearchParams, recordOffset, routeNodeLabels, routeStepSummary, routeSummaryText, routeAgentRunIds, routeProcessingState } from '../src/components/typescript/observability-model.ts';
import { conversationFiltersFromQuery, filterConversations, conversationOrigin } from '../src/components/typescript/conversation-workspace-model.ts';
import { resolveRunRecordDestination, recoverLegacyCommandDestination } from '../src/components/typescript/run-record-navigation.ts';
import { RuntimeRequestError } from '../src/api/typescript.ts';

const input={text:'bounded input',originalChars:13,truncated:false,redacted:true};const output={text:'bounded output',originalChars:100,truncated:true,redacted:true};
function conversation(change: Record<string,unknown>={}) { return ConversationSchema.parse({id:'one',revision:1,createdAt:1,updatedAt:1,identity:'identity',sessionKey:'session-key',platform:'napcat-a',platformType:'napcat',sessionId:'group-1',sessionType:'group',agentId:'assistant',generation:0,ownerId:'user',title:'QQ group',folderId:'old-folder',...change}); }

test('flat conversation defaults retain NapCat and archived histories regardless of old folders', () => {
  const rows=[conversation(),conversation({id:'two',folderId:'another-old-folder',archived:true,updatedAt:2})];
  assert.deepEqual(filterConversations(rows,conversationFiltersFromQuery({})).map(row=>row.id),['two','one']);
  assert.equal(conversationOrigin(rows[0] ?? conversation()),'QQ / NapCat');
  assert.equal(conversationOrigin(conversation({platform:'dashboard',platformType:'telegram'})),'控制台');
});

test('conversation filters match exact platform, Agent and session type without re-filtering full-text matches', () => {
  const rows=[conversation(),conversation({id:'other-platform',platform:'napcat-ab'}),conversation({id:'private',sessionType:'private'}),conversation({id:'other-agent',agentId:'second'}),conversation({id:'other-session',sessionId:'group-10'})];
  const filters=conversationFiltersFromQuery({platform:'napcat-a',agent:'assistant',sessionType:'group',sessionId:'group-1',search:'only found in message body'});
  assert.deepEqual(filterConversations(rows,filters).map(row=>row.id),['one']);
  assert.equal(conversationFiltersFromQuery({archived:'true'}).archived,'archived');
  assert.equal(conversationFiltersFromQuery({platform:['invalid']}).platform,'');
});

test('model and tool events pair by call kind and ID while preserving previews and measured zeroes', () => {
  const events=[
    RunEventSchema.parse({type:'model_call',runId:'run-1',turnId:'turn',sequence:1,timestamp:100,callId:'same-id',model:'test-model',source:'model',status:'started',inputPreview:input}),
    RunEventSchema.parse({type:'tool',runId:'run-1',turnId:'turn',sequence:2,timestamp:101,callId:'same-id',name:'read_file',status:'started',summary:'reading',inputPreview:input}),
    RunEventSchema.parse({type:'model_call',runId:'run-1',turnId:'turn',sequence:3,timestamp:102,callId:'same-id',model:'test-model',source:'model',status:'completed',outputPreview:output,durationMs:0,firstTokenMs:0,inputTokens:0,outputTokens:7}),
    RunEventSchema.parse({type:'tool',runId:'run-1',turnId:'turn',sequence:4,timestamp:103,callId:'same-id',name:'read_file',status:'completed',summary:'done',outputPreview:output,durationMs:2,modelCall:1}),
  ];
  const last=events.at(-1);assert.ok(last);
  const steps=executionSteps([...events].reverse().concat(last));assert.equal(steps.length,2);
  assert.equal(steps[0]?.kind,'model');assert.deepEqual(steps[0]?.input,input);assert.deepEqual(steps[0]?.output,output);assert.equal(steps[0]?.durationMs,0);assert.equal(steps[0]?.firstTokenMs,0);assert.equal(steps[0]?.inputTokens,0);
  assert.equal(steps[1]?.kind,'tool');assert.equal(steps[1]?.modelCall,1);assert.equal(steps[1]?.status,'completed');
});

test('partial legacy tool events do not fabricate inputs, duration or usage', () => {
  const steps=executionSteps([RunEventSchema.parse({type:'tool',runId:'legacy',turnId:'turn',sequence:7,timestamp:100,callId:'legacy-tool',name:'read_file',status:'completed',summary:'legacy result'})]);
  assert.equal(steps[0]?.input,null);assert.equal(steps[0]?.output,null);assert.equal(steps[0]?.durationMs,null);assert.equal(steps[0]?.inputTokens,null);
  assert.equal(formatRecordDuration(null),'未记录');assert.equal(formatRecordDuration(0),'0 ms');assert.equal(formatRecordMetric(null),'未知');assert.equal(formatRecordMetric(0),'0');
  assert.equal(recordedTokenTotal(12,null),null);assert.equal(recordedTokenTotal(0,0),0);
});

test('record queries encode exact scope and reject reversed time ranges', () => {
  const filters=recordFiltersFromQuery({platform:'qq&test',sessionType:'group',sessionId:'123',agentId:'assistant',outcome:'ignored',status:'failed',from:'2026-10-30T08:00',to:'2026-10-30T09:00'});
  const query=new URLSearchParams(recordSearchParams(filters,'route',50));
  assert.equal(query.get('platform'),'qq&test');assert.equal(query.get('offset'),'50');assert.equal(query.get('outcome'),'ignored');assert.equal(query.has('status'),false);assert.ok(Number(query.get('from'))<Number(query.get('to')));
  assert.throws(()=>recordSearchParams({...filters,from:filters.to,to:filters.from},'agent'),/开始时间晚于结束时间/);
  assert.equal(recordOffset('-1'),0);assert.equal(recordOffset('bad'),0);assert.equal(recordOffset('50'),50);
});

test('final reply uses the latest recorded final message, without inventing from failure summaries', () => {
  const events=[RunEventSchema.parse({type:'message_snapshot',runId:'run',turnId:'turn',sequence:1,timestamp:1,text:'partial'}),RunEventSchema.parse({type:'completed',runId:'run',turnId:'turn',sequence:2,timestamp:2,text:'final'})];
  assert.equal(finalRecordedReply(events),'final');assert.equal(finalRecordedReply([]),'');
});

test('run links resolve command and Agent records without guessing from the run ID', async t => {
  const destinations=[{kind:'route',id:'route-1'},{kind:'agent',id:'agent-1'}];
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async (url:RequestInfo|URL)=>{calls.push(String(url));return new Response(JSON.stringify(destinations.shift()),{status:200});});
  assert.deepEqual(await resolveRunRecordDestination('command/id'),{path:'/route-records',query:{record:'route-1'}});
  assert.deepEqual(await resolveRunRecordDestination('agent-run'),{path:'/agent-records',query:{run:'agent-1'}});
  assert.equal(calls[0],'/api/ts/runs/command%2Fid/record-link');
});

test('legacy Agent links recover only confirmed command routes and preserve other failures', async t => {
  let response={kind:'route',id:'route-1'};
  const fetchMock=t.mock.method(globalThis,'fetch',async ()=>new Response(JSON.stringify(response),{status:200}));
  const missing=new RuntimeRequestError('not_found','missing',{status:404});
  assert.deepEqual(await recoverLegacyCommandDestination('command-run',missing),{path:'/route-records',query:{record:'route-1'}});
  response={kind:'agent',id:'agent-1'};
  assert.equal(await recoverLegacyCommandDestination('agent-run',missing),null);
  assert.equal(await recoverLegacyCommandDestination('agent-run',new RuntimeRequestError('server_error','failed',{status:500})),null);
  assert.equal(await recoverLegacyCommandDestination('agent-run',new Error('failed')),null);
  assert.equal(fetchMock.mock.callCount(),2);
  fetchMock.mock.mockImplementation(async()=>new Response('{}',{status:403}));
  await assert.rejects(recoverLegacyCommandDestination('command-run',missing),cause=>cause instanceof RuntimeRequestError&&cause.status===403);
});

test('route explanations describe routing decisions without claiming Agent completion or step timing', () => {
  assert.equal(routeNodeLabels.end,'结束路由判断');
  assert.equal(routeStepSummary({nodeId:'end',status:'passed',summary:'Complete',durationMs:null}),'路由判断完成');
  assert.equal(routeStepSummary({nodeId:'authorize',status:'passed',summary:'operator',durationMs:0}),'分配运行态：普通干员态');
  assert.equal(routeStepSummary({nodeId:'normalize',status:'passed',summary:'3 content parts',durationMs:0}),'已整理 3 个消息片段');
  assert.equal(routeStepSummary({nodeId:'command',status:'passed',summary:'Command: help',durationMs:0}),'识别到指令：help');
  assert.equal(routeSummaryText('Accepted'),'消息满足接入条件');
  assert.equal(routeSummaryText('Group message does not mention or reply to this bot'),'群消息未提及或回复此机器人');
  assert.equal(routeSummaryText('保留具体的异常原因'),'保留具体的异常原因');
});


test('route Agent links use only explicit Agent associations and preserve command and queue states', () => {
  const detail=RouteRecordDetailSchema.parse({record:{id:'route-command',createdAt:1,durationMs:2,configRevision:1,flowRevision:1,platform:'dashboard',platformType:'telegram',sessionType:'private',sessionId:'session',senderId:'sender',messageId:'message',inputPreview:null,outcome:'command',agentId:'assistant',runtimeState:'operator',runId:'command-run',path:[]},run:{id:'command-run',sessionKey:'session',agentId:'assistant',senderId:'sender',generation:0,status:'failed',createdAt:1,updatedAt:2,summary:'指令处理失败（已脱敏）'},relatedAgentRunIds:[]});
  assert.deepEqual(routeAgentRunIds(detail),[]);
  assert.deepEqual(routeProcessingState(detail),{label:'失败',summary:'指令处理失败（已脱敏）',note:'此消息由指令处理器接管，未启动 Agent。'});
  const queued=RouteRecordDetailSchema.parse({...detail,record:{...detail.record,outcome:'agent'},run:{...detail.run,status:'queued',summary:'等待执行'}});
  assert.deepEqual(routeAgentRunIds(queued),[]);
  assert.deepEqual(routeProcessingState(queued),{label:'排队中',summary:'等待执行',note:'任务正在排队，尚未启动 Agent。'});
  const linked={...detail,relatedAgentRunIds:['real-agent','real-agent']};
  assert.deepEqual(routeAgentRunIds(linked),['real-agent']);
  assert.equal(routeProcessingState(linked),null);
});
