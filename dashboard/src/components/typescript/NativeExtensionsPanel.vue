<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useUnsavedDraft, confirmDestructiveAction } from '../../composables/unsaved';
import { onMounted, ref } from 'vue';
import { ExtensionManifestSchema, ExtensionValuesSchema, ExtensionsResponseSchema, type ExtensionRecord } from '../../../../packages/contracts/src/extensions';
import { runtimeRequest, runtimeAction } from '../../api/typescript';
const records = ref<ExtensionRecord[]>([]), error = ref(''), busy = ref(false), modulePath = ref(''), acknowledged = ref(false);
const initialManifest = JSON.stringify({ id: 'my_extension', name: '我的扩展', version: '1.0.0', description: '', configuration: {}, tools: [], commands: [] }, null, 2);
const manifest = ref(initialManifest);
const configuration = ref('{}');
const editing = ref<string>(), settings = ref('{}'), editingRevision = ref(0), notice = ref('');
const installDraft = useUnsavedDraft('本地扩展安装表单', () => ({ modulePath: modulePath.value, manifest: manifest.value, configuration: configuration.value, acknowledged: acknowledged.value }));
const settingsDraft = useUnsavedDraft('原生扩展配置', () => settings.value);
async function refresh(){ records.value=(await runtimeRequest('extensions',ExtensionsResponseSchema)).extensions; if(editing.value&&!settingsDraft.dirty.value){const record=records.value.find(item=>item.manifest.id===editing.value);if(record){editingRevision.value=record.revision;settings.value=JSON.stringify(record.configuration,null,2);settingsDraft.markSaved();}} }
async function action(work:()=>Promise<void>, refreshAfter=true){busy.value=true;error.value='';notice.value='';try{await work();if(refreshAfter)await refresh();}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}finally{busy.value=false;}}
function install(){void action(async()=>{const raw:unknown=JSON.parse(manifest.value);const config:unknown=JSON.parse(configuration.value);await runtimeAction('extensions',{modulePath:modulePath.value,manifest:ExtensionManifestSchema.parse(raw),configuration:ExtensionValuesSchema.parse(config),trustedHostAcknowledged:acknowledged.value});modulePath.value='';manifest.value=initialManifest;configuration.value='{}';acknowledged.value=false;installDraft.markSaved();notice.value='扩展已安装，默认停用。核对配置后启用，再到 Agent 授权工具与能力。';});}
function toggle(record:ExtensionRecord){if(record.enabled&&!confirmDestructiveAction(`停用“${record.manifest.name}”？将阻止新的调用，并通知正在运行的调用取消。`))return;void action(async()=>{await runtimeAction(`extensions/${encodeURIComponent(record.manifest.id)}`,{enabled:!record.enabled,expectedRevision:record.revision},'PUT');notice.value=record.enabled?'扩展已停用。':'扩展已启用；请确认 Agent 已获得对应工具与能力授权。';});}
function edit(record:ExtensionRecord){if(!settingsDraft.confirmDiscard())return;editing.value=record.manifest.id;editingRevision.value=record.revision;settings.value=JSON.stringify(record.configuration,null,2);settingsDraft.markSaved();}
function cancelEdit(){if(!settingsDraft.confirmDiscard())return;editing.value=undefined;settings.value='{}';settingsDraft.markSaved();}
async function reloadSettings():Promise<void>{
  const id=editing.value;
  if(busy.value||!id||!settingsDraft.confirmDiscard())return;
  await action(async()=>{
    const data=await runtimeRequest('extensions',ExtensionsResponseSchema);
    if(editing.value!==id)return;
    const record=data.extensions.find(item=>item.manifest.id===id);
    if(!record)throw new Error('服务端已不存在此扩展，当前编辑内容已保留。');
    records.value=data.extensions;editingRevision.value=record.revision;settings.value=JSON.stringify(record.configuration,null,2);settingsDraft.markSaved();
    notice.value='已重新载入扩展配置的服务端版本，可以继续编辑。';
  },false);
}
function save(record:ExtensionRecord){void action(async()=>{const raw:unknown=JSON.parse(settings.value);await runtimeAction(`extensions/${encodeURIComponent(record.manifest.id)}`,{enabled:record.enabled,expectedRevision:editingRevision.value,configuration:ExtensionValuesSchema.parse(raw)},'PUT');editing.value=undefined;settings.value='{}';settingsDraft.markSaved();notice.value='扩展配置已保存并重新加载。';});}
onMounted(()=>{void action(async()=>{});});
</script>
<template><section class="ts-fields"><div class="section-title"><div><h2>原生扩展</h2><p>本地 TypeScript 扩展编译为 JavaScript 后安装。扩展配置独立保存，启停立即生效。工具和指令还须到 <RouterLink to="/agents">Agent</RouterLink> 授权。</p></div><button :disabled="busy" @click="action(async()=>{})">刷新</button></div>
<p v-if="error" class="notice error" role="alert">{{error}}</p><p v-if="notice" role="status" class="notice ok">{{notice}}</p>
<article v-for="record in records" :key="record.manifest.id" class="extension-card"><div class="section-title"><div><h3>{{record.manifest.name}} <small>{{record.manifest.version}}</small></h3><p>{{record.manifest.description}}</p></div><button :disabled="busy || (editing===record.manifest.id && settingsDraft.dirty.value)" @click="toggle(record)">{{record.enabled?'停用':'启用'}}</button></div><p>状态：{{record.status}} · {{record.modulePath}}</p><p v-if="record.diagnostic" class="notice error">{{record.diagnostic}}</p><p>工具：{{record.manifest.tools.map(item=>item.name).join('、')||'无'}} · 指令：{{record.manifest.commands.map(item=>'/'+item.name+' {JSON 参数}').join('、')||'无'}}</p><button :disabled="busy" @click="edit(record)">编辑配置</button><div v-if="editing===record.manifest.id"><label>扩展配置 JSON<textarea v-model="settings" :disabled="busy" rows="6" /></label><p role="status">{{settingsDraft.dirty.value?'配置尚未保存，保存或取消编辑后可切换启用状态':'配置已保存'}}</p><button :disabled="busy || !settingsDraft.dirty.value" @click="save(record)">保存并重新加载</button><button :disabled="busy" @click="reloadSettings">重新载入此配置</button><button :disabled="busy" @click="cancelEdit">取消编辑</button></div></article>
<p v-if="!records.length" class="empty-state">尚未安装原生扩展。展开下方“安装本地扩展”，填写服务器模块路径和清单。</p><details><summary>安装本地扩展</summary><p v-if="installDraft.dirty.value" role="status">安装表单尚未提交。</p><p class="notice">原生扩展拥有宿主机进程权限，不在沙箱内运行。只安装已审查的本地模块；停用会阻止新调用并通知正在运行的调用取消。</p><label>服务器绝对路径（.mjs / .js）<input v-model="modulePath" :disabled="busy" placeholder="/path/to/my-extension.mjs" /></label><label>扩展清单 JSON<textarea v-model="manifest" :disabled="busy" rows="10" /></label><label>初始配置 JSON<textarea v-model="configuration" :disabled="busy" rows="4" /></label><label class="ack"><input v-model="acknowledged" :disabled="busy" type="checkbox" />我信任该模块在宿主机执行</label><button :disabled="busy||!acknowledged||!modulePath" @click="install">安装（默认停用）</button></details>
</section></template>
<style scoped>.extension-card{padding:18px;border:1px solid var(--border-color,#d3e6dc);border-radius:14px;margin:12px 0;background:var(--surface,#fff)}label{display:grid;gap:6px;margin:12px 0}textarea{width:100%;font-family:monospace}.ack{display:flex;align-items:center}.ack input{width:auto}p{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}</style>
