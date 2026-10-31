import { randomUUID } from 'node:crypto';
import type { Tool } from '@openai/agents';
import type { RunEvent } from '../../../contracts/src/index.js';
import type { SdkLocalContext } from './engine.js';
import { safeAuditError, safeAuditPreview } from './audit.js';

export type ToolAuditEvent = Omit<Extract<RunEvent,{type:'tool'}>,'runId'|'turnId'|'sequence'|'timestamp'>;
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function failureResult(value:unknown):boolean {
  let result:unknown=value;
  if(typeof result==='string'&&result.length<=1_000_000){try{result=JSON.parse(result);}catch{return false;}}
  return record(result)&&(result['isError']===true||result['status']==='failed'||result['status']==='rejected'||typeof result['error']==='string');
}
export function auditedTools(tools:readonly Tool<SdkLocalContext>[],options:{readonly emit:(event:ToolAuditEvent)=>void;readonly knownSecrets:readonly string[];readonly modelCall:()=>number;readonly legacyStatus?:(callId:string)=>'started'|'completed'|'failed'|undefined}):Tool<SdkLocalContext>[] {
  return tools.map(entry=>{
    if(entry.type!=='function')return entry;
    return {...entry,invoke:async(context,raw,details)=>{
      const callId=details?.toolCall?.callId??randomUUID();const modelCall=options.modelCall();const started=performance.now();
      const base={type:'tool',name:entry.name,callId,...(modelCall>0?{modelCall}:{})};
      options.emit({type:'tool',name:entry.name,callId,status:'started',summary:'开始调用工具。',inputPreview:safeAuditPreview(raw,{knownSecrets:options.knownSecrets}),...(modelCall>0?{modelCall}:{})});
      try{
        const result:unknown=await entry.invoke(context,raw,{...details,...(details?.toolCall?{toolCall:{...details.toolCall,callId}}:{})});
        const failed=options.legacyStatus?.(callId)==='failed'||failureResult(result);
        options.emit({...base,type:'tool',status:failed?'failed':'completed',summary:failed?'工具返回错误。':'工具已返回结果。',outputPreview:safeAuditPreview(result,{knownSecrets:options.knownSecrets}),durationMs:Math.max(0,performance.now()-started)});
        return result;
      }catch(error){options.emit({...base,type:'tool',status:'failed',summary:safeAuditError(error,options.knownSecrets),durationMs:Math.max(0,performance.now()-started)});throw error;}
    }};
  });
}
