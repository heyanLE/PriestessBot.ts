<template>
  <div class="workbench-tabs" role="tablist" :aria-label="label">
    <button
      v-for="(item, index) in items"
      :id="`${idPrefix}-tab-${item.id}`"
      :key="item.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === item.id"
      :aria-controls="`${idPrefix}-panel-${item.id}`"
      :tabindex="modelValue === item.id ? 0 : -1"
      @click="emit('update:modelValue', item.id)"
      @keydown="navigate($event, index)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue';

const props = defineProps<{
  modelValue: string;
  items: ReadonlyArray<{ id: string; label: string }>;
  label: string;
  idPrefix: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

async function navigate(event: KeyboardEvent, index: number) {
  let target: number;
  switch (event.key) {
    case 'ArrowRight':
      target = (index + 1) % props.items.length;
      break;
    case 'ArrowLeft':
      target = (index - 1 + props.items.length) % props.items.length;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = props.items.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  const tablist = (event.currentTarget as HTMLButtonElement).closest('[role="tablist"]');
  emit('update:modelValue', props.items[target].id);
  await nextTick();
  tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
}
</script>
