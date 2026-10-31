import assert from 'node:assert/strict';
import {test} from 'node:test';
import {protocol,type Model,type ModelRequest,type ModelResponse} from '@openai/agents';
import {PriestessRuntime,defaultConfiguration} from '../apps/server/src/runtime.js';
import {MessageEventSchema,RuntimeConfigSchema,type ReplyPlan} from '../packages/contracts/src/index.js';
import type {PlatformAdapter} from '../packages/adapters/src/platforms/types.js';
class PluginModel implements Model{
 readonly requests:ModelRequest[]=[];
 getResponse():Promise<ModelResponse>{return Promise.reject(new Error('Streaming required'));}
 async *getStreamedResponse(request:ModelRequest):AsyncIterable<protocol.StreamEvent>{this.requests.push(request);await Promise.resolve();yield{type:'output_text_delta',delta:'**Hello**'};yield protocol.StreamEvent.parse({type:'response_done',response:{id:`r${this.requests.length}`,usage:{inputTokens:2,outputTokens:3,totalTokens:5},output:[{role:'assistant',type:'message',status:'completed',content:[{type:'output_text',text:'**Hello**'}]}]}});}
}
void test('runtime mounts enabled authorized plugins, decorates final IM output and captures scoped reminiscence',async()=>{
 const base=defaultConfiguration();const config=RuntimeConfigSchema.parse({...base,agents:base.agents.map(a=>({...a,resources:{...a.resources,tools:[...a.resources.tools,'web_search','bilibili_search','reminiscence_record','recall_memory_tool']}}))});const model=new PluginModel();const runtime=new PriestessRuntime({database:':memory:',config,model,secret:()=> 'test-search-key'});
 const replies:ReplyPlan[]=[];const adapter:PlatformAdapter={id:'test',capabilities:{edit:true,images:true,files:true,groups:true,audio:false},start:()=>Promise.resolve(),stop:()=>Promise.resolve(),send:(_target,reply)=>{replies.push(reply);return Promise.resolve({status:'confirmed',messageIds:['reply']});},edit:()=>{throw new Error('Decorator must buffer final output');},downloadMedia:()=>Promise.reject(new Error('Unused'))};
 try{
  runtime.search.update({enabled:true,provider:'deepseek',apiBase:'https://api.deepseek.com',apiKeyEnv:'KEY',timeoutMs:1000,defaultCount:1,maxCount:1,maxContentChars:1000},0);
  runtime.plugins.settings.update('markdown_killer',{enabled:true,globalCleanup:true,tableRender:false,formulaRender:false},0);
  runtime.plugins.settings.update('local_reminiscence',{enabled:true,realtimeRecording:true},0);
  const message=MessageEventSchema.parse({platform:'test',platformType:'telegram',sessionId:'private',sessionType:'private',senderId:'alice',messageId:'input',timestamp:Date.now(),botId:'bot',parts:[{type:'text',text:'hello'}]});
  const run=runtime.submit(message,adapter);await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'completed');assert.deepEqual(replies,[{parts:[{type:'text',text:'Hello'}]}]);
  const tools=JSON.stringify(model.requests[0]?.tools);assert.match(tools,/web_search/);assert.match(tools,/recall_memory_tool/);assert.doesNotMatch(tools,/bilibili_search/);
  const overview=runtime.plugins.reminiscence.overview();assert.equal(overview.scopes.length,1);assert.equal(overview.scopes[0]?.senderId,'alice');assert.equal(overview.scopes[0]?.sessionId,'private');
 }finally{await runtime.stop();}
});
void test('upload template may satisfy attention but never bypasses route allowlist or changes sender',async()=>{
 const base=defaultConfiguration();const config=RuntimeConfigSchema.parse({...base,flow:{...base.flow,acceptance:{...base.flow.acceptance,groupPolicy:'mention_or_reply',allowlist:{enabled:true,entries:[{platform:'qq',sessionType:'group',sessionId:'allowed'}]}}}});const model=new PluginModel();const runtime=new PriestessRuntime({database:':memory:',config,model});
 try{runtime.plugins.settings.update('qq_file',{enabled:true,upload_auto_process:true,uploadTemplates:[{id:'logs',filePatterns:['*.log'],prompt:'Read uploaded log'}]},0);
 const message=MessageEventSchema.parse({platform:'qq',platformType:'napcat',sessionId:'allowed',sessionType:'group',senderId:'real-uploader',messageId:'upload',timestamp:Date.now(),botId:'bot',parts:[{type:'file',url:'napcat-group-file:untrusted-id',name:'test.log',mimeType:'text/plain',extractedText:'log source'}]});
 const refused=runtime.submit(MessageEventSchema.parse({...message,sessionId:'blocked',messageId:'blocked'}));await runtime.idle();assert.match(runtime.detail(refused.id).run.summary,/allowlist/);assert.equal(model.requests.length,0);
 const run=runtime.submit(message);await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'completed');assert.equal(runtime.detail(run.id).run.senderId,'real-uploader');assert.match(JSON.stringify(model.requests[0]?.input),/Read uploaded log/);
 }finally{await runtime.stop();}
});
