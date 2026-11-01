import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { OpenAIProvider, Usage, protocol, withTrace, setTracingDisabled, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';
import { AuditedModel, type ModelAuditEvent } from '../packages/adapters/src/agents/model-audit.js';
import { createModelCaptureFetch, withRawModelCapture, type RawModelCaptureSink, type RawModelCaptureWriter, type RawModelPayloadMetadata, type RawModelCaptureScope } from '../packages/adapters/src/agents/raw-model-capture.js';

setTracingDisabled(true);

interface SavedPayload { metadata: RawModelPayloadMetadata; body: string; status: 'writing'|'complete'|'failed'; }
class Capture implements RawModelCaptureSink {
  readonly records: SavedPayload[]=[];
  failWrites=false;
  open(metadata: RawModelPayloadMetadata): Promise<RawModelCaptureWriter> {
    const record:SavedPayload={metadata,body:'',status:'writing'};this.records.push(record);
    return Promise.resolve({write:chunk=>{if(this.failWrites)return Promise.reject(new Error('Disk full'));record.body+=chunk;return Promise.resolve();},close:()=>{record.status='complete';return Promise.resolve();},fail:()=>{record.status='failed';return Promise.resolve();}});
  }
}
function request(input='user input'):ModelRequest{return {systemInstructions:'Configured apiKey=KEEP_PROMPT_VALUE',input,tools:[{type:'function',name:'lookup',description:'Complete tool description',parameters:{type:'object',properties:{query:{type:'string',description:'Specific query'}},required:['query'],additionalProperties:false},strict:true}],handoffs:[],outputType:'text',modelSettings:{maxTokens:123,temperature:0.2},tracing:false};}
function response(text='answer'):ModelResponse{return {usage:new Usage({inputTokens:4,outputTokens:2,totalTokens:6}),output:[protocol.AssistantMessageItem.parse({type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]})]};}
function observed(model:Model,capture:Capture){let calls=0;const events:ModelAuditEvent[]=[];return {events,model:new AuditedModel(model,{model:'fixture-model',source:()=>'model',nextCall:()=>++calls,knownSecrets:['KEEP_PROMPT_VALUE'],rawCapture:capture,emit:event=>events.push(event)})};}
function scope(capture:Capture,callId='call'):RawModelCaptureScope{return {sink:capture,identity:{callId,modelCall:1,model:'fixture-model',source:'model'},attempt:0};}
function json(text:string):unknown{return JSON.parse(text);}

await test('raw SDK snapshots preserve full input over one megabyte, tool schemas and literal sensitive-looking values',async()=>{
 const capture=new Capture();const text='payload '.repeat(150000)+'KEEP_PROMPT_VALUE';
 const stub:Model={getResponse:()=>Promise.resolve(response(text)),async *getStreamedResponse(){yield await Promise.resolve(protocol.StreamEvent.parse({type:'output_text_delta',delta:'unused'}));}};
 const tracked=observed(stub,capture);await tracked.model.getResponse(request(text));
 const saved=capture.records.find(r=>r.metadata.kind==='sdk_request');assert.ok(saved);const parsed=z.object({systemInstructions:z.string(),input:z.string(),tools:z.array(z.object({description:z.string(),parameters:z.object({properties:z.record(z.string(),z.unknown())})}))}).parse(json(saved.body));
 assert.equal(parsed.input,text);assert.match(parsed.systemInstructions,/KEEP_PROMPT_VALUE/);assert.equal(parsed.tools[0]?.description,'Complete tool description');assert.ok(parsed.tools[0]?.parameters.properties['query']);
 const output=capture.records.find(r=>r.metadata.kind==='sdk_response');assert.ok(output);assert.match(output.body,/KEEP_PROMPT_VALUE/);assert.ok(output.body.length>1_000_000);
 assert.ok(tracked.events.every(e=>e.inputPreview===undefined&&e.outputPreview===undefined));assert.ok(capture.records.every(r=>r.status==='complete'));
});

await test('official Responses SDK capture includes exact provider body and SDK retry attempts without authentication headers',async()=>{
 const capture=new Capture();const received:string[]=[];let sends=0;
 const transport:typeof fetch=(_url,init)=>{assert.equal(new Headers(init?.headers).get('authorization'),'Bearer AUTH_HEADER_ONLY');assert.equal(typeof init?.body,'string');if(typeof init?.body!=='string')throw new Error('Expected JSON');received.push(init.body);sends++;
  if(sends===1)return Promise.resolve(new Response(JSON.stringify({error:{message:'retry',type:'rate_limit_error'}}),{status:429,headers:{'content-type':'application/json','retry-after-ms':'1'}}));
  return Promise.resolve(new Response(JSON.stringify({id:'resp-fixture',object:'response',created_at:1,status:'completed',model:'fixture-model',output:[],usage:{input_tokens:4,output_tokens:2,total_tokens:6},provider_literal:'KEEP_RAW_RESPONSE'}),{headers:{'content-type':'application/json'}}));
 };
 const provider=new OpenAIProvider({openAIClient:new OpenAI({apiKey:'AUTH_HEADER_ONLY',baseURL:'https://model.invalid/v1',fetch:createModelCaptureFetch(transport),maxRetries:1}),useResponses:true});
 try{const tracked=observed(await provider.getModel('fixture-model'),capture);await withTrace('raw-capture-fixture',()=>tracked.model.getResponse(request()));
  const requests=capture.records.filter(r=>r.metadata.kind==='provider_request');assert.equal(requests.length,2);assert.deepEqual(requests.map(r=>r.metadata.attempt),[1,2]);assert.deepEqual(requests.map(r=>r.body),received);
  const wire=z.object({model:z.string(),instructions:z.string(),tools:z.array(z.object({name:z.string(),description:z.string()}))}).parse(json(requests[0]?.body??''));assert.equal(wire.model,'fixture-model');assert.match(wire.instructions,/KEEP_PROMPT_VALUE/);assert.equal(wire.tools[0]?.description,'Complete tool description');
  const responses=capture.records.filter(r=>r.metadata.kind==='provider_response');assert.deepEqual(responses.map(r=>r.metadata.httpStatus),[429,200]);assert.match(responses[1]?.body??'',/KEEP_RAW_RESPONSE/);assert.equal(responses[0]?.status,'failed');assert.equal(responses[1]?.status,'complete');assert.doesNotMatch(JSON.stringify(capture.records),/AUTH_HEADER_ONLY/);
 }finally{await provider.close();}
});

await test('official Chat Completions streaming captures complete SSE and full parsed SDK events',async()=>{
 const capture=new Capture();let wire='';
 const chunks=[{id:'chat-r',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'原文 KEEP_PROMPT_VALUE'},finish_reason:null}]},{id:'chat-r',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}];
 const sse=chunks.map(x=>`data: ${JSON.stringify(x)}\n\n`).join('')+'data: [DONE]\n\n';
 const transport:typeof fetch=(_url,init)=>{if(typeof init?.body!=='string')throw new Error('Expected JSON');wire=init.body;return Promise.resolve(new Response(sse,{headers:{'content-type':'text/event-stream'}}));};
 const provider=new OpenAIProvider({openAIClient:new OpenAI({apiKey:'AUTH_HEADER_ONLY',baseURL:'https://model.invalid/v1',fetch:createModelCaptureFetch(transport),maxRetries:0}),useResponses:false});
 try{const tracked=observed(await provider.getModel('fixture-model'),capture);const events:protocol.StreamEvent[]=[];for await(const event of tracked.model.getStreamedResponse(request()))events.push(event);
  assert.ok(events.some(event=>event.type==='response_done'));assert.equal(capture.records.find(r=>r.metadata.kind==='provider_request')?.body,wire);assert.equal(capture.records.find(r=>r.metadata.kind==='provider_response')?.body,sse);
  const sdk=capture.records.find(r=>r.metadata.kind==='sdk_response');assert.ok(sdk);const body=z.object({events:z.array(z.unknown()),complete:z.literal(true)}).parse(json(sdk.body));assert.deepEqual(body.events,JSON.parse(JSON.stringify(events)));assert.match(sdk.body,/KEEP_PROMPT_VALUE/);assert.equal(sdk.status,'complete');
 }finally{await provider.close();}
});

await test('capture keeps split UTF-8 response bytes intact and marks interrupted body capture incomplete',async()=>{
 const capture=new Capture();const bytes=new TextEncoder().encode('data: 中文😀\n\n');let cancelled=false;
 const completeFetch=createModelCaptureFetch(()=>Promise.resolve(new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.slice(0,8));controller.enqueue(bytes.slice(8,10));controller.enqueue(bytes.slice(10));controller.close();}}),{headers:{'content-type':'text/event-stream'}})));
 const complete=await withRawModelCapture(scope(capture,'complete'),()=>completeFetch('https://model.invalid',{body:'{}',method:'POST'}));assert.equal(await complete.text(),'data: 中文😀\n\n');assert.equal(capture.records.find(r=>r.metadata.callId==='complete'&&r.metadata.kind==='provider_response')?.body,'data: 中文😀\n\n');
 const partialFetch=createModelCaptureFetch(()=>Promise.resolve(new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new TextEncoder().encode('part'));},cancel(){cancelled=true;}}))));
 const partial=await withRawModelCapture(scope(capture,'partial'),()=>partialFetch('https://model.invalid',{body:'{}',method:'POST'}));const reader=partial.body?.getReader();assert.ok(reader);await reader.read();await reader.cancel();assert.ok(cancelled);assert.equal(capture.records.find(r=>r.metadata.callId==='partial'&&r.metadata.kind==='provider_response')?.status,'failed');
});

await test('concurrent calls keep request/response bodies in their own capture scope',async()=>{
 const capture=new Capture();const transport:typeof fetch=async(_url,init)=>{if(typeof init?.body!=='string')throw new Error('Expected body');const body=init.body;await new Promise(resolve=>setTimeout(resolve,body==='first'?10:1));return new Response(body,{headers:{'content-type':'application/json'}});};const fetcher=createModelCaptureFetch(transport);
 await Promise.all(['first','second'].map(id=>withRawModelCapture(scope(capture,id),async()=>{const result=await fetcher('https://model.invalid',{method:'POST',body:id});assert.equal(await result.text(),id);})));
 for(const id of ['first','second']){const records=capture.records.filter(r=>r.metadata.callId===id);assert.equal(records.length,2);assert.ok(records.every(r=>r.body===id&&r.metadata.attempt===1&&r.status==='complete'));}
});

await test('capture storage failures do not change model results or provider responses',async()=>{
 const capture=new Capture();capture.failWrites=true;const stub:Model={getResponse:()=>Promise.resolve(response('valid answer')),async *getStreamedResponse(){yield await Promise.resolve(protocol.StreamEvent.parse({type:'output_text_delta',delta:'unused'}));}};
 const result=await observed(stub,capture).model.getResponse(request());assert.deepEqual(result.output,response('valid answer').output);assert.ok(capture.records.every(r=>r.status==='failed'));
 const fetcher=createModelCaptureFetch(()=>Promise.resolve(new Response('provider body')));const raw=await withRawModelCapture(scope(capture),()=>fetcher('https://model.invalid',{method:'POST',body:'request'}));assert.equal(await raw.text(),'provider body');
});

await test('early custom-model stream stop retains complete partial events and marks the payload incomplete',async()=>{
 const capture=new Capture();let closed=false;const event=protocol.StreamEvent.parse({type:'output_text_delta',delta:'partial KEEP_PROMPT_VALUE'});
 const model:Model={getResponse:()=>Promise.resolve(response()),async *getStreamedResponse(){try{yield await Promise.resolve(event);yield event;}finally{closed=true;}}};
 const stream=observed(model,capture).model.getStreamedResponse(request());for await(const item of stream){assert.equal(item.type,'output_text_delta');break;}
 assert.ok(closed);const saved=capture.records.find(r=>r.metadata.kind==='sdk_response');assert.ok(saved);assert.equal(saved.status,'failed');assert.deepEqual(json(saved.body),{events:[event],complete:false});
});
