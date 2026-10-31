import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest } from '@openai/agents';
import { PriestessRuntime, defaultConfiguration } from '../apps/server/src/runtime.js';
import { AgentDefinitionSchema, RuntimeConfigSchema, RunIdSchema, type EngineInput, MessageEventSchema } from '../packages/contracts/src/index.js';
import { AgentsSdkEngine } from '../packages/adapters/src/agents/engine.js';
import { RuntimeStore, AuthorizationService, historyKey } from '../packages/core/src/index.js';
import { UsageAnchorSchema } from '../packages/adapters/src/agents/token-count.js';
function message(text:string, senderId='alice'){return MessageEventSchema.parse({platform:'test',platformType:'telegram',sessionId:'same-room',sessionType:'private',senderId,senderName:senderId,messageId:crypto.randomUUID(),timestamp:Date.now(),parts:[{type:'text',text}],botId:'test'});}
void test('follow-up enters next model call between tools; mutable context replaces without entering history',async()=>{
  const requests:ModelRequest[]=[];
  const model:Model={getResponse:()=>Promise.reject(new Error('Unexpected summary')),async *getStreamedResponse(request):AsyncIterable<protocol.StreamEvent>{
    const index=requests.length;requests.push(request);await Promise.resolve();
    if(index===0){assert.ok(runtime);runtime.submit(message('补充标记：请在本轮确认 GREEN_STATE。'));}
    if(index===1){assert.ok(runtime);for(const memory of runtime.memory.list())runtime.store.delete('memories',memory.id);}
    const output=index===0?[{type:'function_call',name:'memory_save',arguments:JSON.stringify({libraryId:'default',text:'GREEN_STATE'}),callId:'save',status:'completed'}]:index===1?[{type:'function_call',name:'memory_recall',arguments:JSON.stringify({query:'GREEN_STATE'}),callId:'recall',status:'completed'}]:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'ok'}]}];
    yield protocol.StreamEvent.parse({type:'response_done',response:{id:`r${index}`,usage:{inputTokens:100+index,outputTokens:5,totalTokens:105+index},output}});
  }};
  const runtime:PriestessRuntime=new PriestessRuntime({database:':memory:',config:defaultConfiguration(),model});
  try{
    const run=runtime.submit(message('处理 GREEN_STATE'));await runtime.idle();
    assert.equal(runtime.detail(run.id).run.status,'completed');assert.equal(requests.length,3,'Follow-up must be consumed before SDK run finishes');
    assert.match(JSON.stringify(requests[1]?.input),/补充标记/);
    const snapshots=requests.map(request=>{
      assert.ok(Array.isArray(request.input));
      const snapshotIndex=request.input.findIndex(item=>'role' in item&&item.role==='user'&&Array.isArray(item.content)&&item.content.some(part=>part.type==='input_text'&&part.text.startsWith('<dynamic_context hash=')));
      const metadataIndex=request.input.findIndex(item=>'role' in item&&item.role==='user'&&Array.isArray(item.content)&&item.content.some(part=>part.type==='input_text'&&part.text.startsWith('<context_unit name="request_metadata">')));
      const currentIndex=request.input.findIndex(item=>'role' in item&&item.role==='user'&&Array.isArray(item.content)&&item.content.some(part=>part.type==='input_text'&&part.text==='处理 GREEN_STATE'));
      assert.ok(metadataIndex>=0);assert.ok(snapshotIndex>metadataIndex,'Dynamic snapshot follows persisted request metadata');
      assert.equal(snapshotIndex+1,currentIndex,'Dynamic snapshot immediately precedes the active user request');
      return JSON.stringify(request.input[snapshotIndex]);
    });
    assert.doesNotMatch(snapshots[0]??'',/GREEN_STATE/);assert.match(snapshots[1]??'',/GREEN_STATE/);assert.doesNotMatch(snapshots[2]??'',/GREEN_STATE/);
    const histories=runtime.store.list('sdk-history',protocol.ModelItem.array()).flat();
    assert.doesNotMatch(JSON.stringify(histories),/<dynamic_context/);assert.equal(histories.filter(item=>JSON.stringify(item).includes('补充标记')).length,1,'Steered input persists exactly once');
    runtime.submit(message('继续同一个会话'));await runtime.idle();assert.match(JSON.stringify(requests[3]?.input),/补充标记/);
    runtime.submit(message('Other sender','bob'));await runtime.idle();assert.doesNotMatch(JSON.stringify(requests[4]?.input),/补充标记/);
    assert.equal(runtime.store.list('sdk-context-usage',UsageAnchorSchema).length,2);
  }finally{await runtime.stop();}
});

void test('final escaped dynamic snapshot is window-checked after reservation and before provider dispatch',async()=>{
  const store=new RuntimeStore(':memory:');const agent=AgentDefinitionSchema.parse({id:'a',displayName:'a',capabilities:['chat'],contextPolicy:{contextWindowTokens:2048,compactAtTokens:1500,targetTokens:512,summaryMaxTokens:128}});
  const config=RuntimeConfigSchema.parse({runtime:'priestess-ts',schemaVersion:1,agents:[agent],flow:{routing:{defaultAgentId:'a',rules:[]}}});const auth=new AuthorizationService([],store);const event=message('hello');const principal={platform:event.platform,sessionId:event.sessionId,sessionType:event.sessionType,senderId:event.senderId};
  const context={runId:RunIdSchema.parse('window-race'),turnId:'turn',principal,agentId:agent.id,generation:0,configRevision:0,flowRevision:0,...auth.resolve(principal,agent),budget:agent.budget,signal:AbortSignal.timeout(10000),depth:0};const input:EngineInput={agent,context,message:event,additionalContext:'',session:{engine:'agents_sdk',version:'0.21.0',id:historyKey(context)}};
  let calls=0,snapshots=0;const model:Model={getResponse:()=>{calls++;return Promise.reject(new Error('Provider must not be called'));},getStreamedResponse:()=>{calls++;throw new Error('Provider must not be called');}};
  const engine=new AgentsSdkEngine({store,config:()=>config,secret:()=>undefined,assertCurrent:candidate=>auth.assert(candidate.context,'chat',candidate.agent),tools:()=>Promise.resolve([]),model,dynamicContext:()=>Promise.resolve({scope:input.session.id,components:[{name:'knowledge',value:++snapshots===1?'small':'<'.repeat(10000)}]})});
  try{await assert.rejects(engine.run(input,()=>{}),/Context window exceeded after dynamic context refresh/);assert.equal(calls,0);assert.equal(snapshots,2);}finally{store.close();}
});
