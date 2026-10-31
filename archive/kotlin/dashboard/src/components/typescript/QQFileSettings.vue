<script setup lang="ts">
import { computed } from 'vue';
import { confirmDestructiveAction } from '../../composables/unsaved';
import { QqUploadTemplateSchema, type QqFileSettings } from '../../../../typescript/packages/contracts/src/plugins/qq-file';
const model = defineModel<QqFileSettings>({ required: true });
const groups = computed({ get: () => model.value.group_list.join('\n'), set: (value: string) => { model.value.group_list = value.split(/[\s,，]+/).filter(Boolean); } });
function eventValue(event: Event): string { return event.target instanceof HTMLTextAreaElement ? event.target.value : ''; }
function addTemplate(): void { model.value.uploadTemplates.push(QqUploadTemplateSchema.parse({ id: crypto.randomUUID(), filePatterns: ['*.pdf'], prompt: '阅读上传的文件并总结关键内容。' })); }
function setGroups(index: number, value: string): void { const template = model.value.uploadTemplates[index]; if (template) template.groupIds = value.split(/[\s,，]+/).filter(Boolean); }
function setPatterns(index: number, value: string): void { const template = model.value.uploadTemplates[index]; if (template) template.filePatterns = value.split('\n').map(part => part.trim()).filter(Boolean); }
function setSkills(index: number, value: string): void { const template = model.value.uploadTemplates[index]; if (template) template.skillLibraries = value.split(/[\s,，]+/).filter(Boolean); }
function removeTemplate(index: number): void { if (confirmDestructiveAction(`移除模板 ${index + 1}？保存插件配置后停止匹配该模板，保存前可撤销修改。`)) model.value.uploadTemplates.splice(index, 1); }
function move(index: number, direction: -1 | 1): void { const current = model.value.uploadTemplates[index]; const neighbor = model.value.uploadTemplates[index + direction]; if (current && neighbor) { model.value.uploadTemplates[index] = neighbor; model.value.uploadTemplates[index + direction] = current; } }
</script>
<template>
  <section class="qq-settings"><p class="hint">群访问策略和上传模板在下方保存插件配置后生效。</p>
    <label class="qq-toggle"><input v-model="model.enabled" type="checkbox" />启用 QQ 群文件与群管理工具</label>
    <p class="hint">提供群文件、群相册、成员身份、群公告与群信息。普通调用只能操作当前群；写入和删除还需要资深权限、工具挂载及配置的审批。</p>
    <div class="qq-grid">
      <label>群访问策略<select v-model="model.access_mode"><option value="all">全部群（仍受会话权限限制）</option><option value="allowlist">仅允许列表内的群</option><option value="denylist">排除列表内的群</option></select></label>
      <label>群号列表<textarea v-model="groups" rows="3" placeholder="每行一个群号" /></label>
      <label>每页结果上限<input v-model.number="model.max_file_list_limit" type="number" min="1" max="100" /></label>
      <label>搜索文件夹上限<input v-model.number="model.max_search_folders" type="number" min="1" max="200" /></label>
    </div>
    <label class="qq-toggle"><input v-model="model.upload_auto_process" type="checkbox" />按模板自动处理群文件上传</label>
    <p class="hint">按顺序使用首个匹配模板。模板仅对真实上传通知生效，保留上传者权限；Skills 只从该 Agent 已授权资源中选择。文件名使用 * 和 ? 通配符。</p>
    <article v-for="(template, index) in model.uploadTemplates" :key="template.id" class="qq-template">
      <div class="qq-template-head"><label class="qq-toggle"><input v-model="template.enabled" type="checkbox" />模板 {{ index + 1 }}</label><span><button type="button" :disabled="index === 0" @click="move(index, -1)">上移</button><button type="button" :disabled="index === model.uploadTemplates.length - 1" @click="move(index, 1)">下移</button><button type="button" @click="removeTemplate(index)">移除</button></span></div>
      <div class="qq-grid"><label>匹配群号（留空为获准群）<textarea :value="template.groupIds.join('\n')" rows="2" @input="setGroups(index, eventValue($event))" /></label><label>文件名模式（每行一个）<textarea :value="template.filePatterns.join('\n')" rows="2" @input="setPatterns(index, eventValue($event))" /></label></div>
      <label>处理指令<textarea v-model="template.prompt" rows="3" /></label>
      <label>指定已授权 Skill 库 ID<textarea :value="template.skillLibraries.join('\n')" rows="2" @input="setSkills(index, eventValue($event))" /></label>
    </article>
    <button type="button" @click="addTemplate">添加上传处理模板</button>
  </section>
</template>
<style scoped>
.qq-settings { display: grid; gap: 1rem; }.qq-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }label { display: grid; gap: .45rem; font-size: .85rem; }.qq-toggle { display: flex; align-items: center; gap: .5rem; }.qq-toggle input { width: auto; }.hint { color: var(--text-secondary, #68756c); font-size: .82rem; line-height: 1.6; margin: 0; }textarea,input,select { width: 100%; box-sizing: border-box; padding: .6rem .75rem; border: 1px solid var(--border-color, #d8e4dc); border-radius: .55rem; background: var(--bg-surface, #fff); color: inherit; font: inherit; }button { padding: .45rem .75rem; border: 1px solid #d8e4dc; border-radius: .5rem; background: #f1f7f3; color: #356a51; cursor: pointer; }button:disabled { opacity: .4; }.qq-template { display: grid; gap: .8rem; padding: 1rem; border: 1px solid #d8e4dc; border-radius: .75rem; }.qq-template-head { display: flex; justify-content: space-between; gap: .5rem; }.qq-template-head span { display: flex; gap: .3rem; }@media(max-width: 720px) { .qq-grid { grid-template-columns: 1fr; }.qq-template-head { flex-wrap: wrap; } }
</style>
