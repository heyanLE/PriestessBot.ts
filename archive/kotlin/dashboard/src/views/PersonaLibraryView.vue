<template>
  <div class="v3-page persona-page">
    <header class="persona-page-header">
      <div>
        <h2>平台人格库</h2>
        <p>统一维护语气、提示词与示例，供 Agent 选择使用。</p>
      </div>
      <div class="toolbar persona-page-actions">
        <button type="button" @click="load" :disabled="busy">刷新</button>
        <button type="button" class="primary" @click="create" :disabled="busy">新建人格</button>
      </div>
    </header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice ok" role="status">{{ notice }}</p>

    <div class="v3-registry-layout persona-workbench">
      <aside class="panel persona-registry" aria-label="人格列表">
        <div class="registry-heading"><h3>人格</h3><span>{{ personas.length }} 个</span></div>
        <input v-model="query" type="search" aria-label="搜索人格" placeholder="搜索名称或描述" />
        <div class="persona-list">
          <button
            v-for="item in filtered"
            :key="item.id"
            type="button"
            @click="select(item)"
            :class="{ selected: draft?.id === item.id }"
            :aria-pressed="draft?.id === item.id"
            :disabled="busy"
          >
            <span class="persona-list-heading">
              <strong>{{ item.name }}</strong>
              <span class="persona-enabled" :class="{ disabled: !item.enabled }">{{ item.enabled ? '启用' : '禁用' }}</span>
            </span>
            <span class="persona-list-description">{{ item.description || '未填写描述' }}</span>
          </button>
        </div>
        <p v-if="!filtered.length" class="registry-empty">
          {{ query.trim() ? '没有匹配的人格，试试其他关键词。' : busy ? '正在加载人格…' : '还没有人格。新建后可在 Agent 中选择。' }}
        </p>
        <p v-else class="registry-note">{{ filtered.length === personas.length ? '选择一个人格开始编辑。' : `找到 ${filtered.length} 个人格。` }}</p>
      </aside>

      <form v-if="draft" class="panel persona-editor" @submit.prevent="save" :aria-busy="busy">
        <header class="persona-editor-header">
          <div>
            <h2>{{ draft.name || '新建人格' }}</h2>
            <span class="draft-state" :class="{ changed: dirty }">{{ dirty ? '有未保存的更改' : draft.id ? '已保存' : '填写下面的内容开始创建' }}</span>
          </div>
          <label class="v3-check persona-enabled-control">
            <input v-model="draft.enabled" type="checkbox" :disabled="busy" />
            启用人格
          </label>
        </header>

        <fieldset class="persona-fields" :disabled="busy">
          <section class="persona-section" aria-labelledby="persona-identity-title">
            <h3 id="persona-identity-title">名称与语气</h3>
            <div class="v3-form-grid persona-form-grid">
              <label>人格名称 <input v-model.trim="draft.name" required placeholder="例如：耐心的技术助手" /></label>
              <label>语气 <input v-model="draft.tone" placeholder="例如：简洁、温和、直接" /></label>
              <label class="v3-span-all">描述 <textarea v-model="draft.description" rows="2" placeholder="帮助你和其他使用者辨认这个人格的用途" /></label>
            </div>
          </section>

          <section class="persona-section" aria-labelledby="persona-prompt-title">
            <h3 id="persona-prompt-title">提示词与边界</h3>
            <div class="persona-field-stack">
              <label>系统提示词 <textarea v-model="draft.systemPromptTemplate" rows="9" placeholder="描述角色、表达方式和处理问题时应遵循的原则" /></label>
              <label>行为边界 <StringList v-model="draft.boundaries" label="人格行为边界" placeholder="每行填写一条需要遵守的边界" /></label>
            </div>
          </section>

          <section class="persona-section" aria-labelledby="persona-examples-title">
            <div class="example-section-heading">
              <div><h3 id="persona-examples-title">示例对话 <span>{{ draft.exampleDialogs.length }}</span></h3><p>按当前顺序提供给模型，用具体回复展示表达方式。</p></div>
              <button type="button" @click="draft.exampleDialogs.push({ user: '', assistant: '' })">添加对话</button>
            </div>
            <p v-if="!draft.exampleDialogs.length" class="examples-empty">暂未添加示例。你也可以先保存提示词，之后再补充对话。</p>
            <div v-for="(dialog, index) in draft.exampleDialogs" :key="index" class="persona-example">
              <div class="example-heading">
                <strong>对话 {{ index + 1 }}</strong>
                <div class="toolbar example-actions">
                  <button type="button" @click="moveItem(draft.exampleDialogs, index, -1)" :disabled="index === 0" :aria-label="`上移对话 ${index + 1}`">上移</button>
                  <button type="button" @click="moveItem(draft.exampleDialogs, index, 1)" :disabled="index === draft.exampleDialogs.length - 1" :aria-label="`下移对话 ${index + 1}`">下移</button>
                  <button type="button" @click="draft.exampleDialogs.splice(index, 1)" :aria-label="`移除对话 ${index + 1}`">移除</button>
                </div>
              </div>
              <div class="v3-form-grid persona-form-grid">
                <label>用户 <textarea v-model="dialog.user" rows="3" required placeholder="用户会怎样提问？" /></label>
                <label>助手 <textarea v-model="dialog.assistant" rows="3" required placeholder="希望人格怎样回应？" /></label>
              </div>
            </div>
          </section>
        </fieldset>

        <footer class="persona-editor-footer">
          <div class="toolbar persona-save-actions">
            <button type="submit" class="primary" :disabled="busy || !draft.name.trim()">保存人格</button>
            <button type="button" @click="cancel" :disabled="busy">取消</button>
          </div>
          <button v-if="draft.id" type="button" class="danger persona-delete" @click="remove" :disabled="busy">删除人格</button>
        </footer>
      </form>
      <section v-else class="panel persona-empty">
        <h2>选择一个人格</h2>
        <p>从列表打开人格，编辑语气、提示词和示例对话。</p>
        <button type="button" @click="create" :disabled="busy">新建人格</button>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { dashboardApi, type Persona, type PersonaUpsertDto } from '../api/dashboard';
import StringList from '../components/config/StringList.vue';
import { moveItem } from '../models/configV3';
const personas = ref<Persona[]>([]);
const query = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const draft = ref<PersonaUpsertDto | null>(null);
const original = ref('');
const filtered = computed(() =>
  personas.value.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
const dirty = computed(() => draft.value && JSON.stringify(draft.value) !== original.value);
const canDiscard = () => !dirty.value || window.confirm('放弃尚未保存的人格修改？');
async function load() {
  busy.value = true;
  error.value = '';
  try {
    personas.value = (await dashboardApi.personas('platform')).personas;
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
function select(item: Persona) {
  if (!canDiscard()) return;
  draft.value = {
    id: item.id,
    workspaceId: 'platform',
    name: item.name,
    description: item.description,
    tone: item.tone,
    boundaries: [...item.boundaries],
    systemPromptTemplate: item.systemPromptTemplate,
    exampleDialogs: item.exampleDialogs.map((dialog) => ({ ...dialog })),
    enabled: item.enabled,
    agentNames: [],
  };
  original.value = JSON.stringify(draft.value);
  notice.value = '';
}
function create() {
  if (!canDiscard()) return;
  notice.value = '';
  draft.value = {
    workspaceId: 'platform',
    name: '',
    description: '',
    tone: '',
    boundaries: [],
    systemPromptTemplate: '',
    exampleDialogs: [],
    enabled: true,
    agentNames: [],
  };
  original.value = JSON.stringify(draft.value);
}
function cancel() {
  if (canDiscard()) draft.value = null;
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  error.value = '';
  try {
    const body = {
      ...draft.value,
      boundaries: draft.value.boundaries.map((item) => item.trim()).filter(Boolean),
    };
    const saved = body.id
      ? await dashboardApi.updatePersona(body.id, body)
      : await dashboardApi.savePersona(body);
    original.value = JSON.stringify(draft.value);
    select(saved);
    notice.value = '人格已保存。';
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!draft.value?.id || !window.confirm('删除该人格？已绑定的 Agent 需要重新选择人格。')) return;
  busy.value = true;
  error.value = '';
  try {
    await dashboardApi.deletePersona(draft.value.id);
    draft.value = null;
    notice.value = '人格已删除。';
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
onBeforeRouteLeave(() => !!canDiscard());
onMounted(load);
</script>

<style scoped>
.persona-page-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; padding: 2px 0 4px; }
.persona-page-header h2 { margin: 0; font-size: 22px; }
.persona-page-header p { margin: 7px 0 0; color: var(--muted, #63758a); font-size: 13px; }
.persona-page-actions { gap: 8px; }
.persona-workbench { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); gap: 20px; }
.persona-registry { padding: 18px 0 10px; position: sticky; top: 20px; overflow: hidden; }
.registry-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 18px 14px; }
.registry-heading h3 { margin: 0; font-size: 14px; }
.registry-heading > span { color: var(--muted, #63758a); font-size: 12px; }
.persona-registry > input { width: calc(100% - 36px); margin: 0 18px 14px; }
.persona-list { display: grid; max-height: 64vh; overflow: auto; }
.persona-list > button { display: grid; grid-template-columns: minmax(0, 1fr); justify-content: stretch; justify-items: stretch; gap: 7px; width: 100%; min-width: 0; padding: 14px 18px; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; text-align: left; white-space: normal; }
.persona-list > button.selected { background: var(--surface-soft); box-shadow: inset 3px 0 var(--accent, #be4b43); }
.persona-list-heading { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.persona-list-heading strong { overflow-wrap: anywhere; font-size: 14px; }
.persona-enabled { flex-shrink: 0; padding-top: 1px; color: #3e7866; font-size: 11px; font-weight: 400; }
.persona-enabled.disabled { color: var(--muted, #63758a); }
.persona-list-description { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--muted, #63758a); font-size: 12px; font-weight: 400; line-height: 1.6; overflow-wrap: anywhere; }
.registry-note, .registry-empty { margin: 12px 18px 4px; color: var(--muted, #63758a); font-size: 12px; line-height: 1.7; }
.registry-empty { padding: 14px 0; }
.persona-editor { padding: 0; overflow: hidden; }
.persona-editor-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; padding: 22px 26px; border-bottom: 1px solid var(--line, #dae3ec); }
.persona-editor-header h2 { margin: 0 0 7px; font-size: 20px; overflow-wrap: anywhere; }
.draft-state { color: var(--muted, #63758a); font-size: 12px; }
.draft-state.changed { color: #a15b23; }
.persona-enabled-control { flex-shrink: 0; font-size: 13px; }
.persona-fields { min-width: 0; padding: 0; margin: 0; border: 0; }
.persona-section { padding: 24px 26px; }
.persona-section + .persona-section { border-top: 1px solid var(--line, #dae3ec); }
.persona-section h3 { margin: 0 0 18px; font-size: 14px; }
.persona-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.persona-form-grid label, .persona-field-stack label { display: grid; gap: 8px; color: var(--ink, #172c42); font-size: 13px; }
.persona-form-grid textarea { min-height: 76px; }
.persona-field-stack { display: grid; gap: 20px; }
.example-section-heading { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px; }
.example-section-heading h3 { margin-bottom: 7px; }
.example-section-heading h3 span { margin-left: 6px; color: var(--muted, #63758a); font-size: 12px; font-weight: 400; }
.example-section-heading p, .examples-empty { margin: 0; color: var(--muted, #63758a); font-size: 12px; line-height: 1.7; }
.examples-empty { margin-top: 18px; }
.persona-example { padding-top: 20px; }
.persona-example + .persona-example { margin-top: 20px; border-top: 1px solid var(--line); }
.example-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
.example-heading strong { font-size: 12px; font-weight: 600; }
.example-actions { gap: 6px; }
.example-actions button { min-height: 30px; padding: 4px 8px; font-size: 12px; }
.persona-editor-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; padding: 18px 26px; border-top: 1px solid var(--line, #dae3ec); background: var(--surface-soft); }
.persona-save-actions { gap: 8px; }
.persona-delete { font-size: 13px; }
.persona-empty { display: grid; justify-items: start; align-content: center; min-height: 280px; padding: 32px; }
.persona-empty h2 { margin: 0 0 10px; font-size: 18px; }
.persona-empty p { margin: 0 0 20px; color: var(--muted, #63758a); font-size: 13px; line-height: 1.7; }
@media (max-width: 900px) { .persona-workbench { grid-template-columns: 210px minmax(0, 1fr); gap: 14px; } .persona-form-grid { grid-template-columns: 1fr; } .persona-section, .persona-editor-header { padding: 20px; } }
@media (max-width: 700px) {
  .persona-workbench { grid-template-columns: minmax(0, 1fr); }
  .persona-registry { position: static; }
  .persona-list { max-height: 240px; }
  .persona-page-actions, .persona-save-actions, .example-actions { width: auto; }
  .persona-page-actions > button, .persona-save-actions > button, .example-actions > button { flex: 0 1 auto; }
  .persona-editor-header, .persona-section { padding: 18px; }
  .persona-editor-footer { padding: 16px 18px; }
  .persona-empty { min-height: 220px; padding: 24px; }
}
</style>
