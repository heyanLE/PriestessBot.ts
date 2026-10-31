<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { AgentDefinition } from '../../../../packages/contracts/src/index';
import { PersonaListSchema, PersonaBindingSchema, type PersonaBinding, type Persona } from '../../../../packages/contracts/src/management';
import { EffectivePromptSchema } from '../../../../packages/contracts/src/search';
import { runtimeRequest, RUNTIME_AUTH_EXPIRED_EVENT } from '../../api/typescript';
import { useUnsavedDraft } from '../../composables/unsaved';
import type { AgentWorkbenchBindingDraft } from './AgentWorkbench.types';
import ExampleDialogsEditor from './ExampleDialogsEditor.vue';
import PersonaWorkspace from './PersonaWorkspace.vue';
const agent = defineModel<AgentDefinition>({ required: true });
const props = withDefaults(defineProps<{ persisted?: boolean; bindingMode?: 'independent' | 'workbench'; savedBinding?: PersonaBinding }>(), { persisted: true, bindingMode: 'independent' });
const emit = defineEmits<{ bindingDraft: [value: AgentWorkbenchBindingDraft] }>();
const router = useRouter();
const library = ref<ReturnType<typeof PersonaListSchema.parse>>({ personas: [], bindings: [] });
const preview = ref<ReturnType<typeof EffectivePromptSchema.parse> | null>(null);
const error = ref(''); const notice = ref(''); const loading = ref(false); const selected = ref(''); const ready = ref(false);
const { dirty, markSaved, confirmDiscard } = useUnsavedDraft('Agent 人格绑定', () => selected.value, '/agents');
const binding = computed(() => library.value.bindings.find(item => item.agentId === agent.value.id));
const persona = computed(() => library.value.personas.find(item => item.id === (props.bindingMode === 'workbench' ? selected.value : binding.value?.personaId)));
const sharedPersonaId = ref(''); const sharedDialog = ref<HTMLDialogElement>(); const sharedEditor = ref<InstanceType<typeof PersonaWorkspace>>(); const sharedEditorBusy = ref(false); const sharedSuspended = ref(false);
async function openSharedEditor(): Promise<void> {
  const id = persona.value?.id;
  if (!id || loading.value) return;
  if (sharedPersonaId.value && sharedPersonaId.value !== id && (sharedEditorBusy.value || (sharedEditor.value && !sharedEditor.value.confirmClose()))) return;
  sharedSuspended.value = false; sharedPersonaId.value = id;
  await nextTick();
  if (sharedDialog.value && !sharedDialog.value.open) sharedDialog.value.showModal();
}
async function resumeSharedEditor(): Promise<void> { if (!sharedPersonaId.value) return; sharedSuspended.value = false; await nextTick(); if (sharedDialog.value && !sharedDialog.value.open) sharedDialog.value.showModal(); }
function closeSharedEditor(): void {
  if (sharedEditorBusy.value || (sharedEditor.value && !sharedEditor.value.confirmClose())) return;
  sharedPersonaId.value = ''; sharedSuspended.value = false; sharedDialog.value?.close();
}
function updateSharedPersona(saved: Persona): void {
  if (saved.id !== sharedPersonaId.value) return;
  library.value.personas = library.value.personas.map(item => item.id === saved.id ? saved : item);
  notice.value = '共享人格已保存。当前 Agent 的人格选择草稿保持不变。';
}
function suspendSharedEditor(): void { if (sharedPersonaId.value) { sharedSuspended.value = true; sharedDialog.value?.close(); } }
window.addEventListener(RUNTIME_AUTH_EXPIRED_EVENT, suspendSharedEditor);
onBeforeUnmount(() => { window.removeEventListener(RUNTIME_AUTH_EXPIRED_EVENT, suspendSharedEditor); sharedDialog.value?.close(); });
function receiveSavedBinding(saved: PersonaBinding): void { if (saved.agentId !== agent.value.id) return; library.value.bindings = [...library.value.bindings.filter(item => item.agentId !== saved.agentId), saved]; selected.value = saved.personaId ?? ''; markSaved(); preview.value = null; }
async function load() { if (loading.value || !confirmDiscard()) return; ready.value = false; loading.value = true; error.value = ''; preview.value = null; const agentId = agent.value.id; try { const data = await runtimeRequest('personas', PersonaListSchema); if (agent.value.id !== agentId) return; library.value = data; selected.value = binding.value?.personaId ?? ''; markSaved(); ready.value = true; } catch (e) { error.value = e instanceof Error ? `人格库加载失败。${e.message}` : '人格库加载失败。请点击“重新载入人格”重试。'; } finally { loading.value = false; } }
async function bind() { if (loading.value || !ready.value || !dirty.value || !props.persisted) return; loading.value = true; error.value = ''; notice.value = ''; const agentId = agent.value.id; try { const saved = await runtimeRequest(`persona-bindings/${encodeURIComponent(agentId)}`, PersonaBindingSchema, { personaId: selected.value || null, expectedRevision: binding.value?.revision ?? 0 }, 'PUT'); if (agent.value.id !== agentId) return; library.value.bindings = [...library.value.bindings.filter(item => item.agentId !== agentId), saved]; selected.value = saved.personaId ?? ''; markSaved(); preview.value = null; notice.value = '人格绑定已保存。后续新轮次使用此人格。'; } catch (e) { error.value = e instanceof Error ? `人格绑定保存失败。${e.message}` : '人格绑定保存失败。当前选择已保留，请重试。'; } finally { loading.value = false; } }
function resetBinding(): void { selected.value = binding.value?.personaId ?? ''; markSaved(); preview.value = null; }
defineExpose({ resetBinding });
function discardBinding() { if (loading.value || !confirmDiscard()) return; resetBinding(); }
let previewGeneration = 0;
function previewSignature(): string { return JSON.stringify({ agent: agent.value, binding: binding.value, persona: persona.value }); }
async function showPreview() { const request = ++previewGeneration; const signature = previewSignature(); error.value = ''; try { const result = await runtimeRequest(`agents/${encodeURIComponent(agent.value.id)}/effective-prompt`, EffectivePromptSchema, agent.value); if (request === previewGeneration && signature === previewSignature()) preview.value = result; } catch (e) { if (request === previewGeneration && signature === previewSignature()) error.value = e instanceof Error ? `提示词预览失败。${e.message}` : '提示词预览失败。请检查模型和人格设置后重试。'; } }
watch(() => agent.value.id, load, { immediate: true });
watch(previewSignature, () => { previewGeneration++; preview.value = null; });
watch(() => props.savedBinding, value => { if (value) receiveSavedBinding(value); });
watch(() => [selected.value, binding.value?.revision, dirty.value, ready.value], () => emit('bindingDraft', { agentId: agent.value.id, personaId: selected.value || null, expectedBindingRevision: binding.value?.revision ?? 0, publishedPersonaId: binding.value?.personaId ?? null, dirty: dirty.value, ready: ready.value }), { immediate: true });
</script>
<template>
<div class="persona-configuration">
  <div v-if="error" class="error-banner" role="alert">{{ error }} <button type="button" :disabled="loading" @click="load">重新载入人格</button></div><p v-if="notice" class="persona-notice" role="status">{{notice}}</p>
  <p v-if="sharedSuspended" class="persona-notice" role="status">人格编辑已暂时收起，输入仍保留。重新登录后可继续。<button type="button" @click="resumeSharedEditor">继续编辑人格</button><button type="button" @click="closeSharedEditor">关闭人格编辑</button></p>
  <section class="persona-main">
    <div class="persona-heading"><h2>人格</h2><div class="persona-actions"><button v-if="persona" type="button" :disabled="loading" @click="openSharedEditor">编辑共享人格</button><details class="library-actions"><summary>人格库操作</summary><div><button type="button" :disabled="loading" @click="load">刷新人格库</button><button type="button" @click="router.push('/personas')">打开人格库</button></div></details></div></div>
    <div class="persona-selection"><label>选择人格<select v-model="selected" :disabled="!ready || loading || (bindingMode==='independent' && !persisted)"><option value="">使用此 Agent 的独立人格</option><option v-if="selected && !library.personas.some(item=>item.id===selected)" :value="selected">所选人格已不可用</option><option v-for="item in library.personas" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><button v-if="bindingMode==='independent'" type="button" :disabled="!ready || loading || !dirty || !persisted" @click="bind">{{loading?'保存中…':'保存人格绑定'}}</button><button v-if="dirty" type="button" class="quiet" :disabled="loading" @click="discardBinding">撤销人格选择</button></div>
    <p v-if="!persisted && bindingMode==='independent'" class="muted">先发布运行配置，创建此 Agent。然后选择人格并保存绑定。</p><p v-if="bindingMode==='independent'" class="muted">点击“保存人格绑定”后，新轮次使用所选人格。此操作独立保存。</p><p v-else class="muted">人格选择随“发布此 Agent”保存。右侧测试使用当前选择。</p>
    <template v-if="persona">
      <div class="persona-summary"><strong>{{persona.name}}</strong><span>{{persona.exampleDialogs.length}} 条示例消息</span></div>
      <p class="persona-excerpt">{{persona.instructions || '此人格暂未填写角色设定。'}}</p>
      <details class="persona-content"><summary>查看完整正文和示例</summary><pre class="prompt-preview">{{ persona.instructions }}</pre><div v-for="(item,index) in persona.exampleDialogs" :key="index" class="persona-example"><h4 v-if="item.scene">{{item.scene}}</h4><strong>{{item.role==='user'?'用户':'助手'}}</strong><pre class="prompt-preview">{{item.content}}</pre></div><p class="muted">编辑共享人格会影响所有使用它的 Agent。保存共享人格时会再次显示影响范围。</p></details>
    </template>
    <p v-else-if="ready && selected && bindingMode==='workbench'" class="error-banner" role="alert">所选人格已不存在。请重新选择人格，或改用独立人格。</p>
    <div v-else-if="ready" class="independent-persona"><label>人格正文<textarea v-model="agent.persona" rows="6" placeholder="描述身份、表达方式和行为要求"></textarea></label><ExampleDialogsEditor v-model="agent.exampleDialogs"/><details><summary>执行失败时的回复</summary><label class="reply-field"><span class="muted">留空使用默认错误回复。</span><textarea v-model="agent.customErrorMessage" rows="2" placeholder="填写此 Agent 的失败回复"></textarea></label></details></div>
  </section>
  <details class="persona-secondary"><summary>补充指令（高级）</summary><p class="muted">补充职责和执行要求。模型会同时收到人格内容和这些指令。</p><label>补充系统指令<textarea v-model="agent.instructions" rows="5" placeholder="例如：操作完成后根据工具实际结果汇报"></textarea></label></details>
  <details class="persona-secondary prompt-inspector"><summary>完整提示词预览</summary><p v-if="bindingMode==='workbench' && dirty" class="muted">人格选择尚未发布。先用右侧测试检查回复，发布后再查看完整提示词。</p><p v-else class="muted">查看当前补充指令、已保存的人格绑定和运行时规则。会话上下文另行加入。</p><button type="button" :disabled="!ready || loading || (bindingMode==='workbench' && dirty)" @click="showPreview">预览当前草稿</button><template v-if="preview"><p class="muted">{{preview.source==='persona_library' ? `人格库：${preview.personaName}` : '独立人格设定'}} · {{preview.exampleDialogs.length}} 条示例消息</p><pre class="prompt-preview">{{preview.systemPrompt}}</pre><p class="muted">{{preview.dynamicContextNote}}</p><p class="muted">人格允许的工具：{{preview.tools.join('、') || '无'}}</p></template></details>
  <Teleport to="body"><dialog ref="sharedDialog" class="shared-persona-dialog" aria-labelledby="shared-persona-title" @cancel.prevent="closeSharedEditor"><header class="shared-persona-heading"><h2 id="shared-persona-title">编辑共享人格</h2><button type="button" :disabled="sharedEditorBusy" @click="closeSharedEditor">关闭</button></header><PersonaWorkspace v-if="sharedPersonaId" :key="sharedPersonaId" ref="sharedEditor" :initial-persona-id="sharedPersonaId" embedded @saved="updateSharedPersona" @close="closeSharedEditor" @busy="sharedEditorBusy=$event"/></dialog></Teleport>
</div>
</template>
<style scoped>.prompt-preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto;font:inherit;background:var(--bg-secondary,#f4f8f5);padding:1rem;border-radius:8px}details summary{cursor:pointer}label{display:grid;gap:.4rem}textarea{width:100%;box-sizing:border-box}.shared-persona-dialog{width:760px;max-width:calc(100vw - 32px);max-height:88vh;overflow:auto;box-sizing:border-box;padding:24px;border:1px solid #c7d9cd;border-radius:12px;background:#fff;color:#2c4538;box-shadow:0 24px 70px #1f42332b}.shared-persona-dialog::backdrop{background:#18352966}.shared-persona-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.shared-persona-heading h2{font-size:20px;margin:0}.shared-persona-heading button{font:inherit;font-size:13px;padding:8px 13px;border:1px solid #cbdacf;border-radius:6px;background:white;color:inherit}@media(max-width:600px){.shared-persona-dialog{padding:18px;max-height:92vh}}
</style>

<style scoped>
.persona-configuration{display:grid;gap:20px;min-width:0}.persona-main{display:grid;gap:14px;padding-top:24px;border-top:1px solid var(--line,#dce7e1)}.persona-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.persona-heading h2{font-size:20px;margin:0;color:var(--ink,#213b33)}.persona-actions{display:flex;align-items:center;gap:13px;flex-wrap:wrap}.persona-actions button{font-size:13px}.library-actions{font-size:12px;color:var(--muted,#647c73)}.library-actions>div{display:grid;gap:8px;margin-top:10px}.library-actions summary{font-size:12px}.persona-selection{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.persona-selection label{flex:1;min-width:190px}.persona-selection select{width:100%;max-width:none}.persona-selection .quiet{border:0;background:transparent;font-size:12px;color:var(--muted,#647c73)}.persona-summary{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:4px}.persona-summary strong{font-size:14px}.persona-summary span{font-size:12px;color:var(--muted,#647c73)}.persona-excerpt{font-size:14px;line-height:1.8;color:var(--ink,#213b33);white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:0}.persona-content summary{font-size:13px;color:var(--accent-ink,#236453)}.persona-content .prompt-preview{font-size:13px;margin:12px 0}.persona-example{margin-top:16px}.persona-example h4{margin:0 0 8px;font-size:13px}.persona-example>strong{font-size:12px;color:var(--muted,#647c73)}.independent-persona{display:grid;gap:18px}.persona-secondary{border-top:1px solid var(--line,#dce7e1);padding-top:17px}.persona-secondary>summary{font-size:14px;font-weight:500}.persona-secondary>p{margin:12px 0}.persona-secondary>label{margin-top:14px}.prompt-inspector>button{margin-top:4px}.persona-notice{font-size:13px;line-height:1.7;background:var(--surface-soft,#f4f8f6);padding:10px 12px;border-radius:6px}.persona-notice button{margin:8px 8px 0 0}.reply-field{margin-top:12px}.muted{font-size:12px;line-height:1.7;color:var(--muted,#647c73);margin:0}.error-banner{font-size:13px;color:var(--critical,#b73935)}@media(max-width:600px){.persona-actions{gap:9px}.persona-selection{align-items:stretch}.persona-selection label{min-width:0;flex-basis:100%}.persona-summary{align-items:flex-start}.persona-summary span{white-space:nowrap}}
</style>
