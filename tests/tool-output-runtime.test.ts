import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {protocol,type Model,type ModelRequest,type ModelResponse} from '@openai/agents';
import {PriestessRuntime,defaultConfiguration} from '../apps/server/src/runtime.js';
import {RuntimeConfigSchema,MessageEventSchema} from '../packages/contracts/src/index.js';
import {ExtensionManifestSchema} from '../packages/contracts/src/extensions.js';
function completion(output:unknown[]):protocol.StreamEvent{return protocol.StreamEvent.parse({type:'response_done',response:{id:crypto.randomUUID(),usage:{inputTokens:2,outputTokens:3,totalTokens:5},output}});}
function call(name:string,args:unknown):protocol.StreamEvent{return completion([{type:'function_call',name,arguments:JSON.stringify(args),callId:crypto.randomUUID(),status:'completed'}]);}
void test('native overflow passes through production wrapper and can be read and searched without files.read',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tool-output-runtime-'));const manifest=ExtensionManifestSchema.parse({id:'large_test',name:'Large output test',version:'1',description:'',tools:[{name:'large_native',description:'Long text',capabilities:['chat'],parameters:{}}],commands:[]});const file=join(directory,'test.mjs');await writeFile(file,`export default {manifest:${JSON.stringify(manifest)},execute:async()=> '甲'.repeat(60000)+'TAIL_TEST_MARKER'};`);
 const base=defaultConfiguration();const config=RuntimeConfigSchema.parse({...base,agents:base.agents.map(a=>({...a,capabilities:['chat'],resources:{tools:['large_native','read_tool_result','search_tool_result']}}))});const requests:ModelRequest[]=[];let resultId='';
 const model:Model={getResponse:():Promise<ModelResponse>=>Promise.reject(new Error('Streaming expected')),async *getStreamedResponse(request):AsyncIterable<protocol.StreamEvent>{const index=requests.length;requests.push(request);await Promise.resolve();
  if(index===0)yield call('large_native',{});
  else if(index===1){const text=JSON.stringify(request.input);assert.match(text,/fullResultAvailable=true/);assert.ok(text.length<30000);const match=/resultId=([a-f0-9-]{36})/.exec(text);resultId=match?.[1]??'';assert.ok(resultId);yield call('read_tool_result',{id:resultId,offset:59995,limit:100,max_tokens:128});}
  else if(index===2){assert.match(JSON.stringify(request.input),/TAIL_TEST_MARKER/);yield call('search_tool_result',{id:resultId,query:'TAIL_TEST_MARKER',offset:0,limit:3,max_tokens:128});}
  else{assert.match(JSON.stringify(request.input),/nextOffset/);yield completion([{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Overflow read verified'}]}]);}
 }};
 const runtime=new PriestessRuntime({database:':memory:',config,model});runtime.setArtifactDirectory(join(directory,'artifacts'));
 try{const installed=await runtime.extensions.install({manifest,modulePath:file,trustedHostAcknowledged:true});await runtime.extensions.toggle(manifest.id,true,installed.revision);
 const run=runtime.submit(MessageEventSchema.parse({platform:'test',platformType:'telegram',sessionId:'private',sessionType:'private',senderId:'alice',messageId:'m',timestamp:Date.now(),botId:'bot',parts:[{type:'text',text:'read tail'}]}));await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'completed');assert.equal(requests.length,4);assert.equal((await readdir(join(directory,'tool-results'))).length,1,'reader results must not recursively spill');assert.equal(runtime.detail(run.id).events.filter(e=>e.type==='usage').length,4);
 }finally{await runtime.stop();await rm(directory,{recursive:true,force:true});}
});
