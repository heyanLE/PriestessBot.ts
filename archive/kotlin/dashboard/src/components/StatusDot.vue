<template>
  <span class="inline-status" :class="tone">
    <span class="status-dot"></span>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  tone: 'ok' | 'warn' | 'muted' | 'error';
}>();
</script>
