<script setup lang="ts">
import { type ResourceBindings } from '../../../../packages/contracts/src/index';
const bindings=defineModel<ResourceBindings>({required:true});
type ListKey='memoryLibraries'|'knowledgeLibraries'|'tools'|'skills'|'mcpServers'|'directories';
const fields:{key:ListKey;label:string}[]=[{key:'memoryLibraries',label:'记忆库 ID'},{key:'knowledgeLibraries',label:'知识库 ID'},{key:'tools',label:'工具 ID'},{key:'skills',label:'Skill ID'},{key:'mcpServers',label:'MCP ID'},{key:'directories',label:'目录白名单'}];
function toggleAttachFile(event:Event){if(!(event.target instanceof HTMLInputElement))return;const tools=bindings.value.tools.filter(name=>name!=='attach_file');bindings.value.tools=event.target.checked?[...tools,'attach_file']:tools;}
function update(key:ListKey,event:Event){if(event.target instanceof HTMLTextAreaElement)bindings.value[key]=event.target.value.split('\n').map(value=>value.trim()).filter(Boolean);}
</script>
<template><div class="ts-form-grid"><label v-for="field in fields" :key="field.key">{{field.label}}（每行一个）<textarea :value="bindings[field.key].join('\n')" rows="2" @change="update(field.key,$event)"></textarea></label><label class="ts-check"><input type="checkbox" :checked="bindings.tools.includes('attach_file')" @change="toggleAttachFile">允许发送生成文件（attach_file）</label><label>执行环境 ID<input v-model="bindings.executionEnvironment"></label></div></template>
