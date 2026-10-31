import { randomUUID } from 'node:crypto';
import type { Model, ModelRequest, ModelResponse, protocol } from '@openai/agents';
import type { AuditPreview } from '../../../contracts/src/audit.js';
import type { RunEvent } from '../../../contracts/src/index.js';
import { safeAuditError, safeAuditPreview } from './audit.js';

export type ModelAuditEvent = Omit<Extract<RunEvent,{type:'model_call'}>,'runId'|'turnId'|'sequence'|'timestamp'>;
export interface ModelAuditOptions {
  readonly model: string;
  readonly source: () => 'model'|'compression'|'finalization';
  readonly nextCall: (source: 'model'|'compression'|'finalization') => number;
  readonly knownSecrets: readonly string[];
  readonly emit: (event: ModelAuditEvent) => void;
}
function tokens(usage: { inputTokens: number; outputTokens: number }): { inputTokens?: number; outputTokens?: number } {
  return { ...(Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 ? {inputTokens:usage.inputTokens}:{}), ...(Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 ? {outputTokens:usage.outputTokens}:{}) };
}

/** Installed next to the provider model, after all request transformations. */
export class AuditedModel implements Model {
  constructor(private readonly wrapped: Model, private readonly options: ModelAuditOptions) {}
  get supportsPromptModelSelection(): boolean { return this.wrapped.supportsPromptModelSelection ?? false; }
  private start(request: ModelRequest): { callId: string; source: 'model'|'compression'|'finalization'; modelCall: number; started: number } {
    const source=this.options.source(); const callId=randomUUID();const modelCall=this.options.nextCall(source);
    const inputPreview=safeAuditPreview({ systemInstructions:request.systemInstructions ?? '', input:request.input, tools:request.tools.map(tool=>({type:tool.type,name:tool.name})), settings:{maxTokens:request.modelSettings.maxTokens,temperature:request.modelSettings.temperature,topP:request.modelSettings.topP,toolChoice:request.modelSettings.toolChoice,reasoningEffort:request.modelSettings.reasoning?.effort} },{knownSecrets:this.options.knownSecrets,maxChars:8000,recentArrayKeys:['input']});
    const started=performance.now();
    this.options.emit({type:'model_call',callId,model:this.options.model,source,status:'started',modelCall,inputPreview});
    return {callId,source,modelCall,started};
  }
  private finish(span: ReturnType<AuditedModel['start']>, status: 'completed'|'failed'|'cancelled', fields: {outputPreview?:AuditPreview;firstTokenMs?:number;inputTokens?:number;outputTokens?:number;error?:string} = {}): void {
    this.options.emit({type:'model_call',callId:span.callId,model:this.options.model,source:span.source,modelCall:span.modelCall,status,durationMs:Math.max(0,performance.now()-span.started),...fields});
  }
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const span=this.start(request);
    try { const response=await this.wrapped.getResponse(request);this.finish(span,'completed',{outputPreview:safeAuditPreview(response.output,{knownSecrets:this.options.knownSecrets}),...tokens(response.usage)});return response; }
    catch(error){this.finish(span,request.signal?.aborted?'cancelled':'failed',{error:safeAuditError(error,this.options.knownSecrets)});throw error;}
  }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const span=this.start(request);let settled=false;let firstTokenMs:number|undefined;let text='';let chars=0;
    const partial = (): AuditPreview => chars > 1_000_000 ? {text:'[未完成输出超过审计上限，正文已省略]',originalChars:chars,truncated:true,redacted:true} : safeAuditPreview(text,{knownSecrets:this.options.knownSecrets});
    try {
      for await (const event of this.wrapped.getStreamedResponse(request)) {
        if(event.type==='output_text_delta') {if(firstTokenMs===undefined)firstTokenMs=Math.max(0,performance.now()-span.started);chars+=event.delta.length;if(chars<=1_000_000)text+=event.delta;}
        if(event.type==='response_done') {settled=true;this.finish(span,'completed',{outputPreview:safeAuditPreview(event.response.output,{knownSecrets:this.options.knownSecrets}),...(firstTokenMs===undefined?{}:{firstTokenMs}),...tokens(event.response.usage)});}
        yield event;
      }
      if(!settled){settled=true;this.finish(span,request.signal?.aborted?'cancelled':'failed',{outputPreview:partial(),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:request.signal?.aborted?'调用已取消。':'模型流已结束，但未收到完整响应。'});}
    } catch(error) {if(!settled){settled=true;this.finish(span,request.signal?.aborted?'cancelled':'failed',{outputPreview:partial(),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:safeAuditError(error,this.options.knownSecrets)});}throw error;}
    finally {if(!settled)this.finish(span,'cancelled',{outputPreview:partial(),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:'模型流在完整响应之前停止。'});}
  }
}
