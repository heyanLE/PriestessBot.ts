<template>
  <div class="v3-stack">
    <div v-for="(value, key) in modelValue" :key="key" class="v3-kv-row">
      <input
        :value="key"
        aria-label="参数名"
        @change="rename(String(key), ($event.target as HTMLInputElement).value)"
      />
      <input
        :value="value"
        :aria-label="String(key)"
        @input="
          emit('update:modelValue', {
            ...modelValue,
            [key]: ($event.target as HTMLInputElement).value,
          })
        "
      />
      <button type="button" @click="remove(String(key))" :aria-label="`删除参数 ${key}`">
        移除
      </button>
    </div>
    <button type="button" @click="add">添加参数</button>
    <small class="muted" v-if="error" role="alert">{{ error }}</small>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
const props = defineProps<{ modelValue: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>();
const error = ref('');
function add() {
  let i = 1;
  while (`key${i}` in props.modelValue) i++;
  emit('update:modelValue', { ...props.modelValue, [`key${i}`]: '' });
}
function remove(key: string) {
  const next = { ...props.modelValue };
  delete next[key];
  emit('update:modelValue', next);
}
function rename(oldKey: string, key: string) {
  error.value = '';
  if (oldKey === key) return;
  if (!key.trim() || key in props.modelValue) {
    error.value = '参数名不能为空或重复';
    return;
  }
  const next = { ...props.modelValue, [key]: props.modelValue[oldKey] };
  delete next[oldKey];
  emit('update:modelValue', next);
}
</script>
