<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { auditTextExcerpt } from './audit-preview-model';
const props=defineProps<{text:string;monospace?:boolean;expandedByDefault?:boolean}>();
const expanded=ref(props.expandedByDefault??false);const excerpt=computed(()=>auditTextExcerpt(props.text));
watch(()=>props.text,()=>{expanded.value=props.expandedByDefault??false;});
</script>
<template><div class="audit-text-value"><pre :class="{monospace}">{{(expanded?text:excerpt.text)||'（空文本）'}}</pre><button v-if="excerpt.shortened" type="button" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起长文本':`展开全部 ${text.length.toLocaleString('zh-CN')} 字符`}}</button></div></template>
<style scoped>.audit-text-value{display:grid;gap:8px;min-width:0}.audit-text-value pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;line-height:1.85;margin:0;max-height:480px;overflow:auto}.audit-text-value .monospace{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.audit-text-value button{justify-self:start;font-size:11px;padding:4px 9px;color:var(--accent-ink);background:var(--surface);border-color:var(--line)}</style>
