<template>
  <section class="v3-stack">
    <div class="section-title">
      <div>
        <h3>Skill 文档</h3>
        <p>从已保存的目录读取技能，支持查看和编辑 SKILL.md。</p>
      </div>
      <button type="button" @click="load" :disabled="busy || disabled">读取技能</button>
    </div>
    <p v-if="disabled" class="muted">请先应用配置修订，再读取该资源的技能。</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <ul v-if="diagnostics.length" class="notice">
      <li v-for="item in diagnostics" :key="item">{{ item }}</li>
    </ul>
    <div v-if="items.length" class="table-wrap">
      <table class="table v3-skill-table">
        <thead>
          <tr>
            <th>技能</th>
            <th>来源</th>
            <th>权限</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="`${item.source}:${item.libraryId}:${item.name}`">
            <td>
              <strong>{{ item.name }}</strong>
              <p>{{ item.description }}</p>
              <small>{{ item.path }}</small>
            </td>
            <td>{{ sourceLabels[item.source] }} {{ item.libraryId }}</td>
            <td>{{ permissionLabels[item.permissionGroup] }}</td>
            <td>{{ item.enabled ? '启用' : '禁用' }}</td>
            <td><button type="button" @click="open(item)" :disabled="busy">编辑</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="loaded" class="muted">目录内暂无技能。</p>
    <button type="button" @click="create" :disabled="busy || disabled">新建 Skill</button>
    <form v-if="draft" class="v3-stack card" @submit.prevent="save">
      <div class="v3-form-grid">
        <label>
          技能名称
          <input
            v-model="draft.name"
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
            :readonly="editing"
          />
        </label>
        <label v-if="kind === 'agents'">
          来源
          <select v-model="draft.source" :disabled="editing">
            <option value="CONFIGURATION">Agent 配置目录</option>
            <option value="TEMPORARY">Agent 临时目录</option>
            <option value="PLATFORM" v-if="editing">平台库</option>
          </select>
        </label>
      </div>
      <label>
        SKILL.md
        <textarea
          v-model="draft.content"
          class="v3-code-input"
          rows="14"
          required
          spellcheck="false"
        />
      </label>
      <div class="toolbar">
        <button class="primary" :disabled="busy || disabled">保存文档</button>
        <button type="button" @click="draft = null">取消</button>
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { configV3Api, type SkillItem } from '../../api/configV3';
import { permissionLabels } from '../../models/configV3';
const props = defineProps<{ kind: 'agents' | 'skill-libraries'; id: string; disabled?: boolean }>();
const items = ref<SkillItem[]>([]);
const diagnostics = ref<string[]>([]);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const notice = ref('');
const editing = ref(false);
const draft = ref<{
  name: string;
  content: string;
  source: string;
  libraryId?: string | null;
} | null>(null);
const sourceLabels = { PLATFORM: '平台库', CONFIGURATION: '配置目录', TEMPORARY: '临时目录' };
async function load() {
  busy.value = true;
  error.value = '';
  try {
    const response = await configV3Api.skills(props.kind, props.id);
    items.value = response.items;
    diagnostics.value = response.diagnostics.map((item) =>
      typeof item === 'string' ? item : item.message,
    );
    loaded.value = true;
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
async function open(item: SkillItem) {
  busy.value = true;
  error.value = '';
  try {
    const doc = await configV3Api.skillDocument(props.kind, props.id, item);
    draft.value = { ...item, content: doc.content };
    editing.value = true;
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
function create() {
  draft.value = {
    name: '',
    source: props.kind === 'agents' ? 'CONFIGURATION' : 'PLATFORM',
    content: '---\ndescription: 技能说明\n---\n\n# 使用方法\n',
  };
  editing.value = false;
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  error.value = '';
  try {
    await configV3Api.saveSkill(props.kind, props.id, draft.value);
    notice.value = '技能文档已保存。';
    draft.value = null;
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
watch(
  () => [props.id, props.kind],
  () => {
    items.value = [];
    draft.value = null;
    loaded.value = false;
    diagnostics.value = [];
    error.value = '';
    notice.value = '';
  },
);
</script>
