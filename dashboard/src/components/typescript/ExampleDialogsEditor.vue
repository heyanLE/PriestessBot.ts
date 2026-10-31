<script setup lang="ts">
import { computed } from 'vue';
import type { ExampleDialog } from '../../../../packages/contracts/src/index';
import { exampleScenes } from '../../../../packages/contracts/src/example-scenes';

const dialogs = defineModel<ExampleDialog[]>({ required: true });
const scenes = computed(() => exampleScenes(dialogs.value));
const canAddPair = computed(() => dialogs.value.length + 2 <= 100);

// Preserve every legacy pair as its own scene before introducing explicit boundaries.
function normalizedDialogs(): ExampleDialog[] {
  return dialogs.value.map((dialog, index) => {
    const scene = scenes.value.find(item => item.start === index);
    return scene ? { ...dialog, scene: scene.title } : { ...dialog };
  });
}
function addScene(): void {
  if (!canAddPair.value) return;
  dialogs.value = [...normalizedDialogs(),
    { role: 'user', content: '', scene: `场景 ${scenes.value.length + 1}` },
    { role: 'assistant', content: '' }];
}
function moveScene(index: number, delta: number): void {
  const scene = scenes.value[index];
  const neighbor = scenes.value[index + delta];
  if (!scene || !neighbor) return;
  const next = normalizedDialogs();
  const removed = next.splice(scene.start, scene.end - scene.start);
  const target = delta < 0 ? neighbor.start : neighbor.end - removed.length;
  next.splice(target, 0, ...removed);
  dialogs.value = next;
}
function removeScene(index: number): void {
  const scene = scenes.value[index];
  if (!scene) return;
  const next = normalizedDialogs();
  next.splice(scene.start, scene.end - scene.start);
  dialogs.value = next;
}
function renameScene(index: number, event: Event): void {
  const scene = scenes.value[index];
  if (!scene || !(event.target instanceof HTMLInputElement)) return;
  const next = normalizedDialogs();
  const first = next[scene.start];
  if (first) first.scene = event.target.value.trim() || `场景 ${index + 1}`;
  dialogs.value = next;
}
function pairIndexes(start: number, end: number): number[] {
  return Array.from({ length: Math.floor((end - start) / 2) }, (_, index) => start + index * 2);
}
function addPair(index: number): void {
  const scene = scenes.value[index];
  if (!scene || !canAddPair.value) return;
  const next = normalizedDialogs();
  next.splice(scene.end, 0, { role: 'user', content: '' }, { role: 'assistant', content: '' });
  dialogs.value = next;
}
function removePair(sceneIndex: number, pairIndex: number): void {
  const scene = scenes.value[sceneIndex];
  if (!scene || scene.end - scene.start <= 2 || pairIndex < scene.start || pairIndex >= scene.end) return;
  const next = normalizedDialogs();
  next.splice(pairIndex, 2);
  const first = next[scene.start];
  if (first) first.scene = scene.title;
  dialogs.value = next;
}
function edit(index: number, event: Event): void {
  const item = dialogs.value[index];
  if (item && event.target instanceof HTMLTextAreaElement) item.content = event.target.value;
}
</script>

<template>
  <section class="example-dialogs">
    <div class="actions">
      <h3>示例对话</h3>
      <span class="muted">{{ scenes.length }} 个场景 · {{ dialogs.length / 2 }} 轮问答 / 最多 50 轮</span>
      <button type="button" :disabled="!canAddPair" @click="addScene">＋ 添加场景</button>
    </div>
    <p class="muted">每个场景展示一种独立情境，可以连续添加多轮问答。示例以用户、助手角色提供给模型，不写入实际会话记录。旧版单轮示例会分别显示为独立场景。</p>
    <details v-for="(scene, sceneIndex) in scenes" :key="sceneIndex" class="scene" :open="sceneIndex === 0">
      <summary><strong>{{ scene.title }}</strong><span class="muted">{{ (scene.end - scene.start) / 2 }} 轮问答</span></summary>
      <div class="scene-content">
        <div class="actions">
          <label class="scene-title">场景标题<input :value="scene.title" maxlength="120" required :aria-label="`场景 ${sceneIndex + 1} 标题`" @change="renameScene(sceneIndex, $event)"></label>
          <button type="button" :disabled="sceneIndex === 0" :aria-label="`上移场景 ${scene.title}`" @click="moveScene(sceneIndex, -1)">↑</button>
          <button type="button" :disabled="sceneIndex + 1 >= scenes.length" :aria-label="`下移场景 ${scene.title}`" @click="moveScene(sceneIndex, 1)">↓</button>
          <button type="button" @click="removeScene(sceneIndex)">删除场景</button>
        </div>
        <article v-for="(index, pairIndex) in pairIndexes(scene.start, scene.end)" :key="pairIndex" class="dialog-pair">
          <div class="actions"><strong>第 {{ pairIndex + 1 }} 轮</strong><button type="button" :disabled="scene.end - scene.start <= 2" @click="removePair(sceneIndex, index)">删除此轮</button></div>
          <label>用户<textarea :value="dialogs[index]?.content" rows="3" maxlength="20000" required @input="edit(index, $event)" /></label>
          <label>助手<textarea :value="dialogs[index + 1]?.content" rows="3" maxlength="20000" required @input="edit(index + 1, $event)" /></label>
        </article>
        <div><button type="button" :disabled="!canAddPair" @click="addPair(sceneIndex)">＋ 在此场景追加一轮问答</button></div>
      </div>
    </details>
    <p v-if="!dialogs.length" class="muted">尚未设置示例对话。添加一个场景，展示人格在具体情境中的表达方式。</p>
    <p v-if="!canAddPair" class="muted" role="status">已达到 100 条消息（50 轮问答）上限，请先精简已有示例。</p>
  </section>
</template>

<style scoped>
.example-dialogs{display:grid;gap:12px}.example-dialogs h3,.example-dialogs p{margin:0}.example-dialogs h3{font-size:15px}.example-dialogs .actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.example-dialogs label{display:grid;gap:6px}.example-dialogs textarea,.example-dialogs input{width:100%;box-sizing:border-box}.example-dialogs textarea{resize:vertical}.example-dialogs .muted{font-size:12px;color:var(--text-secondary,#62776a);line-height:1.6}.scene{border:1px solid var(--border,#d8e4db);border-radius:10px;background:var(--surface,#fff);overflow:hidden}.scene summary{cursor:pointer;padding:14px;overflow-wrap:anywhere}.scene summary .muted{margin-left:12px}.scene summary:focus-visible{outline:2px solid var(--primary,#328565);outline-offset:-3px}.scene-content{display:grid;gap:12px;padding:0 14px 14px}.scene-title{flex:1;min-width:180px}.dialog-pair{display:grid;gap:10px;padding:12px;border:1px solid var(--border,#d8e4db);border-radius:8px;background:var(--background,#f5f9f6)}.dialog-pair .actions{justify-content:space-between}
</style>
