import assert from 'node:assert/strict';
import {test} from 'node:test';
import {protocol,type Model,type ModelRequest,type ModelResponse} from '@openai/agents';
import {z} from 'zod';
import {PriestessRuntime,defaultConfiguration} from '../apps/server/src/runtime.js';
import {MessageEventSchema,RuntimeConfigSchema,MemoryRecordSchema,type MessageEvent,type ReplyPlan} from '../packages/contracts/src/index.js';
import {conversationKey} from '../packages/core/src/authorization.js';
import type {PlatformAdapter} from '../packages/adapters/src/platforms/types.js';
class ScriptModel implements Model{
 readonly requests:ModelRequest[]=[];
 constructor(private readonly script:(request:ModelRequest,index:number)=>Promise<protocol.StreamEvent[]>){ }
 getResponse():Promise<ModelResponse>{return Promise.reject(new Error('Streaming only'));}
 async *getStreamedResponse(request:ModelRequest):AsyncIterable<protocol.StreamEvent>{const index=this.requests.length;this.requests.push(request);for(const event of await this.script(request,index))yield event;}
}
function done(text:string){return protocol.StreamEvent.parse({type:'response_done',response:{id:crypto.randomUUID(),usage:{inputTokens:20,outputTokens:10,totalTokens:30},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}]}});}
function call(name:string,args:unknown){return protocol.StreamEvent.parse({type:'response_done',response:{id:crypto.randomUUID(),usage:{inputTokens:20,outputTokens:10,totalTokens:30},output:[{type:'function_call',name,arguments:JSON.stringify(args),callId:crypto.randomUUID(),status:'completed'}]}});}
function message(sender:string,text:string,group='group-a',sessionType:'group'|'private'='group'):MessageEvent{return MessageEventSchema.parse({platform:'test',platformType:'napcat',sessionId:group,sessionType,senderId:sender,senderName:sender,messageId:crypto.randomUUID(),timestamp:Date.now(),botId:'bot',parts:[{type:'text',text},...(sessionType==='group'?[{type:'mention',userId:'bot'}]:[])]});}
function adapter(replies:ReplyPlan[]=[],fail=false):PlatformAdapter{return{id:'test',capabilities:{edit:false,images:true,files:true,groups:true,audio:false},start:()=>Promise.resolve(),stop:()=>Promise.resolve(),send:(_target,reply)=>{replies.push(reply);return Promise.resolve(fail?{status:'uncertain',reason:'transport interrupted',messageIds:[]}:{status:'confirmed',messageIds:['sent']});},edit:()=>Promise.reject(new Error('Unused')),downloadMedia:()=>Promise.resolve({bytes:Buffer.from([255,216,255,224]),mimeType:'image/jpeg',name:'image.jpg'})};}
void test('shared group model sees other senders public dialogue but not private memory, tool traces, private chats or other groups',async()=>{
 const model=new ScriptModel((_r,index)=>Promise.resolve([index===0?call('memory_recall',{query:'secret'}):done(index===1?'PUBLIC_ALICE_REPLY':`PUBLIC_REPLY_${index}`)]));const runtime=new PriestessRuntime({database:':memory:',model});
 try{runtime.store.put('memories','secret',MemoryRecordSchema.parse({id:'secret',libraryId:'default',agentId:'assistant',principal:{platform:'test',sessionType:'group',sessionId:'group-a',senderId:'alice'},scope:'sender',text:'PRIVATE_TOOL_AND_MEMORY_SECRET',source:'fixture',confidence:1,createdAt:1,updatedAt:1}));
 const a=runtime.submit(message('alice','ALICE_PUBLIC_QUESTION'),adapter());await runtime.idle();assert.equal(runtime.detail(a.id).run.status,'completed');assert.match(JSON.stringify(model.requests[1]?.input),/PRIVATE_TOOL_AND_MEMORY_SECRET/);
 const b=runtime.submit(message('bob','BOB_FOLLOW_UP'),adapter());await runtime.idle();assert.equal(runtime.detail(b.id).run.status,'completed');const shared=JSON.stringify(model.requests[2]?.input);assert.match(shared,/ALICE_PUBLIC_QUESTION/);assert.match(shared,/PUBLIC_ALICE_REPLY/);assert.match(shared,/sender_id.*alice/);assert.match(shared,/bob/);assert.doesNotMatch(shared,/PRIVATE_TOOL_AND_MEMORY_SECRET|function_call_result|function_call/);
 runtime.submit(message('alice','PRIVATE_CHAT','group-a','private'));await runtime.idle();assert.doesNotMatch(JSON.stringify(model.requests[3]?.input),/ALICE_PUBLIC_QUESTION|BOB_FOLLOW_UP/);
 runtime.submit(message('bob','OTHER_GROUP','group-b'),adapter());await runtime.idle();assert.doesNotMatch(JSON.stringify(model.requests[4]?.input),/ALICE_PUBLIC_QUESTION|BOB_FOLLOW_UP|PRIVATE_CHAT/);
 const stored=runtime.store.db.prepare("SELECT id FROM documents WHERE namespace='sdk-history' AND id LIKE '%group-working-session-v1%'").all();assert.equal(stored.length,0,'working tool histories must not survive completed runs');
 }finally{await runtime.stop();}
});
void test('queued senders are serialized and not prematurely inserted as group chatter; reset clears shared generation',async()=>{
 let release=()=>{};const gate=new Promise<void>(r=>{release=r;});let entered=()=>{};const begun=new Promise<void>(r=>{entered=r;});
 const model=new ScriptModel(async(_r,index)=>{if(index===0){entered();await gate;}return[done(`ANSWER_${index}`)];});const runtime=new PriestessRuntime({database:':memory:',model});
 try{const alice=message('alice','FIRST');runtime.submit(alice,adapter());await begun;runtime.submit(message('bob','QUEUED_BOB'),adapter());release();await runtime.idle();assert.equal(model.requests.length,2);assert.doesNotMatch(JSON.stringify(model.requests[0]?.input),/QUEUED_BOB/);const next=JSON.stringify(model.requests[1]?.input);assert.match(next,/FIRST/);assert.match(next,/ANSWER_0/);assert.equal(next.split('QUEUED_BOB').length-1,1);
 runtime.store.reset(conversationKey(alice,'assistant'));runtime.submit(message('carol','NEW_GENERATION'),adapter());await runtime.idle();assert.doesNotMatch(JSON.stringify(model.requests[2]?.input),/QUEUED_BOB|ANSWER_0|FIRST/);
 }finally{release();await runtime.stop();}
});
void test('quoted images reach actual model with source attribution; media failure updates context and uncertain deliveries do not share answers',async()=>{
 const model=new ScriptModel(()=>Promise.resolve([done('IMAGE_ANSWER')]));const runtime=new PriestessRuntime({database:':memory:',model});
 try{const q=message('bob','看引用图片');q.parts.unshift({type:'quote',messageId:'original',senderId:'alice',senderName:'Alice',availability:'available',attachments:[{type:'image',url:'napcat-image:fixture',mimeType:'image/jpeg'}]});
 const run=runtime.submit(q,adapter([],true));await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'failed');const input=JSON.stringify(model.requests[0]?.input);assert.match(input,/input_image/);assert.match(input,/实际视觉输入/);assert.doesNotMatch(input,/retrieval still requires authorization/);assert.match(input,/data:image\/jpeg;base64/);assert.match(input,/alice/);
 runtime.submit(message('carol','SECOND'),adapter());await runtime.idle();assert.doesNotMatch(JSON.stringify(model.requests[1]?.input),/IMAGE_ANSWER/);
 const failAdapter=adapter();failAdapter.downloadMedia=()=>Promise.reject(new Error('Expired'));
 runtime.submit({...q,messageId:crypto.randomUUID()},failAdapter);await runtime.idle();const failed=JSON.stringify(model.requests[2]?.input);assert.doesNotMatch(failed,/input_image/);assert.match(failed,/media_unavailable|无法|不可用|失败/);
 }finally{await runtime.stop();}
});
void test('group approval resumes original tool state without sharing pending instructions or replaying another sender',async()=>{
 const base=defaultConfiguration();const config=RuntimeConfigSchema.parse({...base,agents:base.agents.map(a=>({...a,approvalTools:['memory_save']}))});
 const model=new ScriptModel((_r,index)=>Promise.resolve([index===0?call('memory_save',{libraryId:'default',text:'APPROVED_ONCE'}):done(index===1?'BOB_PUBLIC':'ALICE_APPROVED_PUBLIC')]));const runtime=new PriestessRuntime({database:':memory:',config,model});
 try{const run=runtime.submit(message('alice','PENDING_ALICE'),adapter());await runtime.idle();const pause=runtime.detail(run.id).events.find(e=>e.type==='paused');assert.ok(pause&&pause.type==='paused');
 runtime.submit(message('bob','BOB_DURING_APPROVAL'),adapter());await runtime.idle();assert.doesNotMatch(JSON.stringify(model.requests[1]?.input),/PENDING_ALICE|APPROVED_ONCE/);
 runtime.approve(run.id,pause.approvalId,true);await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'completed');assert.equal(runtime.memory.list().filter(m=>m.text==='APPROVED_ONCE').length,1);assert.throws(()=>runtime.approve(run.id,pause.approvalId,true));
 runtime.submit(message('carol','AFTER_APPROVAL'),adapter());await runtime.idle();const text=JSON.stringify(model.requests[3]?.input);assert.match(text,/BOB_PUBLIC/);assert.match(text,/ALICE_APPROVED_PUBLIC/);assert.doesNotMatch(text,/APPROVED_ONCE|function_call_result/);
 assert.equal(runtime.store.list('paused-inputs',z.unknown()).length,0);
 }finally{await runtime.stop();}
});
void test('bounded quoted image above the old textual storage ceiling completes a group turn',async()=>{
 const model=new ScriptModel(()=>Promise.resolve([done('LARGE_IMAGE_REPLY')]));const runtime=new PriestessRuntime({database:':memory:',model});const transport=adapter();
 const bytes=Buffer.alloc(3_100_000);bytes.set([255,216,255,224]);transport.downloadMedia=()=>Promise.resolve({bytes,mimeType:'image/jpeg',name:'large.jpg'});
 try{const input=message('alice','查看大图');input.parts.unshift({type:'quote',messageId:'big-original',senderId:'bob',availability:'available',attachments:[{type:'image',url:'fixture:large',mimeType:'image/jpeg'}]});const run=runtime.submit(input,transport);await runtime.idle();assert.equal(runtime.detail(run.id).run.status,'completed');assert.match(JSON.stringify(model.requests[0]?.input),/input_image/);}
 finally{await runtime.stop();}
});
