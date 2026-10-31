<template>
  <main v-if="route.path === '/rust'" class="rust-shell"><RouterView /></main>
  <RouterView v-else-if="route.meta.typescriptRuntime === true" />
  <AppLayout v-else />
</template>

<script setup lang="ts">
import { useRoute, RouterView } from 'vue-router';
const route = useRoute();
import AppLayout from './components/AppLayout.vue';
</script>

<style scoped>
.rust-shell{min-height:100vh;padding:28px;background:#f8fafc;box-sizing:border-box}@media(max-width:800px){.rust-shell{padding:12px}}
</style>
