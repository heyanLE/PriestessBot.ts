<template>
  <div class="empty-state">
    <strong>{{ title }}</strong>
    <span>{{ detail }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  detail: string;
}>();
</script>
