<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { runtimeAction, runtimeRequest } from '../../api/typescript';
import { confirmDestructiveAction, useUnsavedDraft } from '../../composables/unsaved';
import { ConfigSnapshotSchema, type ExampleDialog, type AgentDefinition } from '../../../../typescript/packages/contracts/src/index';
import { PersonaListSchema, PersonaSchema, type Persona, type PersonaBinding } from '../../../../typescript/packages/contracts/src/management';
import ExampleDialogsEditor from './ExampleDialogsEditor.vue';
const props = withDefaults(defineProps<{ initialPersonaId?: string; embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ saved: [persona: Persona]; close: []; busy: [value: boolean] }>();
const personas = ref<Persona[]>([]); const bindings = ref<PersonaBinding[]>([]); const agents = ref<AgentDefinition[]>([]); const search = ref(''); const selected = ref<Persona>(); const form = ref(false); const name = ref(''); const instructions = ref(''); const error = ref(''); const notice = ref(''); const busy = ref(false);
type SelectionMode = 'inherit' | 'selected' | 'none';
const exampleDialogs = ref<ExampleDialog[]>([]); const toolsMode = ref<SelectionMode>('inherit'); const skillsMode = ref<SelectionMode>('inherit'); const toolsText = ref(''); const skillsText = ref(''); const customErrorMessage = ref(''); const voicePrompt = ref('');
const { dirty, markSaved, confirmDiscard } = useUnsavedDraft('人格编辑', () => form.value ? { id: selected.value?.id, name: name.value, instructions: instructions.value, exampleDialogs: exampleDialogs.value, toolsMode: toolsMode.value, skillsMode: skillsMode.value, toolsText: toolsText.value, skillsText: skillsText.value, customErrorMessage: customErrorMessage.value, voicePrompt: voicePrompt.value } : null);
const boundAgents = computed(() => bindings.value.filter(item => item.personaId === selected.value?.id).map(item => agents.value.find(agent => agent.id === item.agentId)?.displayName ?? item.agentId));
const availableTools = computed(() => [...new Set(agents.value.flatMap(agent => agent.resources.tools))].sort());
function mode(values: string[] | null | undefined): SelectionMode { return values == null ? 'inherit' : values.length ? 'selected' : 'none'; }
function names(value: string): string[] { return [...new Set(value.split(/[\n,]/).map(name => name.trim()).filter(Boolean))]; }
function selection(value: SelectionMode, text: string): string[] | null { return value === 'inherit' ? null : value === 'none' ? [] : names(text); }
const filtered = computed(() => personas.value.filter(p => `${p.name} ${p.instructions}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
let metadataVersion = 0;
async function load(): Promise<void> { const version = ++metadataVersion; const [data, config] = await Promise.all([runtimeRequest('personas', PersonaListSchema), runtimeRequest('config', ConfigSnapshotSchema)]); if (version !== metadataVersion) return; personas.value = data.personas; bindings.value = data.bindings; agents.value = config.config.agents; }
function begin(persona?: Persona): void { if (busy.value || !confirmDiscard()) return; applyPersona(persona); }
function applyPersona(persona?: Persona): void { selected.value = persona; name.value = persona?.name ?? ''; exampleDialogs.value = persona?.exampleDialogs.map(item => ({ ...item })) ?? []; toolsMode.value = mode(persona?.tools); skillsMode.value = mode(persona?.skills); toolsText.value = persona?.tools?.join('\n') ?? ''; skillsText.value = persona?.skills?.join('\n') ?? ''; customErrorMessage.value = persona?.customErrorMessage ?? ''; voicePrompt.value = persona?.voicePrompt ?? ''; instructions.value = persona?.instructions ?? ''; form.value = true; error.value = ''; notice.value = ''; markSaved(); }
async function reloadCurrent(): Promise<void> {
  const current = selected.value;
  if (!current || busy.value || !confirmDiscard()) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const data = await runtimeRequest('personas', PersonaListSchema);
    const latest = data.personas.find(persona => persona.id === current.id);
    if (!latest) { error.value = `人格“${current.name}”已被删除。当前输入已保留，请复制需要的内容后关闭编辑；不会自动切换到其他人格。`; return; }
    metadataVersion++; personas.value = data.personas; bindings.value = data.bindings;
    applyPersona(latest);
    notice.value = `已重新载入“${latest.name}”的最新版本 r${latest.revision}。`;
  } catch (e) { error.value = e instanceof Error ? e.message : '重新载入失败，当前输入已保留。'; }
  finally { busy.value = false; }
}
function confirmClose(): boolean { return !busy.value && confirmDiscard(); }
defineExpose({ confirmClose });
function cancel(): void { if (props.embedded) { emit('close'); return; } if (!confirmClose()) return; form.value = false; selected.value = undefined; markSaved(); }
async function save(): Promise<void> { if (busy.value) return; busy.value = true; error.value = ''; try { const current = selected.value; const data = { name: name.value, instructions: instructions.value, exampleDialogs: exampleDialogs.value, tools: selection(toolsMode.value, toolsText.value), skills: selection(skillsMode.value, skillsText.value), customErrorMessage: customErrorMessage.value.trim() || null, voicePrompt: voicePrompt.value || null, folderId: current?.folderId ?? null }; const saved = await runtimeRequest(current ? `personas/${current.id}` : 'personas', PersonaSchema, current ? { ...data, expectedRevision: current.revision } : data, current ? 'PUT' : 'POST'); applyPersona(saved); emit('saved', saved); await load(); notice.value = props.embedded ? '共享人格已保存。已绑定 Agent 的后续新轮次使用新内容。' : '人格已保存，后续新轮次生效。'; } catch(e) { error.value = e instanceof Error ? e.message : '保存失败'; } finally { busy.value = false; } }
async function remove(): Promise<void> { if (!selected.value || busy.value || !confirmDiscard() || !confirmDestructiveAction(`删除人格“${selected.value.name}”？删除后无法恢复；已绑定人格不能删除。`)) return; busy.value = true; error.value = ''; notice.value = ''; try { await runtimeAction(`personas/${selected.value.id}`, { expectedRevision: selected.value.revision }, 'DELETE'); selected.value = undefined; form.value = false; markSaved(); await load(); notice.value = '人格已删除。'; } catch(e) { error.value = e instanceof Error ? e.message : '删除失败'; } finally { busy.value = false; } }

watch(busy, value => emit('busy', value), { immediate: true });
onMounted(() => { busy.value = true; void load().then(() => { if (props.initialPersonaId) { const target = personas.value.find(item => item.id === props.initialPersonaId); if (target) applyPersona(target); else error.value = '找不到指定人格。它可能已被删除。请关闭编辑，刷新人格库后重新选择。'; } else if (props.embedded) error.value = '未指定要编辑的人格。请关闭编辑，先选择一个人格。'; markSaved(); }).catch(e => { error.value = e instanceof Error ? e.message : '人格加载失败。请关闭编辑后重试。'; }).finally(() => { busy.value = false; }); });
</script>
<template>
<section class="management-workspace persona-single-list" :class="{'persona-embedded':embedded}">
  <header v-if="!embedded"><div><h2>人格管理</h2><p>编辑角色设定和示例对话。到 Agent 中选择要使用的人格。</p></div><button :disabled="busy" @click="begin()">＋ 新建人格</button></header>
  <div v-if="embedded" class="shared-impact"><p>保存会修改共享人格。已绑定 Agent 的后续新轮次都会使用新内容。</p><p>此保存独立于“发布此 Agent”。未发布的人格选择会保留。</p><p v-if="selected">当前有 {{boundAgents.length}} 个 Agent 使用此人格<span v-if="boundAgents.length">：{{boundAgents.join('、')}}</span>。</p></div>
  <p v-if="busy && !form" class="muted" role="status">正在读取人格…</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
  <div class="management-columns">
    <div v-if="!embedded" class="management-list"><div class="persona-list-heading"><strong>全部人格</strong><small>{{personas.length}} 个</small></div><input v-model="search" placeholder="搜索名称或设定" aria-label="搜索人格"/><button v-for="persona in filtered" :key="persona.id" :class="{ selected: selected?.id === persona.id }" :disabled="busy" @click="begin(persona)"><strong>{{ persona.name }}</strong><small>{{ persona.instructions.slice(0, 90) || '暂无指令' }}</small></button><p v-if="!filtered.length">{{search.trim()?'没有匹配的人格。请修改搜索词。':'还没有人格。点击“新建人格”开始编辑。'}}</p></div>
    <form v-if="form" class="management-editor" @submit.prevent="save">
      <div class="persona-editor-status"><p class="muted" role="status">{{dirty?'有未保存修改。':selected?'人格已保存。':'新建人格尚未保存。'}}保存后，后续新轮次使用新内容。</p><button v-if="selected" type="button" :disabled="busy" @click="reloadCurrent">重新载入当前人格</button></div>
      <p v-if="!embedded && boundAgents.length" class="persona-usage">{{boundAgents.length}} 个 Agent 正在使用此人格：{{boundAgents.join('、')}}。保存会影响它们的后续新轮次。</p>
      <fieldset :disabled="busy" class="persona-fields">
        <label>人格名称<input v-model="name" required maxlength="120"/></label>
        <label>人格指令<textarea v-model="instructions" rows="12" maxlength="100000" placeholder="描述身份、表达方式和行为要求…"/></label>
        <ExampleDialogsEditor v-model="exampleDialogs"/>
        <details class="persona-advanced"><summary>工具与 Skills 限制</summary><div class="persona-fields"><label>工具范围<select v-model="toolsMode"><option value="inherit">继承 Agent 已装配的工具</option><option value="selected">仅使用指定工具</option><option value="none">禁用全部工具</option></select></label><label v-if="toolsMode === 'selected'">工具名称（每行一个）<textarea v-model="toolsText" rows="4" placeholder="memory_recall&#10;knowledge_search"/></label><p v-if="toolsMode === 'selected'" class="muted">已配置工具：{{ availableTools.join('、') || '暂无' }}。人格只能缩小可用范围，不能授予额外权限。</p><label>Skills 范围<select v-model="skillsMode"><option value="inherit">继承 Agent 已装配的 Skills</option><option value="selected">仅使用指定 Skills</option><option value="none">禁用全部 Skills</option></select></label><label v-if="skillsMode === 'selected'">Skill 名称（技能目录名，每行一个）<textarea v-model="skillsText" rows="4" placeholder="example-skill"/></label></div></details>
        <details class="persona-advanced"><summary>失败回复与保留设置</summary><div class="persona-fields"><label>执行失败时的回复<textarea v-model="customErrorMessage" rows="3" maxlength="10000" placeholder="留空使用默认错误回复"/></label><details><summary>语音人格（暂未启用语音）</summary><label>语音指令<textarea v-model="voicePrompt" rows="3" maxlength="20000"/></label></details></div></details>
        <div class="actions"><button class="primary" :disabled="busy || (selected !== undefined && !dirty)">{{ busy ? '处理中…' : embedded ? '保存共享人格' : '保存人格' }}</button><button type="button" :disabled="busy" @click="cancel">关闭编辑</button><button v-if="selected && !embedded" type="button" :disabled="busy || boundAgents.length>0" @click="remove">删除人格</button></div>
        <p v-if="selected && !embedded && boundAgents.length" class="muted">需要删除时，先在 <RouterLink to="/agents">Agent</RouterLink> 中取消使用此人格。</p>
      </fieldset>
    </form>
    <div v-else-if="!embedded" class="management-editor empty">选择一个人格进行编辑，或新建人格。</div>
  </div>
</section>
</template>
<style scoped src="./management.css"></style>

<style scoped>.persona-fields{display:grid;gap:14px;border:0;padding:0;margin:0;min-width:0}.persona-embedded{gap:16px}.persona-embedded .management-columns{display:block}.persona-embedded .management-editor{border:0;box-shadow:none;padding:0;background:transparent;min-height:0}.shared-impact{border-left:3px solid #86b79b;background:#f0f6f2;padding:12px 15px;color:#42604c}.shared-impact p{overflow-wrap:anywhere;margin:0 0 6px;font-size:13px;line-height:1.7}.shared-impact p:last-child{margin-bottom:0}.persona-embedded label{font-size:13px}.persona-embedded input,.persona-embedded select,.persona-embedded textarea{font-size:14px}</style>

<style scoped>
.persona-single-list .management-columns{grid-template-columns:230px minmax(0,1fr)}.persona-single-list .management-editor{grid-column:auto}.persona-list-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.persona-list-heading small{color:var(--muted,#647c73)}.persona-editor-status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.persona-editor-status p{margin:0}.persona-editor-status button{font-size:12px}.persona-usage{padding:10px 13px;margin:0;border-left:3px solid var(--accent,#327d68);background:var(--surface-soft,#f4f8f6)}.persona-advanced{border-top:1px solid var(--line,#dce7e1);padding-top:15px}.persona-advanced>summary{font-size:14px;cursor:pointer}.persona-advanced>.persona-fields{margin-top:16px}.persona-embedded .management-columns{display:block}.persona-single-list a{color:var(--accent,#327d68)}@media(max-width:820px){.persona-single-list .management-columns{grid-template-columns:1fr}.persona-single-list .management-list{max-height:300px;overflow:auto}.persona-single-list .management-editor{grid-column:auto}}
</style>
