<script setup lang="ts">
import { computed, ref } from 'vue';
defineOptions({ name: 'SchemaFields' });
const props = defineProps<{ modelValue: any; schema: any; root: any; label?: string; depth?: number }>();
const emit = defineEmits<{ 'update:modelValue': [value: any] }>();
function resolve(s: any): any { if (s?.$ref) return resolve(s.$ref.replace(/^#\//, '').split('/').reduce((o: any, k: string) => o?.[k], props.root)); return s || {}; }
const base = computed(() => resolve(props.schema));
const choices = computed<any[]>(() => (base.value.oneOf || base.value.anyOf || []).map(resolve));
function matches(s: any) { if (s.type === 'null') return props.modelValue === null; if (s.type === 'array') return Array.isArray(props.modelValue); if (s.properties) return Object.entries(s.properties).every(([key, raw]) => { const field = resolve(raw); return field.const === undefined || props.modelValue?.[key] === field.const; }); return s.type === typeof props.modelValue; }
const choice = computed(() => Math.max(0, choices.value.findIndex(matches)));
const actual = computed(() => choices.value.length ? choices.value[choice.value] : base.value);
function initial(raw: any): any { const s = resolve(raw); if (s.default !== undefined) return JSON.parse(JSON.stringify(s.default)); if (s.const !== undefined) return s.const; if (s.enum) return s.enum[0]; if (s.anyOf || s.oneOf) return initial((s.anyOf || s.oneOf)[0]); if (s.type === 'array') return []; if (s.type === 'object' || s.properties) return Object.fromEntries(Object.entries(s.properties || {}).filter(([key, value]) => (s.required || []).includes(key) || (value as any).default !== undefined).map(([key, value]) => [key, initial(value)])); if (s.type === 'boolean') return false; if (s.type === 'integer' || s.type === 'number') return s.minimum || 0; if (s.type === 'null') return null; return ''; }
function setField(key: string, value: any) { emit('update:modelValue', { ...(props.modelValue || initial(actual.value)), [key]: value }); }
function setItem(index: number, value: any) { const items = [...(props.modelValue || [])]; items[index] = value; emit('update:modelValue', items); }
const error = ref('');
function raw(value: string) { try { emit('update:modelValue', JSON.parse(value)); error.value = ''; } catch { error.value = '请输入有效 JSON'; } }
const entries = computed(() => Object.entries(actual.value.properties || {}).filter(([key]) => key !== 'schema_version'));
</script>
<template>
  <div class="schema-field">
    <label v-if="label" class="field-label">{{ label }}<small v-if="actual.description">{{ actual.description }}</small></label>
    <select v-if="choices.length" :value="choice" :aria-label="`${label || '字段'}类型`" @change="emit('update:modelValue', initial(choices[Number(($event.target as HTMLSelectElement).value)]))"><option v-for="(s, i) in choices" :key="i" :value="i">{{ s.title || s.properties?.type?.const || s.properties?.kind?.const || s.properties?.field?.const || s.type || `类型 ${i + 1}` }}</option></select>
    <span v-if="actual.const !== undefined">{{ actual.const }}</span>
    <select v-else-if="actual.enum" :value="modelValue" :aria-label="label" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><option v-for="value in actual.enum" :key="String(value)" :value="value">{{ value }}</option></select>
    <div v-else-if="actual.type === 'array'" class="array"><details v-for="(value, i) in (modelValue || [])" :key="i"><summary>{{ value?.id || value?.definition?.id || `条目 ${i + 1}` }}</summary><SchemaFields :model-value="value" :schema="actual.items" :root="root" :depth="(depth || 0) + 1" @update:model-value="setItem(i, $event)" /><button class="remove" @click="emit('update:modelValue', modelValue.filter((_: any, j: number) => j !== i))">移除此条目</button></details><button @click="emit('update:modelValue', [...(modelValue || []), initial(actual.items)])">＋ 添加条目</button></div>
    <div v-else-if="entries.length" class="object"><SchemaFields v-for="([key, schema]) in entries" :key="key" :label="key" :schema="schema" :root="root" :model-value="modelValue?.[key]" :depth="(depth || 0) + 1" @update:model-value="setField(key, $event)" /></div>
    <input v-else-if="actual.type === 'boolean'" type="checkbox" :aria-label="label" :checked="modelValue" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)">
    <input v-else-if="['number', 'integer'].includes(actual.type)" type="number" :aria-label="label" :value="modelValue" :min="actual.minimum" :max="actual.maximum" @change="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))">
    <span v-else-if="actual.type === 'null'">未设置</span>
    <textarea v-else-if="actual.type === 'string' && ['instructions', 'text', 'description'].some(v => label?.includes(v))" :aria-label="label" rows="5" :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <input v-else-if="actual.type === 'string'" :aria-label="label" :value="modelValue" @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
    <textarea v-else :aria-label="label" :value="JSON.stringify(modelValue ?? {}, null, 2)" rows="5" @change="raw(($event.target as HTMLTextAreaElement).value)" /><small role="alert">{{ error }}</small>
  </div>
</template>
<style scoped>
.schema-field{margin:10px 0;min-width:0}.field-label{display:block;font-weight:600;font-size:13px;margin-bottom:5px}.field-label small{display:block;font-weight:400}.object{border-left:2px solid #cbd5e1;padding-left:14px}.array details{border:1px solid #cbd5e1;padding:10px;margin:8px 0;border-radius:6px}summary{cursor:pointer}input:not([type=checkbox]),select,textarea{box-sizing:border-box;max-width:100%;width:100%;padding:8px;border:1px solid #94a3b8;border-radius:5px;background:#fff;color:#0f172a;font:inherit}textarea{font-family:monospace}button{padding:6px 12px;border:1px solid #94a3b8;border-radius:5px;background:#fff;cursor:pointer}.remove{color:#b91c1c}small[role=alert]{color:#b91c1c}
</style>
