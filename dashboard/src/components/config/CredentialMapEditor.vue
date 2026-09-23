<template>
  <div class="v3-stack">
    <KeyValueEditor :model-value="keys" @update:model-value="update" />
    <small class="muted">左侧是凭据用途（例如 token、apiKey），右侧填写环境变量名。</small>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { CredentialRef } from '../../models/configV3';
import KeyValueEditor from './KeyValueEditor.vue';
const props = defineProps<{ modelValue: Record<string, CredentialRef> }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, CredentialRef>] }>();
const keys = computed(() =>
  Object.fromEntries(Object.entries(props.modelValue).map(([key, value]) => [key, value.key])),
);
function update(value: Record<string, string>) {
  emit(
    'update:modelValue',
    Object.fromEntries(
      Object.entries(value).map(([key, name]) => [key, { source: 'ENVIRONMENT', key: name }]),
    ),
  );
}
</script>
