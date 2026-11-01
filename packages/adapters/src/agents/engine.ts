import { randomUUID } from 'node:crypto';
import { protocol, MaxTurnsExceededError, Usage } from '@openai/agents';
import { Agent, OpenAIProvider, Runner, RunContext as SdkRunContext, RunState, type Model, type ModelProvider, type Tool, type AgentInputItem } from '@openai/agents';
import { z } from 'zod';
import type { AgentEngine, EngineInput, EngineResult, RunEvent, RuntimeConfig } from '../../../contracts/src/index.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import { AgentsContextSummarizer } from './context-summary.js';
import { SqliteAgentSession, estimateContextTokens } from './session.js';
import { principalKey } from '../../../core/src/authorization.js';
import { activeInputIndex, assembleRootInstructions, synchronizePersonaAnchors } from './prompt-context.js';
import { DynamicContextModel, type DynamicContextSnapshot } from './dynamic-context.js';
import type { PublicGroupMessage } from '../../../contracts/src/group-conversation.js';
import type { PortableHistoryItem } from '../../../core/src/history-continuation.js';
import { BudgetedModel, RunBudgetError } from './budget.js';
import { AuditedModel } from './model-audit.js';
import { capturedOpenAIProvider, type RawModelCaptureSink } from './raw-model-capture.js';
import { auditedTools } from './tool-audit.js';
import { safeAuditError } from './audit.js';

export interface SdkLocalContext { readonly runId: string; }
export interface AgentsEngineDependencies {
  readonly store: RuntimeStore;
  readonly config: () => RuntimeConfig;
  readonly secret: (name: string) => string | undefined;
  readonly auditSecrets?: () => readonly string[];
  readonly assertCurrent: (input: EngineInput) => void;
  readonly tools: (input: EngineInput, emit: (event: RunEvent) => void) => Promise<Tool<SdkLocalContext>[]>;
  readonly model?: Model;
  readonly followUps?: (input: EngineInput, close?: boolean) => Promise<readonly EngineInput[]>;
  readonly dynamicContext?: (input: EngineInput) => Promise<DynamicContextSnapshot>;
  readonly groupHistory?: (input: EngineInput) => readonly PublicGroupMessage[] | undefined;
  readonly historySeed?: (input: EngineInput, apply: (items: readonly PortableHistoryItem[]) => void) => void;
  readonly cleanup?: (input: EngineInput) => Promise<void>;
  readonly captureModel?: (input: EngineInput) => RawModelCaptureSink;
}
const PauseSchema = z.object({ engine: z.literal('agents_sdk'), version: z.string(), principal: z.string(), agentId: z.string(), generation: z.number(), revision: z.number(), usedTokens: z.number().default(0), usedTurns: z.number().default(0), usedModelCalls: z.number().default(0), observedModelCalls: z.number().int().nonnegative().default(0), lastMainModelCall: z.number().int().nonnegative().default(0), usedInputTokens: z.number().default(0), usedOutputTokens: z.number().default(0), taskTexts: z.array(z.string()).default([]), toolFacts: z.array(z.string()).default([]), lastInputTokens: z.number().default(0), lastEstimatedTokens: z.number().default(0), state: z.string() });
class FinalizationRequested extends Error {
  constructor(readonly reason: 'tokens' | 'turns') { super(`Run ${reason} budget reached; produce a tool-free final answer`); }
}
type EventPayload = RunEvent extends infer E ? E extends RunEvent ? Omit<E, 'runId' | 'turnId' | 'sequence' | 'timestamp'> : never : never;

/** SDK objects are confined to this adapter; business identity belongs to AgentDefinition. */
export class AgentsSdkEngine implements AgentEngine {
  readonly id = 'agents_sdk'; readonly version = '0.21.0';
  readonly capabilities = { streaming: true, images: true, files: true, cancellation: true, approvals: true, steering: true };
  constructor(private readonly dependencies: AgentsEngineDependencies) {}
  async run(input: EngineInput, emit: (event: RunEvent) => void): Promise<EngineResult> { return this.observedExecution(input,emit); }
  async resume(input: EngineInput, approvalId: string, approved: boolean, emit: (event: RunEvent) => void): Promise<EngineResult> { return this.observedExecution(input,emit,{id:approvalId,approved}); }
  private async observedExecution(input:EngineInput,emit:(event:RunEvent)=>void,approval?:{id:string;approved:boolean}):Promise<EngineResult>{
    let started=false;let terminal=false;let sequence=0;
    const forward=(event:RunEvent):void=>{if(event.runId===input.context.runId){sequence=Math.max(sequence,event.sequence+1);if(event.type==='started')started=true;if(['completed','failed','cancelled','paused'].includes(event.type))terminal=true;}emit(event);};
    try{return await this.execute(input,forward,approval);}
    catch(error){if(started&&!terminal){const base={runId:input.context.runId,turnId:input.context.turnId,sequence,timestamp:Date.now()};forward(input.context.signal.aborted?{...base,type:'cancelled',reason:'Run cancelled'}:{...base,type:'failed',error:{code:'internal',message:safeAuditError(error),retryable:false}});}throw error;}
    finally{await this.dependencies.cleanup?.(input);}
  }
  private async execute(input: EngineInput, emit: (event: RunEvent) => void, approval?: { id: string; approved: boolean }): Promise<EngineResult> {
    const deps = this.dependencies;
    deps.assertCurrent(input);
    const rawCapture = deps.captureModel?.(input);
    if (input.session.engine !== this.id || input.session.version !== this.version) throw new Error('Engine session version is incompatible');
    let sequence = 0;
    const send = (payload: EventPayload): void => emit({ ...payload, runId: input.context.runId, turnId: input.context.turnId, sequence: sequence++, timestamp: Date.now() });
    send({type:'started',agentId:input.agent.id});
    if(approval===undefined){
      const groupHistory=deps.groupHistory?.(input);
      if(groupHistory!==undefined){const items:AgentInputItem[]=groupHistory.map(item=>item.role==='assistant'?{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:item.text}]}:{role:'user',content:[{type:'input_text',text:item.text},...(item.images??[]).map((image):protocol.UserContent=>({type:'input_image',image:image.url}))]});deps.store.put('sdk-history',input.session.id,protocol.ModelItem.array().parse(items));}
      else deps.historySeed?.(input, items => deps.store.put('sdk-history', input.session.id, protocol.ModelItem.array().parse(items.map(item => item.role === 'user' ? { role:'user',content:[{type:'input_text',text:item.text}] } : {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:item.text}]}))));
    }
    const legacyToolStatus = new Map<string,'started'|'completed'|'failed'>();
    const suppliedTools = await deps.tools(input,event=>{if(event.runId===input.context.runId&&event.type==='tool'){legacyToolStatus.set(event.callId,event.status);return;}emit(event);});
    const config=deps.config();const secretNames=new Set<string>(config.connections.map(connection=>connection.apiKeyEnv));
    for(const platform of config.platforms)secretNames.add(platform.type==='napcat'?platform.accessTokenEnv:platform.tokenEnv);
    for(const server of config.mcpServers)for(const reference of [...Object.values(server.envRefs),...Object.values(server.headersEnv)])secretNames.add(reference);
    if(config.reranker)secretNames.add(config.reranker.apiKeyEnv);
    const knownSecrets=[...[...secretNames].flatMap(name=>{try{const secret=deps.secret(name);return secret?[secret]:[];}catch{return [];}}),...(deps.auditSecrets?.()??[])];
    let observedModelCalls=0;let lastMainModelCall=0;let modelSource:'model'|'finalization'='model';
    const nextCall=(source:'model'|'compression'|'finalization'):number=>{const index=++observedModelCalls;if(source==='model')lastMainModelCall=index;return index;};
    const tools=auditedTools(suppliedTools,{emit:send,knownSecrets,modelCall:()=>lastMainModelCall,legacyStatus:callId=>legacyToolStatus.get(callId)});
    const provider = this.provider(input);
    const selectedModel = deps.model ?? await provider?.getModel(input.agent.model);
    if (!selectedModel) throw new Error('Model provider unavailable');
    const localContext = new SdkRunContext<SdkLocalContext>({ runId: input.context.runId });
    let resumedTurns = 0; let usedInputTokens = 0; let usedOutputTokens = 0; let usageCalls = 0;
    let previousInputTokens = 0; let previousEstimatedTokens = 0; let currentEstimatedTokens = 0; let nextCallReserve = 0;
    const synchronizeExternalUsage = (): void => {
      // Child Agents add their cost to the SDK context; own responses were already
      // reported before the SDK saw them. Emit only the previously unseen delta.
      const inputTokens = Math.max(0, localContext.usage.inputTokens - usedInputTokens);
      const outputTokens = Math.max(0, localContext.usage.outputTokens - usedOutputTokens);
      if (inputTokens || outputTokens) accountUsage(new Usage({ inputTokens, outputTokens }), 'delegation');
    };
    const usedTokens = (): number => { synchronizeExternalUsage(); return usedInputTokens + usedOutputTokens; };
    const accountUsage = (usage: Usage, source: 'model' | 'compression' | 'finalization' | 'delegation'): void => {
      usedInputTokens += usage.inputTokens; usedOutputTokens += usage.outputTokens;
      if (source === 'model') { previousInputTokens = usage.inputTokens; previousEstimatedTokens = currentEstimatedTokens; }
      if(source!=='delegation')usageCalls++;
      send({ type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, source, ...(source === 'delegation' ? {} : { modelCall: observedModelCalls || usageCalls }) });
    };
    const taskTexts = input.message.parts.flatMap(part => part.type === 'text' ? [part.text] : []);
    const toolFacts: string[] = [];
    const currentInputs: AgentInputItem[] = modelInput(input);
    const userInputs: AgentInputItem[] = currentInputs.slice(-1);
    let continuationHistory: () => AgentInputItem[] = () => [...(deps.store.get('sdk-history', input.session.id, protocol.ModelItem.array()) ?? []), ...currentInputs];
    let modelOutputAllowance = Math.min(input.context.budget.maxTokens, Math.floor(input.agent.contextPolicy.contextWindowTokens / 4));
    let finalInputAllowance: number | undefined;
    let modelCalls = 0;
    const summarizer = new AgentsContextSummarizer(input, { ...(rawCapture ? { captureModel: true } : {}), auditModel:(model,modelName)=>new AuditedModel(model,{model:modelName,source:()=>'compression',nextCall,knownSecrets,emit:send,...(rawCapture ? {rawCapture} : {})}), config: deps.config, secret: deps.secret, assertCurrent: () => deps.assertCurrent(input), ...(deps.model ? { model: deps.model } : {}), usedTokens, accountUsage: usage => { accountUsage(usage, 'compression'); localContext.usage.add(usage); } });
    const session = new SqliteAgentSession(deps.store, input.session.id, () => deps.assertCurrent(input), input.context.depth===0&&input.message.sessionType==='group'&&deps.groupHistory?{targetChars:64_000,triggerChars:96_000,hardChars:48_000_000}:undefined, { policy: input.agent.contextPolicy, summarize: (items, maxChars, source) => summarizer.summarize(items, maxChars, source) });
    let latestInput = input; let preparedHistory: AgentInputItem[] = [];
    const dynamicModel = new DynamicContextModel(new AuditedModel(selectedModel,{model:input.agent.model,source:()=>modelSource,nextCall,knownSecrets,emit:send,...(rawCapture ? {rawCapture} : {})}), { scope: input.session.id, maxChars: 16000, insertionIndex: items => activeInputIndex(items, userInputs), assertCurrent: () => deps.assertCurrent(input), snapshot: () => deps.dynamicContext?.(latestInput) ?? Promise.resolve({scope:input.session.id,components:[]}), validateRequest: request => { if (finalInputAllowance !== undefined && estimateContextTokens(request.input) + estimateContextTokens(request.systemInstructions ?? '') > finalInputAllowance) throw new Error('Finalization input exceeds remaining cumulative budget'); const external = Math.max(0, estimateContextTokens(request.input) - estimateContextTokens(preparedHistory)) + estimateContextTokens(request.systemInstructions ?? '') + estimateContextTokens(JSON.stringify(request.tools)); session.assertWithinWindow(preparedHistory, external + modelOutputAllowance); }, observeUsage: (request, inputTokens) => { const external = Math.max(0, estimateContextTokens(request.input) - estimateContextTokens(preparedHistory)) + estimateContextTokens(request.systemInstructions ?? '') + estimateContextTokens(JSON.stringify(request.tools)); session.observeUsage(preparedHistory, {inputTokens}, external); } });
    const instructions = assembleRootInstructions(input.agent.instructions);
    const agent = new Agent<SdkLocalContext>({
      name: input.agent.id, instructions,
      model: new BudgetedModel(dynamicModel, input.context.budget.maxTokens, usedTokens, { mode: input.context.budget.tokenLimitMode, reserveTokens: () => nextCallReserve, onUsage: usage => accountUsage(usage, 'model') }),
      tools,
      modelSettings: { maxTokens: Math.min(input.context.budget.maxTokens, Math.floor(input.agent.contextPolicy.contextWindowTokens / 4)) },
    });
    const runner = new Runner({ ...(provider === undefined ? {} : { modelProvider: provider }), tracingDisabled: true, traceIncludeSensitiveData: false });
    let sdkInput: AgentInputItem[] | RunState<SdkLocalContext, typeof agent>;
    if (approval !== undefined) {
      const saved = deps.store.get('sdk-pauses', approval.id, PauseSchema);
      if (saved === undefined || saved.version !== this.version || saved.principal !== principalKey(input.context.principal) || saved.agentId !== input.agent.id || saved.generation !== input.context.generation || saved.revision !== input.context.configRevision) throw new Error('Approval state is stale or not owned by this caller');
      // An explicit SDK context override does not restore serialized usage. Seed it
      // once so child cost added during resume is compared against the same ledger.
      localContext.usage.add(new Usage({ inputTokens: saved.usedInputTokens, outputTokens: saved.usedOutputTokens, totalTokens: saved.usedTokens }));
      sdkInput = await RunState.fromStringWithContext(agent, saved.state, localContext);
      resumedTurns = saved.usedTurns; usedInputTokens = saved.usedInputTokens; usedOutputTokens = saved.usedOutputTokens; usageCalls = saved.usedModelCalls || saved.usedTurns; observedModelCalls=Math.max(saved.observedModelCalls,usageCalls);lastMainModelCall=saved.lastMainModelCall||observedModelCalls;
      if (saved.taskTexts.length) taskTexts.splice(0, taskTexts.length, ...saved.taskTexts);
      toolFacts.push(...saved.toolFacts); previousInputTokens = saved.lastInputTokens; previousEstimatedTokens = saved.lastEstimatedTokens;
      for (const item of sdkInput.getInterruptions()) { if (approval.approved) sdkInput.approve(item); else sdkInput.reject(item); }
      // Claim before resumption: uncertain side effects must never replay an approval state.
      deps.store.delete('sdk-pauses', approval.id);
    } else {
      sdkInput = modelInput(input);
    }
    try {
      modelCalls = resumedTurns;
      for (;;) {
        const steered: AgentInputItem[] = [];
        const result = await runner.run(agent, sdkInput, { stream: true, context: localContext, session, maxTurns: input.context.budget.maxTurns, signal: input.context.signal, callModelInputFilter: async ({ modelData }) => {
          deps.assertCurrent(input); const hardLimitOnly = modelCalls > 0; if (modelCalls >= input.context.budget.maxTurns) throw new FinalizationRequested('turns');
          const additional = await deps.followUps?.(input, false) ?? [];
          for (const followUp of additional) { latestInput = followUp; const messages = modelInput(followUp); steered.push(...messages); currentInputs.push(...messages); userInputs.push(...messages.slice(-1)); taskTexts.push(...followUp.message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])); }
          const combined = [...modelData.input]; for (const item of steered) if (!combined.some(existing => JSON.stringify(existing) === JSON.stringify(item))) combined.push(item);
          const snapshot = await deps.dynamicContext?.(latestInput); const dynamicTokens = snapshot ? estimateContextTokens(JSON.stringify(snapshot.components).slice(0,16000)) + 150 : 0;
          const reserved = estimateContextTokens(modelData.instructions ?? '') + estimateContextTokens(JSON.stringify(tools)) + dynamicTokens + Math.min(input.context.budget.maxTokens, Math.floor(input.agent.contextPolicy.contextWindowTokens / 4));
          const anchored = synchronizePersonaAnchors(combined, input.agent, activeInputIndex(combined, currentInputs));
          preparedHistory = await session.processInput(anchored, reserved, {hardLimitOnly});
          preparedHistory = synchronizePersonaAnchors(preparedHistory, input.agent, activeInputIndex(preparedHistory, currentInputs));
          session.setInFlight(true);
          currentEstimatedTokens = estimateContextTokens(preparedHistory) + reserved - Math.min(input.context.budget.maxTokens, Math.floor(input.agent.contextPolicy.contextWindowTokens / 4));
          if (input.context.budget.tokenLimitMode === 'cumulative' && input.context.budget.maxTokens >= 1024) {
            const remaining = input.context.budget.maxTokens - usedTokens();
            const nextInput = Math.max(currentEstimatedTokens, previousInputTokens + Math.max(0, currentEstimatedTokens - previousEstimatedTokens));
            const finishReserve = Math.min(8192, Math.max(512, Math.floor(input.context.budget.maxTokens / 8)));
            if (remaining <= nextInput + Math.min(2048, finishReserve) + finishReserve) throw new FinalizationRequested('tokens');
            nextCallReserve = nextInput + finishReserve;
          }
          modelCalls++;
          return { ...modelData, input: preparedHistory };
        } });
        continuationHistory = () => result.history;
        for await (const event of result) {
          deps.assertCurrent(input);
          if (event.type === 'run_item_stream_event' && event.name === 'tool_output' && event.item.rawItem) {
            synchronizeExternalUsage();
            const fact = JSON.stringify(event.item.rawItem); toolFacts.push(fact.length > 4000 ? `${fact.slice(0, 4000)} [result excerpt truncated]` : fact);
            if (toolFacts.length > 16) toolFacts.shift();
          }
          if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') send({ type: 'message_delta', text: event.data.delta });
        }
        await result.completed;
        const failure: unknown = result.error;
        if (failure !== undefined && failure !== null) throw (failure instanceof Error ? failure : new Error('SDK run failed'));
        const usage = { totalTokens: usedTokens(), inputTokens: usedInputTokens, outputTokens: usedOutputTokens };
        if (result.interruptions.length > 0) {
          const approvalId = randomUUID();
          deps.store.put('sdk-pauses', approvalId, { engine: this.id, version: this.version, principal: principalKey(input.context.principal), agentId: input.agent.id, generation: input.context.generation, revision: input.context.configRevision, usedTokens: usage.totalTokens, usedTurns: modelCalls, usedModelCalls: usageCalls, observedModelCalls, lastMainModelCall, usedInputTokens: usage.inputTokens, usedOutputTokens: usage.outputTokens, taskTexts, toolFacts, lastInputTokens: previousInputTokens, lastEstimatedTokens: previousEstimatedTokens, state: result.state.toString() });
          send({ type: 'paused', approvalId, tools: result.interruptions.map(item => item.name ?? 'unknown') });
          return { status: 'paused', text: '', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, state: approvalId };
        }
        const followUps = await deps.followUps?.(input) ?? [];
        deps.assertCurrent(input);
        if (followUps.length) {
          // The completed round is already in the session. Start only the new input,
          // retaining the same context and budget: previously dispatched tools never replay.
          sdkInput = followUps.flatMap(modelInput); currentInputs.push(...sdkInput); userInputs.push(...followUps.flatMap(followUp => modelInput(followUp).slice(-1))); latestInput = followUps.at(-1) ?? latestInput; taskTexts.push(...followUps.flatMap(followUp => followUp.message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])));
          send({ type: 'message_snapshot', text: '' });
          continue;
        }
        const text = result.finalOutput ?? '';
        send({ type: 'completed', text });
        return { status: 'completed', text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      }
    } catch (error) {
      synchronizeExternalUsage();
      if (input.context.signal.aborted) { send({ type: 'cancelled', reason: 'Run cancelled' }); return { status: 'cancelled', text: '', inputTokens: usedInputTokens, outputTokens: usedOutputTokens }; }
      if (error instanceof FinalizationRequested || error instanceof MaxTurnsExceededError || (error instanceof RunBudgetError && input.context.budget.maxTokens >= 1024)) {
        deps.assertCurrent(input);
        for (;;) {
          const pending = await deps.followUps?.(input) ?? [];
          if (!pending.length) break;
          currentInputs.push(...pending.flatMap(modelInput)); userInputs.push(...pending.flatMap(followUp => modelInput(followUp).slice(-1))); latestInput = pending.at(-1) ?? latestInput;
          taskTexts.push(...pending.flatMap(followUp => followUp.message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])));
          input.context.signal.throwIfAborted(); deps.assertCurrent(input);
        }
        const reason = error instanceof MaxTurnsExceededError || (error instanceof FinalizationRequested && error.reason === 'turns') ? 'turns' : 'tokens';
        const fallback = `本次任务受${reason === 'turns' ? '工具执行轮数' : '累计令牌预算'}限制，已停止继续调用工具。${toolFacts.length ? `已收到 ${toolFacts.length} 条工具结果；任务的最终结论尚未完成，不能据此确认整个任务成功。` : '尚未获得可用于完成任务的工具结果，任务尚未完成。'}已执行的操作不会自动重试。`;
        let text = fallback;
        try {
          const history = continuationHistory();
          const present = new Set(history.map(item => JSON.stringify(protocol.ModelItem.parse(item))));
          for (const item of currentInputs) if (!present.has(JSON.stringify(protocol.ModelItem.parse(item)))) history.push(item);
          modelOutputAllowance = Math.min(2048, input.context.budget.maxTokens);
          if (input.context.budget.tokenLimitMode === 'cumulative') finalInputAllowance = input.context.budget.maxTokens - usedTokens() - modelOutputAllowance;
          const snapshot = await deps.dynamicContext?.(latestInput);
          const dynamicTokens = snapshot ? estimateContextTokens(JSON.stringify(snapshot.components).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').slice(0, 16000)) + 150 : 0;
          modelSource='finalization';
          text = await this.finalize(input, dynamicModel, runner, instructions, history, currentInputs, session, dynamicTokens, reason, usedTokens, usage => accountUsage(usage, 'finalization'), items => { preparedHistory = items; }) ?? fallback;
        } catch (finalError) {
          if (input.context.signal.aborted) { send({ type: 'cancelled', reason: 'Run cancelled' }); return { status: 'cancelled', text: '', inputTokens: usedInputTokens, outputTokens: usedOutputTokens }; }
          deps.assertCurrent(input);
          // Finalization is best effort, but never starts tools or retries the completed effects.
          if (finalError instanceof RunBudgetError) text = fallback;
        }
        deps.assertCurrent(input); input.context.signal.throwIfAborted();
        // The SDK may stop before persisting its current user input. Preserve it once,
        // without inserting a second copy of already flushed tool rounds.
        const persisted = deps.store.get('sdk-history', input.session.id, protocol.ModelItem.array()) ?? [];
        const serializedItems = new Set(persisted.map(item => JSON.stringify(protocol.ModelItem.parse(item))));
        const missingInputs = currentInputs.filter(item => !serializedItems.has(JSON.stringify(protocol.ModelItem.parse(item))));
        await session.addItems([...missingInputs, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }]);
        send({ type: 'message_snapshot', text }); send({ type: 'completed', text });
        return { status: 'completed', text, inputTokens: usedInputTokens, outputTokens: usedOutputTokens };
      }
      send({ type: 'failed', error: { code: 'internal', message: 'Agent execution failed; inspect the local run diagnostic.', retryable: false } });
      throw error;
    } finally { if (provider instanceof OpenAIProvider) await provider.close(); }
  }
  private async finalize(input: EngineInput, model: Model, runner: Runner, instructions: string, history: AgentInputItem[], currentInputs: readonly AgentInputItem[], session: SqliteAgentSession, dynamicTokens: number, reason: 'tokens' | 'turns', usedTokens: () => number, accountUsage: (usage: Usage) => void, prepared: (items: AgentInputItem[]) => void): Promise<string | undefined> {
    this.dependencies.assertCurrent(input); input.context.signal.throwIfAborted();
    if (typeof instructions !== 'string') throw new Error('Finalization requires the original root instructions');
    const remaining = input.context.budget.tokenLimitMode === 'context' ? input.agent.contextPolicy.contextWindowTokens : input.context.budget.maxTokens - usedTokens();
    const outputAllowance = Math.min(2048, input.context.budget.maxTokens);
    if (remaining < outputAllowance + 512) return undefined;
    const notice = reason === 'turns'
      ? 'Maximum tool call limit reached. Stop calling tools, and based on the information you have gathered, summarize your task and findings, and reply to the user directly.'
      : 'The remaining cumulative token budget is insufficient for another tool round. Stop calling tools and reply directly using the conversation and results already gathered. Explain unresolved work accurately; do not claim the entire token allowance was consumed.';
    const closure: AgentInputItem = { role: 'user', content: notice };
    const anchored = synchronizePersonaAnchors(history, input.agent, activeInputIndex(history, currentInputs));
    let messages = await session.processInput(anchored, estimateContextTokens(instructions) + outputAllowance + dynamicTokens + 256, { hardLimitOnly: true });
    messages = synchronizePersonaAnchors(messages, input.agent, activeInputIndex(messages, currentInputs));
    // Never replace the active task, images or tool chain with text-only excerpts.
    // An optional cumulative cap may prevent a faithful final request altogether.
    if (input.context.budget.tokenLimitMode === 'cumulative' && estimateContextTokens(messages) + estimateContextTokens(instructions) + outputAllowance + dynamicTokens + 256 > remaining) return undefined;
    prepared(messages);
    const agent = new Agent({ name: input.agent.id, instructions, tools: [], model: new BudgetedModel(model, input.context.budget.maxTokens, usedTokens, { mode: input.context.budget.tokenLimitMode, onUsage: accountUsage }), modelSettings: { maxTokens: outputAllowance, toolChoice: 'none' } });
    const result = await runner.run(agent, [...messages, closure], { stream: true, maxTurns: 1, signal: input.context.signal });
    for await (const event of result) { if (event.type === 'run_item_stream_event' && event.name === 'tool_approval_requested') throw new Error('Finalization cannot request tool approval'); this.dependencies.assertCurrent(input); input.context.signal.throwIfAborted(); }
    await result.completed; this.dependencies.assertCurrent(input); input.context.signal.throwIfAborted();
    if (result.error) throw result.error instanceof Error ? result.error : new Error('Finalization failed');
    return result.finalOutput?.trim() || undefined;
  }
  private provider(input: EngineInput): ModelProvider | undefined {
    if (this.dependencies.model !== undefined) return undefined;
    const connection = this.dependencies.config().connections.find(item => item.id === input.agent.connectionId);
    if (connection === undefined) throw new Error('Model connection not found');
    const apiKey = this.dependencies.secret(connection.apiKeyEnv);
    if (!apiKey) throw new Error(`Credential environment variable is unavailable: ${connection.apiKeyEnv}`);
    if (this.dependencies.captureModel) return capturedOpenAIProvider({ apiKey, ...(connection.baseUrl === undefined ? {} : { baseURL: connection.baseUrl }), useResponses: connection.protocol === 'responses' });
    return new OpenAIProvider({ apiKey, ...(connection.baseUrl === undefined ? {} : { baseURL: connection.baseUrl }), useResponses: connection.protocol === 'responses', strictFeatureValidation: true });
  }
}

function modelInput(input: EngineInput): AgentInputItem[] {
  const content: protocol.UserContent[] = [{ type: 'input_text', text: input.message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n') }];
  for (const original of input.message.parts) {
   for(const part of original.type==='quote'?original.attachments??[]:[original]){
    if (part.type === 'image') {
      if (!part.url.startsWith('data:image/')) throw new Error('Image must pass through the authorized media preparation layer');
      content.push({ type: 'input_image', image: part.url });
    }
    if (part.type === 'file') {
      if (part.extractedText === undefined) throw new Error('File must be parsed before model execution');
      content.push({ type: 'input_text', text: `<attachment name=${JSON.stringify(part.name)}>\n${part.extractedText}\n</attachment>` });
    }
  }
  }
  const metadata: AgentInputItem[] = input.additionalContext ? [{ role: 'user', content: [{ type: 'input_text', text: `<context_unit name="request_metadata">\n${input.additionalContext}\n</context_unit>` }] }] : [];
  return [...metadata, { role: 'user', content }];
}
