<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ label: string; options: { id: string; label: string; detail?: string }[]; emptyText?: string }>();
const selected = defineModel<string[]>({ required: true });
const missing = computed(() => selected.value.filter(id => !props.options.some(option => option.id === id)));
function remove(id: string) { selected.value = selected.value.filter(value => value !== id); }
</script>
<template>
  <fieldset class="ts-binding-picker">
    <legend>{{ label }}</legend>
    <p v-if="!options.length" class="muted">{{ emptyText || '尚未配置可选资源，请先在对应的资源页面添加。' }}</p>
    <label v-for="option in options" :key="option.id" class="ts-check"><input v-model="selected" type="checkbox" :value="option.id"><span><strong>{{ option.label }}</strong><small v-if="option.detail">{{ option.detail }}</small></span></label>
    <div v-for="id in missing" :key="id" class="ts-binding-missing"><span>{{ id }} <small>未登记的绑定</small></span><button type="button" @click="remove(id)">移除</button></div>
  </fieldset>
</template>
<style scoped>
.ts-binding-picker{display:grid;gap:12px;margin:0;padding:16px;border:1px solid var(--line);border-radius:8px;min-width:0;align-content:start}.ts-binding-picker legend{padding:0 6px;font-weight:600;font-size:13px}.ts-binding-picker label{align-items:flex-start}.ts-binding-picker strong{font-size:13px;font-weight:500}.ts-binding-picker small{display:block;font-size:11px;color:var(--muted);overflow-wrap:anywhere;margin-top:3px}.ts-binding-missing{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;overflow-wrap:anywhere}.ts-binding-missing button{flex-shrink:0;padding:4px 8px}.ts-binding-picker p{font-size:12px;margin:0}
</style>
