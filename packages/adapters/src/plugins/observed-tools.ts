import {randomUUID} from 'node:crypto';
import type {Tool} from '@openai/agents';
import type {EngineInput,RunEvent} from '../../../contracts/src/index.js';
import type {RuntimeStore} from '../../../core/src/storage.js';
import type {SdkLocalContext} from '../agents/engine.js';
/** SDK invocation metadata, never arguments/results, is persisted for operator visibility. */
export function observedTools(input:EngineInput,tools:Tool<SdkLocalContext>[],store:RuntimeStore,emit:(event:RunEvent)=>void):Tool<SdkLocalContext>[] {
 return tools.map(current=>current.type!=='function'?current:{...current,invoke:async(context,raw,details)=>{
  if(context.context.runId!==input.context.runId)throw new Error('Tool run identity mismatch');input.context.signal.throwIfAborted();
  const callId=details?.toolCall?.callId??randomUUID();
  if(!store.claimEvent(`tool:${input.context.runId}:${callId}`,86400000))throw new Error('Duplicate tool invocation refused');
  const event=(status:'started'|'completed'|'failed',summary:string):void=>emit({type:'tool',runId:input.context.runId,turnId:input.context.turnId,sequence:0,timestamp:Date.now(),name:current.name,callId,status,summary});
  event('started','调用工具');
  try{const result:unknown=await current.invoke(context,raw,details);input.context.signal.throwIfAborted();event('completed','工具已返回结果');return result;}
  catch(error){event('failed','工具调用失败或已取消');throw error;}
 }});
}
