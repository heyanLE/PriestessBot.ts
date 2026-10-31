import assert from 'node:assert/strict';
import test from 'node:test';
import { protocol, tool, type Model, type ModelRequest, type ModelResponse, type Tool } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, MessageEventSchema, RunEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunEvent } from '../packages/contracts/src/index.js';
import { AgentsSdkEngine, type SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { safeAuditPreview, safeAuditError } from '../packages/adapters/src/agents/audit.js';
import { AuthorizationService, RuntimeStore, historyKey } from '../packages/core/src/index.js';

class ScriptedModel implements Model {
  readonly requests:ModelRequest[]=[];
  constructor(private readonly script:(request:ModelRequest,index:number)=>Promise<protocol.StreamEvent[]>){ }
  getResponse():Promise<ModelResponse>{return Promise.reject(new Error('Expected streamed model'));}
  async *getStreamedResponse(request:ModelRequest):AsyncIterable<protocol.StreamEvent>{this.requests.push(request);for(const event of await this.script(request,this.requests.length-1))yield event;}
}
function done(output:unknown[],responseId='response'):protocol.StreamEvent{return protocol.StreamEvent.parse({type:'response_done',response:{id:responseId,usage:{inputTokens:7,outputTokens:5,totalTokens:12},output}});}
function answer(text:string):protocol.StreamEvent{return done([{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]);}
function fixture(model:Model, tools:(input:EngineInput,emit:(event:RunEvent)=>void)=>Tool<SdkLocalContext>[]=()=>[]){
  const store=new RuntimeStore(':memory:');const agent=AgentDefinitionSchema.parse({id:'agent',displayName:'Agent',model:'fixture-model',budget:{tokenLimitMode:'context'},instructions:'Audit-only configured secret hidden-key-123.'});
  const config=RuntimeConfigSchema.parse({runtime:'priestess-ts',schemaVersion:1,agents:[agent],connections:[{id:'default',apiKeyEnv:'TEST_KEY'}],flow:{routing:{defaultAgentId:'agent',rules:[]}}});
  const auth=new AuthorizationService([],store);const controller=new AbortController();
  const message=MessageEventSchema.parse({platform:'dashboard',platformType:'telegram',sessionId:'audit-session',sessionType:'private',senderId:'owner',botId:'bot',messageId:'m',timestamp:Date.now(),parts:[{type:'text',text:'Check this task'}]});
  const principal={platform:message.platform,sessionType:message.sessionType,sessionId:message.sessionId,senderId:message.senderId};
  const context={runId:RunIdSchema.parse('audit-run'),turnId:'turn',principal,agentId:agent.id,generation:0,configRevision:0,flowRevision:0,...auth.resolve(principal,agent),signal:controller.signal,budget:agent.budget,depth:0};
  const input:EngineInput={agent,message,context,session:{engine:'agents_sdk',version:'0.21.0',id:historyKey(context)},additionalContext:''};
  const engine=new AgentsSdkEngine({store,config:()=>config,secret:()=> 'hidden-key-123',auditSecrets:()=>['plugin-operator-secret'],assertCurrent:current=>auth.assert(current.context,'chat',current.agent),tools:(current,emit)=>Promise.resolve(tools(current,emit)),model,dynamicContext:()=>Promise.resolve({scope:input.session.id,components:[{name:'current-reference',value:'final assembled reference'}]})});
  return {store,engine,input,controller};
}

await test('audit previews redact credentials, binary data, private reasoning and URL query values before truncation',()=>{
  const source={apiKey:'not-a-recognizable-format',nested:{openaiApiKey:'another-value',accessToken:'access-value'},inputTokens:12,url:'https://user:pass@example.com/file?signature=secret-query',image:'data:image/png;base64,YWJjZGVm',reasoning_content:'never capture inner reasoning',message:'Bearer eyJ.test.token and hidden-key-123'};
  const preview=safeAuditPreview(source,{knownSecrets:['hidden-key-123'],maxChars:8000});
  assert.equal(preview.originalChars,JSON.stringify(source).length);assert.equal(preview.redacted,true);
  assert.doesNotMatch(preview.text,/not-a-recognizable|another-value|access-value|secret-query|user:pass|YWJjZGVm|inner reasoning|eyJ\.test|hidden-key/);
  assert.match(preview.text,/inputTokens/);assert.match(preview.text,/12/);
  const bounded=safeAuditPreview('A'.repeat(20_000),{maxChars:100});assert.equal(bounded.text.length,100);assert.equal(bounded.originalChars,20_000);assert.equal(bounded.truncated,true);
  assert.ok(safeAuditPreview('A'.repeat(1_000_001)).text.length<100);
  assert.doesNotMatch(safeAuditError(new Error('provider body token=private')),/provider body|private/);
});

await test('large model input remains valid structured JSON with fair field budgets and the latest history entries',()=>{
  const source={systemInstructions:'SYSTEM '.repeat(20_000),input:Array.from({length:250},(_item,index)=>({role:index%2?'assistant':'user',content:`MESSAGE_${index} ${'content '.repeat(100)}`})),tools:[{type:'function',name:'lookup'},{type:'function',name:'download'}],settings:{maxTokens:2048,temperature:0.7}};
  const preview=safeAuditPreview(source,{maxChars:8000,recentArrayKeys:['input']});
  const schema=z.object({systemInstructions:z.string(),input:z.array(z.union([z.string(),z.object({role:z.string(),content:z.string()})])),tools:z.array(z.object({type:z.string(),name:z.string()})),settings:z.object({maxTokens:z.number(),temperature:z.number()})});
  const parsed=schema.parse(JSON.parse(preview.text));assert.ok(preview.text.length<=8000);assert.equal(preview.originalChars,JSON.stringify(source).length);assert.equal(preview.truncated,true);
  assert.match(parsed.systemInstructions,/SYSTEM.*省略/);assert.deepEqual(parsed.tools,source.tools);assert.deepEqual(parsed.settings,source.settings);
  const messages=parsed.input.filter((entry):entry is {role:string;content:string}=>typeof entry!=='string');assert.ok(messages.length>1);assert.match(messages.at(-1)?.content??'',/^MESSAGE_249 /);
  const omission=parsed.input[0];assert.equal(typeof omission,'string');assert.match(typeof omission==='string'?omission:'',new RegExp(`已省略前 ${250-messages.length} 项`));
  const indices=messages.map(entry=>Number(/^MESSAGE_(\d+)/u.exec(entry.content)?.[1]));assert.deepEqual(indices,[...indices].sort((a,b)=>a-b));assert.equal(preview.redacted,false);
});

await test('large output keeps message roles, tool-call fields and escaped strings in valid bounded JSON',()=>{
  const output=[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'ANSWER "\\\n😀 '.repeat(2000)}]},{type:'function_call',name:'lookup',callId:'call-2',status:'completed',arguments:JSON.stringify({query:'SEARCH '.repeat(2000),apiKey:'private-value'})}];
  const preview=safeAuditPreview(output,{maxChars:4000});
  const parsed=z.array(z.object({type:z.string(),role:z.string().optional(),name:z.string().optional(),callId:z.string().optional(),content:z.array(z.object({type:z.string(),text:z.string()})).optional(),arguments:z.string().optional()})).parse(JSON.parse(preview.text));
  assert.ok(preview.text.length<=4000);assert.equal(preview.truncated,true);assert.equal(preview.redacted,true);assert.doesNotMatch(preview.text,/private-value/);
  assert.equal(parsed[0]?.role,'assistant');assert.equal(parsed[0]?.content?.[0]?.type,'output_text');assert.match(parsed[0]?.content?.[0]?.text??'',/省略/);assert.equal(parsed[1]?.name,'lookup');assert.equal(parsed[1]?.callId,'call-2');
  for(const maxChars of [32,64,128,256,1000]){const bounded=safeAuditPreview(output,{maxChars});assert.ok(bounded.text.length<=maxChars);assert.doesNotThrow(()=>JSON.parse(bounded.text));}
});

await test('generic JSON arrays retain ordered head and tail excerpts and explicit omitted counts',()=>{
  const source=Array.from({length:400},(_entry,index)=>({name:`entry-${index}`,text:'x'.repeat(1000)}));const preview=safeAuditPreview(JSON.stringify(source),{maxChars:3000});
  const parsed=z.array(z.union([z.string(),z.object({name:z.string(),text:z.string()})])).parse(JSON.parse(preview.text));
  const entries=parsed.filter((entry):entry is {name:string;text:string}=>typeof entry!=='string');assert.equal(entries[0]?.name,'entry-0');assert.equal(entries.at(-1)?.name,'entry-399');assert.equal(preview.originalChars,JSON.stringify(source).length);
  assert.ok(parsed.some(entry=>typeof entry==='string'&&entry.includes(`已省略中间 ${400-entries.length} 项`)));assert.equal(preview.truncated,true);
});

await test('structured preview redacts URL credentials, metadata and secrets before escaped-string truncation',()=>{
  const source={systemInstructions:'prefix '.repeat(10000)+'hidden-key-123',input:[{role:'user',content:[{type:'input_image',image:'data:image/png;base64,YWJjZGVm'},{type:'input_text',text:'https://user:pass@example.com/a?token=private-query&name=other-value'}]}],tools:[{name:'lookup',authorization:'Bearer private-bearer'}],settings:{apiKey:'private-key'},reasoning_content:'private-thoughts'};
  const preview=safeAuditPreview(source,{maxChars:2000,knownSecrets:['hidden-key-123'],recentArrayKeys:['input']});
  assert.doesNotThrow(()=>JSON.parse(preview.text));assert.ok(preview.text.length<=2000);assert.equal(preview.redacted,true);assert.equal(preview.truncated,true);assert.doesNotMatch(preview.text,/hidden-key|YWJjZGVm|private-query|other-value|user:pass|private-bearer|private-key|private-thoughts/);
  const oversize=safeAuditPreview({input:'x'.repeat(1_000_001)},{maxChars:8000});assert.ok(oversize.text.length<100);assert.equal(oversize.originalChars,JSON.stringify({input:'x'.repeat(1_000_001)}).length);assert.equal(oversize.truncated,true);
});

await test('model records show the actual augmented request, paired call identity and reported usage without duplicate usage accounting',async()=>{
  const model=new ScriptedModel(()=>Promise.resolve([{type:'output_text_delta',delta:'visible '},{type:'output_text_delta',delta:'reply'},answer('visible reply')]));
  const f=fixture(model);const events:RunEvent[]=[];
  try{
    const result=await f.engine.run(f.input,event=>events.push(RunEventSchema.parse(event)));
    assert.equal(result.text,'visible reply');const calls=events.filter(event=>event.type==='model_call');assert.equal(calls.length,2);
    const start=calls.find(event=>event.status==='started');const end=calls.find(event=>event.status==='completed');assert.ok(start);assert.ok(end);
    assert.equal(start.callId,end.callId);assert.equal(start.modelCall,1);assert.equal(end.inputTokens,7);assert.equal(end.outputTokens,5);assert.ok((end.durationMs??-1)>=0);assert.ok((end.firstTokenMs??-1)>=0);
    assert.match(start.inputPreview?.text??'',/final assembled reference/);assert.doesNotMatch(start.inputPreview?.text??'',/hidden-key-123/);
    assert.equal(events.filter(event=>event.type==='usage').length,1);assert.equal(result.inputTokens,7);assert.equal(result.outputTokens,5);
    assert.equal(events.filter(event=>event.type==='started').length,1);
    assert.deepEqual(events.map(event=>event.sequence),events.map((_event,index)=>index));
  }finally{f.store.close();}
});

await test('tool audit wraps existing authorization and legacy events once and records final model-facing output',async()=>{
  const model=new ScriptedModel((_request,index)=>Promise.resolve([index===0?done([{type:'function_call',name:'lookup',arguments:'{"query":"tea","api_key":"secret-arg"}',callId:'lookup-call',status:'completed'}]):answer('done')]));
  const parameters=z.object({query:z.string(),api_key:z.string()});let calls=0;
  const f=fixture(model,(input,emit)=>[tool<typeof parameters,SdkLocalContext>({name:'lookup',description:'lookup',parameters,execute:args=>{calls++;for(const status of ['started','completed'])emit(RunEventSchema.parse({type:'tool',runId:input.context.runId,turnId:input.context.turnId,sequence:0,timestamp:Date.now(),name:'lookup',callId:'lookup-call',status,summary:'legacy'}));return JSON.stringify({query:args.query,token:'secret-result',result:'model-facing excerpt plugin-operator-secret'});}})]);const events:RunEvent[]=[];
  try{await f.engine.run(f.input,event=>events.push(RunEventSchema.parse(event)));assert.equal(calls,1);const tools=events.filter(event=>event.type==='tool');assert.equal(tools.length,2);assert.deepEqual(tools.map(event=>event.status),['started','completed']);assert.equal(tools[0]?.modelCall,1);assert.match(tools[1]?.outputPreview?.text??'',/model-facing excerpt/);assert.doesNotMatch(JSON.stringify(tools),/secret-arg|secret-result|plugin-operator-secret/);assert.ok((tools[1]?.durationMs??-1)>=0);}finally{f.store.close();}
});

await test('tool setup failure closes the started Agent without inventing a model call or exposing the original error',async()=>{
  const model=new ScriptedModel(()=>Promise.resolve([answer('unused')]));const f=fixture(model,()=>{throw new Error('provider body password=raw-secret');});const events:RunEvent[]=[];
  try{await assert.rejects(f.engine.run(f.input,event=>events.push(RunEventSchema.parse(event))),/raw-secret/);assert.deepEqual(events.map(event=>event.type),['started','failed']);assert.equal(model.requests.length,0);assert.doesNotMatch(JSON.stringify(events),/provider body|raw-secret/);}finally{f.store.close();}
});

await test('approval pauses before invocation and resumed tool keeps its preceding model call number',async()=>{
  const model=new ScriptedModel((_request,index)=>Promise.resolve([index===0?done([{type:'function_call',name:'approved',arguments:'{}',callId:'approved-call',status:'completed'}]):answer('approved done')]));
  const parameters=z.object({});let calls=0;const f=fixture(model,()=>[tool<typeof parameters,SdkLocalContext>({name:'approved',description:'approval',parameters,needsApproval:true,execute:()=>{calls++;return 'ok';}})]);const events:RunEvent[]=[];
  try{const paused=await f.engine.run(f.input,event=>events.push(event));assert.equal(calls,0);assert.equal(events.filter(event=>event.type==='tool').length,0);assert.ok(paused.state);const result=await f.engine.resume(f.input,paused.state,true,event=>events.push(event));assert.equal(result.status,'completed');assert.equal(calls,1);const tools=events.filter(event=>event.type==='tool');assert.equal(tools.length,2);assert.equal(tools[0]?.modelCall,1);const starts=events.filter((event):event is Extract<RunEvent,{type:'model_call'}>=>event.type==='model_call'&&event.status==='started');assert.deepEqual(starts.map(event=>event.modelCall),[1,2]);}finally{f.store.close();}
});

await test('model cancellation stores bounded assembled output, never incomplete credential fragments or provider error bodies',async()=>{
  let enter=()=>{};const ready=new Promise<void>(resolve=>{enter=resolve;});
  class CancelledModel implements Model{
    getResponse():Promise<ModelResponse>{throw new Error('stream only');}
    async *getStreamedResponse(request:ModelRequest):AsyncIterable<protocol.StreamEvent>{yield {type:'output_text_delta',delta:'hidden-'};yield {type:'output_text_delta',delta:'key-123'};enter();await new Promise<void>((_resolve,reject)=>{request.signal?.addEventListener('abort',()=>reject(new Error('raw provider body password=private')),{once:true});});}
  }
  const f=fixture(new CancelledModel());const events:RunEvent[]=[];
  try{const pending=f.engine.run(f.input,event=>events.push(event));await ready;f.controller.abort();assert.equal((await pending).status,'cancelled');const end=events.find(event=>event.type==='model_call'&&event.status==='cancelled');assert.ok(end&&end.type==='model_call');assert.doesNotMatch(JSON.stringify(end),/hidden-|key-123|raw provider|private/);assert.equal(end.inputTokens,undefined);assert.ok((end.durationMs??-1)>=0);}finally{f.store.close();}
});
