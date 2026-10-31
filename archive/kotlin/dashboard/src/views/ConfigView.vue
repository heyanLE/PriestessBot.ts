<template>
  <main class="config-page">
    <header>
      <div>
        <p class="eyebrow">配置 v2</p>
        <h1>版本化配置编辑器</h1>
        <p>所有写入都经过严格预览、并发版本检查和原子生效。</p>
      </div>
      <div class="actions">
        <button @click="load" :disabled="busy">重新加载页面</button>
        <button @click="reloadRuntime" :disabled="busy">从磁盘重新编译</button>
      </div>
    </header>

    <section class="status-grid" v-if="effective">
      <article><span>当前版本</span><strong>{{ effective.activeVersion }}</strong></article>
      <article><span>目标修订</span><strong>{{ effective.desiredRevision.slice(0, 12) }}</strong></article>
      <article><span>工作区</span><strong>{{ Object.keys(effective.workspaces).length }}</strong></article>
      <article><span>待重启项</span><strong>{{ effective.pendingRestart.length }}</strong></article>
    </section>

    <section class="editor-panel">
      <div class="editor-head">
        <div>
          <h2>全局配置源</h2>
          <p>{{ raw?.normalizedSourcePath || '加载中…' }}</p>
        </div>
        <div class="actions">
          <button @click="preview" :disabled="busy || !draft">预览</button>
          <button class="primary" @click="apply" :disabled="busy || !previewResult?.success">应用修订</button>
        </div>
      </div>
      <textarea v-model="draft" spellcheck="false" />
    </section>

    <section class="result" v-if="previewResult">
      <h2>{{ previewResult.success ? '预览通过' : '预览未通过' }}</h2>
      <p>在线生效/重启计划：{{ previewResult.activationPlan.changes.length }} 项变更。</p>
      <ul v-if="previewResult.diagnostics.length">
        <li v-for="item in previewResult.diagnostics" :key="`${item.code}:${item.path}`">
          <strong>{{ item.code }}</strong> · {{ item.path || item.source }} · {{ item.message }}
        </li>
      </ul>
    </section>
    <p class="error" v-if="error">{{ error }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { dashboardApi, type ConfigurationOperationResult, type EffectiveConfigurationResponse, type RawGlobalConfigurationResponse } from '../api/dashboard';

const raw = ref<RawGlobalConfigurationResponse | null>(null);
const effective = ref<EffectiveConfigurationResponse | null>(null);
const draft = ref('');
const previewResult = ref<ConfigurationOperationResult | null>(null);
const busy = ref(false);
const error = ref('');

async function load() {
  busy.value = true; error.value = '';
  try {
    [raw.value, effective.value] = await Promise.all([dashboardApi.rawConfiguration(), dashboardApi.effectiveConfiguration()]);
    draft.value = JSON.stringify(raw.value.document, null, 2);
    previewResult.value = null;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

async function preview() {
  busy.value = true; error.value = '';
  try { previewResult.value = await dashboardApi.previewConfiguration(draft.value); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

async function apply() {
  if (!raw.value?.revision) return;
  busy.value = true; error.value = '';
  try {
    const result = await dashboardApi.applyConfiguration(draft.value, raw.value.revision);
    if (!result.success) { previewResult.value = result; return; }
    await load();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

async function reloadRuntime() {
  busy.value = true; error.value = '';
  try { previewResult.value = await dashboardApi.reloadConfiguration(); await load(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<style scoped>
.config-page { display: grid; gap: 1rem; }
header, .editor-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
.eyebrow { color: var(--color-accent, #6d5dfc); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.actions { display: flex; gap: .5rem; flex-wrap: wrap; }
button { padding: .65rem 1rem; border-radius: .6rem; border: 1px solid #d7d7df; background: white; cursor: pointer; }
button.primary { background: #5b4fe9; color: white; border-color: #5b4fe9; }
button:disabled { opacity: .5; cursor: not-allowed; }
.status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .75rem; }
.status-grid article, .editor-panel, .result { border: 1px solid #e2e2ea; border-radius: .85rem; padding: 1rem; background: var(--color-surface, white); }
.status-grid span { display: block; color: #747480; font-size: .8rem; }
.status-grid strong { font-size: 1.2rem; }
textarea { box-sizing: border-box; width: 100%; min-height: 34rem; margin-top: 1rem; padding: 1rem; border: 1px solid #d7d7df; border-radius: .65rem; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.error { color: #b42318; }
@media (max-width: 720px) { header, .editor-head { flex-direction: column; } }
</style>
