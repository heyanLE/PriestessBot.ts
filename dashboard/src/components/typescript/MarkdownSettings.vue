<script setup lang="ts">
import type { MarkdownSettings } from '../../../../packages/contracts/src/plugins/markdown';
const model = defineModel<MarkdownSettings>({ required: true });
defineProps<{ available?: boolean; unavailableReason?: string }>();
</script>
<template>
  <section class="markdown-settings"><p class="hint">输出处理设置在下方保存插件配置后，对新回复生效。</p>
    <label class="toggle"><input v-model="model.enabled" type="checkbox" />启用 Markdown 输出处理</label>
    <label class="toggle"><input v-model="model.globalCleanup" type="checkbox" />全局清理 Markdown 格式</label>
    <p>保留代码、变量、算术表达式与列表顺序；表格和公式使用本地浏览器生成图片。</p>
    <p v-if="available === false" class="notice">图片渲染暂不可用：{{ unavailableReason || '运行环境未安装 Chromium' }}。发送时使用下方回退策略。</p>
    <div class="settings-grid">
      <label>换行处理<select v-model="model.newlineMode"><option value="segment_boundary">合并分段标点后的换行</option><option value="global">压缩连续空行</option><option value="preserve">保留全部换行</option></select></label>
      <label>每条回复最多图片<input v-model.number="model.maxImages" type="number" min="1" max="12" /></label>
      <label class="toggle"><input v-model="model.tableRender" type="checkbox" />表格渲染为图片</label>
      <label>表格渲染失败时<select v-model="model.tableFallback"><option value="text">保留单元格纯文本</option><option value="raw">保留原始 Markdown</option><option value="remove">移除表格</option></select></label>
      <label class="toggle"><input v-model="model.formulaRender" type="checkbox" />公式渲染为图片</label>
      <label>公式渲染失败时<select v-model="model.formulaFallback"><option value="raw">保留原始 LaTeX</option><option value="text">保留公式正文</option><option value="remove">移除公式</option></select></label>
      <label>单张渲染字符上限<input v-model.number="model.maxRenderChars" type="number" min="100" max="100000" /></label>
      <label>渲染超时（毫秒）<input v-model.number="model.timeoutMs" type="number" min="1000" max="60000" /></label>
    </div>
  </section>
</template>
<style scoped>
.markdown-settings { display: grid; gap: 1rem; }.settings-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1rem; }label { display: grid; gap: .5rem; font-size: .85rem; }.toggle { display: flex; gap: .5rem; align-items: center; }.toggle input { width: auto; }p { margin: 0; font-size: .84rem; line-height: 1.6; color: #68756c; }.notice { border-left: 3px solid #bba766; padding-left: .7rem; }input, select { width: 100%; box-sizing: border-box; padding: .6rem .75rem; border: 1px solid #d8e4dc; border-radius: .55rem; background: #fff; color: inherit; font: inherit; }@media(max-width:720px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
