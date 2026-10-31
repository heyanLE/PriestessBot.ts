<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { PhArrowCounterClockwise, PhPaperPlaneTilt, PhChatCircleDots } from '@phosphor-icons/vue';
import { runtimeRequest } from '../../api/typescript';
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import type { RuntimeConfig, RunEvent } from '../../../../typescript/packages/contracts/src/index';
import { draftModelTestConfig } from './agent-workbench-model';
import { AgentDraftTestResultSchema, type AgentDraftTestResult } from '../../../../typescript/packages/contracts/src/agent-workbench';
const props = defineProps<{ config: RuntimeConfig; publishedConfig: RuntimeConfig; agentId: string; personaId: string | null; publishedPersonaId: string | null; ready: boolean; disabled?: boolean }>();
interface TestTurn { id: number; input: string; mode: 'draft' | 'published'; model: string; result: AgentDraftTestResult; }
const mode = ref<'draft' | 'published'>('draft'); const message = ref(''); const error = ref(''); const running = ref(false); const turns = ref<TestTurn[]>([]); let disposed = false; let sequence = 0; let requestController: AbortController | undefined; const notice = ref('');
const draft = useUnsavedDraft('测试消息', () => message.value, '/agents');
useUnsavedDraft('进行中的模型测试', () => running.value, '/agents');
const selectedConfig = computed(() => mode.value === 'draft' ? props.config : props.publishedConfig);
const selectedAgent = computed(() => selectedConfig.value.agents.find(item => item.id === props.agentId));
const sourceLabel = (source: 'draft' | 'published'): string => source === 'draft' ? '当前草稿' : '已发布配置';
async function send(): Promise<void> {
  if (running.value || props.disabled || !props.ready || !message.value.trim() || !selectedAgent.value) return;
  const input = message.value; const source = mode.value; const model = selectedAgent.value.model; const agentId = props.agentId;
  requestController?.abort(); const controller = new AbortController(); requestController = controller; running.value = true; error.value = ''; notice.value = '';
  try {
    const config = draftModelTestConfig(selectedConfig.value, props.publishedConfig, agentId);
    const personaId = source === 'draft' ? props.personaId : props.publishedPersonaId;
    const result = await runtimeRequest(`agents/${encodeURIComponent(agentId)}/draft-test`, AgentDraftTestResultSchema, { config, agentId, personaId, message: input }, 'POST', controller.signal);
    if (disposed || controller.signal.aborted || requestController !== controller) return;
    turns.value.push({ id: ++sequence, input, mode: source, model, result });
    if (result.status === 'completed') { message.value = ''; draft.markSaved(); }
  } catch (cause) { if (!disposed && requestController === controller) { if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) notice.value = '测试已取消，输入内容已保留。'; else error.value = cause instanceof Error ? `模型测试失败。${cause.message}` : '模型测试失败。输入已保留，请检查模型服务后重试。'; } }
  finally { if (requestController === controller) { running.value = false; requestController = undefined; } }
}
function clear(): void { if (running.value || !confirmDestructiveAction('清空本页的测试结果？正式会话会保留。')) return; turns.value = []; error.value = ''; }
function eventText(event: RunEvent): string { switch(event.type) { case 'node': return `${event.nodeId} · ${event.status} · ${event.summary}`; case 'started': return `开始执行 Agent ${event.agentId}`; case 'tool': return `${event.name} · ${event.status} · ${event.summary}`; case 'usage': return `用量：输入 ${event.inputTokens} / 输出 ${event.outputTokens} Token`; case 'failed': return event.error.message; case 'cancelled': return event.reason; case 'paused': return `等待审批：${event.tools.join('、')}`; case 'completed': return '模型回复完成'; case 'message_delta': case 'message_snapshot': return event.text; } }
function cancel(): void { requestController?.abort(); }
onBeforeUnmount(() => { disposed = true; requestController?.abort(); });
</script>
<template>
  <section class="agent-test" aria-label="Agent 模型测试">
    <header><h2><PhChatCircleDots :size="21"/>测试对话</h2><button type="button" class="quiet" :disabled="running || !turns.length" @click="clear"><PhArrowCounterClockwise :size="16"/>清空结果</button></header>
    <div class="test-source"><label>测试设置<select v-model="mode" :disabled="running || disabled"><option value="draft">使用当前草稿</option><option value="published" :disabled="!publishedConfig.agents.some(item=>item.id===agentId)">使用已发布配置</option></select></label><span>来源：Dashboard</span></div>
    <p class="test-scope">测试会真实调用模型并产生用量，费用按模型服务计算。仅测试人设与模型，不执行工具，也不发送 IM 消息。</p>
    <details class="test-limits"><summary>测试范围与限制</summary><ul><li>每次从独立会话开始，不延续上次测试内容。</li><li>使用所选配置的人格、示例对话和上下文策略。</li><li>人格库内容取服务端当前版本。不读取生产记忆、知识库或工作目录。</li><li>最长 120 秒，最多 3 轮。Agent 设置更小时，使用较小值。</li><li>{{selectedAgent?.budget.tokenLimitMode==='cumulative'?'累计 Token 预算':'单次输出 Token 上限'}}不超过 8192。Agent 设置更小时，使用较小值。</li></ul></details><p v-if="error" class="test-error" role="alert">{{error}}</p><p v-if="notice" class="test-config" role="status">{{notice}}</p>
    <div class="test-transcript" role="log" aria-label="测试结果">
      <div v-if="!turns.length && !running" class="test-empty"><PhChatCircleDots :size="32"/><strong>试试当前人设的回复方式</strong><p>修改左侧设置，然后发送测试消息。测试草稿无需发布。</p></div>
      <article v-for="turn in turns" :key="turn.id" class="test-turn"><p class="test-user">{{turn.input}}</p><div class="test-answer"><img src="/assets/priestess-icon.jpg" alt=""/><div><small>{{turn.mode==='draft'?'发送时草稿':'发送时已发布配置'}} · {{turn.model}}</small><p>{{turn.result.text || (turn.result.status==='completed'?'模型未返回正文。':'本次测试未完成。')}}</p><strong v-if="turn.result.status!=='completed'" class="test-error">{{turn.result.status==='failed'?'模型测试失败。输入已保留，请展开执行过程查看原因。':'模型测试已取消。输入已保留，可修改后重新发送。'}}</strong><details><summary>查看执行过程 · {{turn.result.inputTokens + turn.result.outputTokens}} Token</summary><ol><li v-for="event in turn.result.events.filter(item=>item.type!=='message_delta'&&item.type!=='message_snapshot')" :key="event.sequence">{{eventText(event)}}</li></ol><p>未发布配置 · 未发送 IM · 未启用工具</p></details></div></div></article>
      <p v-if="running" class="test-progress" role="status">正在等待模型回复。需要停止时，点击“取消测试”。</p>
    </div>
    <p class="test-config">{{selectedAgent?.model || '此 Agent 尚未发布'}} · {{sourceLabel(mode)}} · 工具未启用</p>
    <form class="test-composer" @submit.prevent="send"><label class="sr-only" for="agent-test-message">测试消息</label><textarea id="agent-test-message" v-model="message" :disabled="running || disabled || !ready" required rows="3" maxlength="16000" placeholder="输入一条消息，检查回复语气和内容…"/><div><small>目前支持文字测试</small><button v-if="running" type="button" @click="cancel">取消测试</button><button type="submit" :disabled="running || disabled || !ready || !selectedAgent || !message.trim()"><PhPaperPlaneTilt :size="17"/>{{running?'测试中…':'发送测试'}}</button></div></form>
  </section>
</template>
<style scoped>
.agent-test{display:flex;flex-direction:column;gap:14px;min-width:0;background:#f5f9f6;padding:26px 24px;border-left:1px solid #d9e6de;min-height:650px}header{display:flex;justify-content:space-between;align-items:center;gap:12px}h2{display:flex;align-items:center;gap:9px;margin:0;font-size:18px;color:#284f40}button{display:inline-flex;gap:7px;align-items:center}.quiet{border:0;background:transparent;font-size:12px;color:#637c6d}.test-source{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}.test-source label{display:flex;align-items:center;gap:8px;font-size:12px}.test-source select{padding:7px 9px;border:1px solid #c7d9cc;border-radius:6px;background:#fff;color:#38624d;font:inherit}.test-source span,.test-config,.test-composer small{font-size:12px;color:#688070}.test-scope{font-size:12px;line-height:1.7;color:#718175;margin:0}.test-limits{font-size:12px;line-height:1.8;color:#718175}.test-limits summary{cursor:pointer}.test-limits ul{padding-left:18px;margin:8px 0}.test-error{color:#a94437;font-size:12px}.test-transcript{display:grid;align-content:start;gap:25px;min-height:310px;max-height:600px;overflow:auto;flex:1;padding:12px 0;overflow-wrap:anywhere}.test-empty{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#7c9484;gap:12px;padding:20px}.test-empty strong{font-size:14px;color:#466351}.test-empty p{margin:0;font-size:12px;line-height:1.8}.test-turn{display:grid;gap:18px}.test-user{justify-self:end;margin:0;padding:12px 15px;border-radius:10px;background:#deede4;white-space:pre-wrap;max-width:90%;font-size:14px}.test-answer{display:flex;gap:10px;min-width:0}.test-answer img{width:32px;height:32px;border-radius:7px}.test-answer>div{min-width:0;flex:1}.test-answer small{font-size:11px;color:#738574}.test-answer p{margin:6px 0;white-space:pre-wrap;font-size:14px;line-height:1.8}.test-answer details{font-size:11px;color:#6b8171;margin-top:10px}.test-answer summary{cursor:pointer}.test-answer ol{padding-left:18px;line-height:1.7}.test-answer details p{font-size:11px}.test-progress{font-size:13px;color:#38765b}.test-config{margin:0}.test-composer{padding:12px;background:#fff;border:1px solid #c6d8cd;border-radius:9px;display:grid;gap:10px}.test-composer textarea{width:100%;border:0;background:transparent;padding:0;resize:vertical;font:inherit;line-height:1.7;color:inherit;box-sizing:border-box}.test-composer>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.test-composer button{border:1px solid #87b29a;background:#fff;color:#2e7758;border-radius:6px;padding:8px 10px;white-space:nowrap;font:inherit;font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}button:disabled{opacity:.45}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #86bba3;outline-offset:3px}@media(max-width:1050px){.agent-test{border-left:0;border-top:1px solid #d9e6de;min-height:500px;padding:22px}.test-transcript{max-height:450px}}
</style>
