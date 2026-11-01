import { randomUUID } from 'node:crypto';
import type { Model, ModelRequest, ModelResponse, protocol } from '@openai/agents';
import type { AuditPreview } from '../../../contracts/src/audit.js';
import type { RunEvent } from '../../../contracts/src/index.js';
import { safeAuditError, safeAuditPreview } from './audit.js';
import { captureModelJson, openSdkStreamCapture, withRawModelCapture, type RawModelCaptureScope, type RawModelCaptureSink, type RawSdkStreamCapture } from './raw-model-capture.js';

export type ModelAuditEvent = Omit<Extract<RunEvent,{type:'model_call'}>,'runId'|'turnId'|'sequence'|'timestamp'>;
export interface ModelAuditOptions {
  readonly model: string;
  readonly source: () => 'model'|'compression'|'finalization';
  readonly nextCall: (source: 'model'|'compression'|'finalization') => number;
  readonly knownSecrets: readonly string[];
  readonly emit: (event: ModelAuditEvent) => void;
  readonly rawCapture?: RawModelCaptureSink;
}
function tokens(usage: { inputTokens: number; outputTokens: number }): { inputTokens?: number; outputTokens?: number } {
  return { ...(Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 ? {inputTokens:usage.inputTokens}:{}), ...(Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 ? {outputTokens:usage.outputTokens}:{}) };
}
interface ModelCallSpan { readonly callId: string; readonly source: 'model'|'compression'|'finalization'; readonly modelCall: number; readonly started: number; readonly capture: RawModelCaptureScope | undefined; }
async function closeCapturedIterator(iterator: AsyncIterator<protocol.StreamEvent> | undefined, scope: RawModelCaptureScope | undefined, capture: RawSdkStreamCapture | undefined): Promise<void> {
  if (!iterator?.return) return;
  try { await withRawModelCapture(scope, () => iterator.return?.()); }
  catch (error) { await capture?.finish(false); throw error; }
}

/** Installed after prompt transformations. New payload storage bypasses legacy previews entirely. */
export class AuditedModel implements Model {
  constructor(private readonly wrapped: Model, private readonly options: ModelAuditOptions) {}
  get supportsPromptModelSelection(): boolean { return this.wrapped.supportsPromptModelSelection ?? false; }
  private async start(request: ModelRequest): Promise<ModelCallSpan> {
    const source=this.options.source(); const callId=randomUUID();const modelCall=this.options.nextCall(source);
    const capture = this.options.rawCapture ? { sink: this.options.rawCapture, identity: { callId, modelCall, model: this.options.model, source }, attempt: 0 } : undefined;
    const inputPreview = capture ? undefined : safeAuditPreview({ systemInstructions:request.systemInstructions ?? '', input:request.input, tools:request.tools.map(tool=>({type:tool.type,name:tool.name})), settings:{maxTokens:request.modelSettings.maxTokens,temperature:request.modelSettings.temperature,topP:request.modelSettings.topP,toolChoice:request.modelSettings.toolChoice,reasoningEffort:request.modelSettings.reasoning?.effort} },{knownSecrets:this.options.knownSecrets,maxChars:8000,recentArrayKeys:['input']});
    this.options.emit({type:'model_call',callId,model:this.options.model,source,status:'started',modelCall,...(inputPreview ? {inputPreview} : {})});
    // signal is an execution handle, not model input. Every model-visible SDK
    // field, including complete tools and provider settings, remains intact.
    const { signal, ...payload } = request;
    void signal;
    await captureModelJson(capture, 'sdk_request', payload);
    return {callId,source,modelCall,started:performance.now(),capture};
  }
  private finish(span: ModelCallSpan, status: 'completed'|'failed'|'cancelled', fields: {outputPreview?:AuditPreview;firstTokenMs?:number;inputTokens?:number;outputTokens?:number;error?:string} = {}): void {
    this.options.emit({type:'model_call',callId:span.callId,model:this.options.model,source:span.source,modelCall:span.modelCall,status,durationMs:Math.max(0,performance.now()-span.started),...fields});
  }
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const span=await this.start(request);
    try {
      const response=await withRawModelCapture(span.capture, () => this.wrapped.getResponse(request));
      await captureModelJson(span.capture, 'sdk_response', response);
      this.finish(span,'completed',{...(span.capture ? {} : {outputPreview:safeAuditPreview(response.output,{knownSecrets:this.options.knownSecrets})}),...tokens(response.usage)});return response;
    } catch(error){this.finish(span,request.signal?.aborted?'cancelled':'failed',{error:safeAuditError(error,this.options.knownSecrets)});throw error;}
  }
  async *getStreamedResponse(request: ModelRequest): AsyncIterable<protocol.StreamEvent> {
    const span=await this.start(request);const streamCapture=await openSdkStreamCapture(span.capture);
    let settled=false;let firstTokenMs:number|undefined;let text='';let chars=0;let iteratorDone=false;
    let iterator: AsyncIterator<protocol.StreamEvent> | undefined;
    const partial = (): AuditPreview => chars > 1_000_000 ? {text:'[未完成输出超过审计上限，正文已省略]',originalChars:chars,truncated:true,redacted:true} : safeAuditPreview(text,{knownSecrets:this.options.knownSecrets});
    try {
      const activeIterator=withRawModelCapture(span.capture, () => this.wrapped.getStreamedResponse(request)[Symbol.asyncIterator]());
      iterator=activeIterator;
      while (true) {
        const next=await withRawModelCapture(span.capture, () => activeIterator.next());
        if(next.done){iteratorDone=true;break;}
        const event=next.value;await streamCapture?.event(event);
        if(event.type==='output_text_delta') {if(firstTokenMs===undefined)firstTokenMs=Math.max(0,performance.now()-span.started);if(!span.capture){chars+=event.delta.length;if(chars<=1_000_000)text+=event.delta;}}
        if(event.type==='response_done') {settled=true;this.finish(span,'completed',{...(span.capture ? {} : {outputPreview:safeAuditPreview(event.response.output,{knownSecrets:this.options.knownSecrets})}),...(firstTokenMs===undefined?{}:{firstTokenMs}),...tokens(event.response.usage)});}
        yield event;
      }
      if(settled) await streamCapture?.finish(true);
      if(!settled){settled=true;await streamCapture?.finish(false);this.finish(span,request.signal?.aborted?'cancelled':'failed',{...(span.capture ? {} : {outputPreview:partial()}),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:request.signal?.aborted?'调用已取消。':'模型流已结束，但未收到完整响应。'});}
    } catch(error) {await streamCapture?.finish(false);if(!settled){settled=true;this.finish(span,request.signal?.aborted?'cancelled':'failed',{...(span.capture ? {} : {outputPreview:partial()}),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:safeAuditError(error,this.options.knownSecrets)});}throw error;}
    finally {
      try { if(!iteratorDone) await closeCapturedIterator(iterator,span.capture,streamCapture); }
      finally { await streamCapture?.finish(settled); if(!settled){this.finish(span,'cancelled',{...(span.capture ? {} : {outputPreview:partial()}),...(firstTokenMs===undefined?{}:{firstTokenMs}),error:'模型流在完整响应之前停止。'});} }
    }
  }
}
