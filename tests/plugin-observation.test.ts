import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tool,RunContext as SdkContext} from '@openai/agents';
import {z} from 'zod';
import {AgentDefinitionSchema,MessageEventSchema,RunIdSchema,type EngineInput,type RunEvent} from '../packages/contracts/src/index.js';
import {RuntimeStore,AuthorizationService,historyKey} from '../packages/core/src/index.js';
import {observedTools} from '../packages/adapters/src/plugins/observed-tools.js';
import type {SdkLocalContext} from '../packages/adapters/src/agents/engine.js';
void test('plugin tool traces retain SDK call identity, omit private data, reject wrong runs and prevent replay',async()=>{
 const store=new RuntimeStore(':memory:');try{
 const agent=AgentDefinitionSchema.parse({id:'test',displayName:'test'});const message=MessageEventSchema.parse({platform:'test',platformType:'telegram',sessionId:'s',sessionType:'private',senderId:'u',messageId:'m',timestamp:1,botId:'b',parts:[]});const auth=new AuthorizationService([]);const context={runId:RunIdSchema.parse('run'),turnId:'turn',principal:message,agentId:agent.id,generation:0,configRevision:1,flowRevision:1,...auth.resolve(message,agent),budget:agent.budget,signal:AbortSignal.timeout(10000),depth:0};const input:EngineInput={agent,message,context,additionalContext:'',session:{id:historyKey(context),engine:'agents_sdk',version:'0.21.0'}};
 const params=z.object({value:z.string()});let calls=0;const events:RunEvent[]=[];const [wrapped]=observedTools(input,[tool<typeof params,SdkLocalContext>({name:'native_test',description:'test',parameters:params,execute:p=>{calls++;return p.value;}})],store,event=>events.push(event));assert.ok(wrapped&&wrapped.type==='function');
 const details={toolCall:{type:'function_call' as const,name:'native_test',callId:'sdk-call',arguments:'{"value":"private"}',status:'completed' as const}};
 await assert.rejects(wrapped.invoke(new SdkContext({runId:'other'}),details.toolCall.arguments,details),/identity/);assert.equal(calls,0);
 assert.equal(await wrapped.invoke(new SdkContext({runId:'run'}),details.toolCall.arguments,details),'private');assert.equal(calls,1);
 assert.deepEqual(events.map(e=>e.type==='tool'?[e.status,e.callId]:[]),[['started','sdk-call'],['completed','sdk-call']]);assert.doesNotMatch(JSON.stringify(events),/private/);
 await assert.rejects(wrapped.invoke(new SdkContext({runId:'run'}),details.toolCall.arguments,details),/Duplicate/);assert.equal(calls,1);
 }finally{store.close();}
});
