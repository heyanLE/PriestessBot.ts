<template>
  <textarea
    :aria-label="label"
    :placeholder="placeholder || '每行一项'"
    rows="3"
    :value="modelValue.join('\n')"
    @input="update"
    @blur="normalize"
  />
</template>
<script setup lang="ts">
defineProps<{ modelValue: string[]; label: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
function normalize(event: Event) {
  emit(
    'update:modelValue',
    (event.target as HTMLTextAreaElement).value
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value.split('\n'));
}
</script>
