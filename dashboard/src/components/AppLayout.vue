<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="shell-sidebar" :class="{ 'is-open': mobileNavOpen }" :inert="isMobile && !mobileNavOpen" @keydown.esc="closeMobileNav">
      <div class="sidebar-frame">
        <RouterLink class="shell-brand" to="/" @click="closeMobileNav">
          <span class="shell-brand-mark">
            <img src="/assets/priestess-icon.jpg" alt="PriestessBot 图标" />
          </span>
          <span class="shell-brand-copy">
            <strong>PriestessBot</strong>
            <small>运行控制台</small>
          </span>
        </RouterLink>

        <nav class="shell-nav" aria-label="控制台导航">
          <section v-for="group in navGroups" :key="group.label" class="nav-group">
            <header class="nav-group-title">{{ group.label }}</header>

            <template v-for="item in group.items" :key="item.label">
              <RouterLink
                v-if="item.to"
                class="nav-link"
                exact-active-class="is-current"
                :to="item.to"
                @click="closeMobileNav"
              >
                <component :is="item.icon" :size="20" weight="regular" aria-hidden="true" />
                <span>{{ item.label }}</span>
              </RouterLink>

              <div v-else class="nav-cluster" :class="{ 'is-active': clusterIsActive(item) }">
                <button
                  class="nav-link nav-cluster-trigger"
                  type="button"
                  :aria-expanded="clusterIsOpen(item)"
                  @click="toggleCluster(item.label)"
                >
                  <component :is="item.icon" :size="20" weight="regular" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                  <CaretRight
                    class="nav-cluster-caret"
                    :size="16"
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
                <div v-if="clusterIsOpen(item)" class="nav-cluster-items">
                  <RouterLink
                    v-for="child in item.children"
                    :key="child.to"
                    class="nav-sub-link"
                    exact-active-class="is-current"
                    :to="child.to"
                    @click="closeMobileNav"
                  >
                    {{ child.label }}
                  </RouterLink>
                </div>
              </div>
            </template>
          </section>
        </nav>

        <div class="sidebar-runtime">
          <RouterLink to="/" class="sidebar-runtime-link" @click="closeMobileNav">
            <span class="runtime-dot" :class="{ ok: runtimeHealthy }"></span>
            <span>
              <strong>{{ runtimeLabel }}</strong>
              <small>{{ updatedAt ? `上次检查：${updatedAt}` : '等待运行时响应' }}</small>
            </span>
            <CaretRight :size="16" weight="bold" aria-hidden="true" />
          </RouterLink>
        </div>
      </div>
    </aside>

    <button
      v-if="mobileNavOpen"
      class="sidebar-scrim"
      type="button"
      aria-label="关闭导航"
      @click="closeMobileNav"
    ></button>

    <div class="shell-main">
      <header class="shell-topbar">
        <button
          class="mobile-menu-button"
          type="button"
          :aria-expanded="mobileNavOpen"
          aria-label="打开导航"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <List :size="22" weight="bold" aria-hidden="true" />
        </button>

        <div class="topbar-page-meta">
          <div class="page-breadcrumb">
            <span>{{ currentGroup }}</span>
            <CaretRight :size="13" weight="bold" aria-hidden="true" />
            <span>{{ currentLabel }}</span>
          </div>
          <h1>{{ currentLabel }}</h1>
          <p>{{ currentSummary }}</p>
        </div>

        <div class="topbar-actions">
          <div class="connection-badge" role="status" aria-label="当前服务">
            <span class="runtime-dot" :class="{ ok: runtimeHealthy }"></span>
            <span><strong>{{ localEnvironment ? '本地服务' : '远程服务' }}</strong><small>{{ serviceHost }}</small></span>
          </div>
          <button
            type="button"
            class="refresh-button"
            :aria-label="store.loading ? '刷新中' : '刷新状态'"
            :disabled="store.loading"
            @click="store.refreshAll()"
          >
            <ArrowClockwise
              :size="17"
              :class="{ spinning: store.loading }"
              weight="bold"
              aria-hidden="true"
            />
            <span>{{ store.loading ? '刷新中' : '刷新状态' }}</span>
          </button>
        </div>
      </header>

      <main id="main-content" class="workspace" :class="{ 'workspace--workflow': isConfigRoute }">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  PhArrowClockwise as ArrowClockwise,
  PhCaretRight as CaretRight,
  PhChatsCircle as ChatsCircle,
  PhCube as Cube,
  PhGauge as Gauge,
  PhList as List,
  PhPlugsConnected as PlugsConnected,
  PhRobot as Robot,
  PhScroll as Scroll,
  PhStack as Stack,
  PhWrench as Wrench,
} from '@phosphor-icons/vue';
import { useDashboardStore } from '../stores/dashboard';
import { useConfigV3Store } from '../stores/configV3';

interface NavChild {
  label: string;
  to: string;
}

interface NavItem {
  label: string;
  icon: Component;
  to?: string;
  children?: NavChild[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const route = useRoute();
const store = useDashboardStore();
const configuration = useConfigV3Store();
function protectDraft(event: BeforeUnloadEvent) { if (configuration.dirty) { event.preventDefault(); event.returnValue = ''; } }
const mobileNavOpen = ref(false);
const mobileQuery = window.matchMedia('(max-width: 760px)');
const isMobile = ref(mobileQuery.matches);
function updateViewport(event: MediaQueryListEvent) { isMobile.value = event.matches; if (!event.matches) closeMobileNav(); }
const expandedClusters = ref(new Set<string>());

const navGroups: NavGroup[] = [
  { label: '首页', items: [{ label: '概览', to: '/', icon: Gauge }] },
  { label: '配置', items: [
    { label: '系统设置', to: '/config', icon: Wrench },
    { label: 'IM 与路由', to: '/ims', icon: PlugsConnected },
    { label: 'LLM 连接', to: '/llms', icon: Stack },
    { label: 'Agent', to: '/agents', icon: Robot },
    { label: '平台资源', icon: Cube, children: [
      { label: 'Skill 库', to: '/resources/skills' },
      { label: '记忆库', to: '/resources/memories' },
      { label: 'MCP 服务', to: '/resources/mcp' },
      { label: '工具', to: '/resources/tools' },
      { label: '人格库', to: '/resources/personas' },
    ] },
  ] },
  { label: '运行管理', items: [
    { label: '会话', to: '/conversations', icon: ChatsCircle },
    { label: '日志', icon: Scroll, children: [
      { label: '系统日志', to: '/logs/system' },
      { label: 'LLM 执行链', to: '/logs/executions' },
    ] },
  ] },
];

const currentLabel = computed(() => String(route.meta.label ?? '控制台'));
const currentSummary = computed(() => String(route.meta.summary ?? '本地运行控制与状态。'));
const currentGroup = computed(() => String(route.meta.group ?? '运行时'));
const isConfigRoute = computed(() => route.name === 'config');
const runtimeHealthy = computed(() => store.health?.status === 'UP');
const runtimeLabel = computed(() => !store.health ? '等待服务响应' : runtimeHealthy.value ? '服务在线' : '服务需要检查');
const serviceHost = window.location.host;
const localEnvironment = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const updatedAt = computed(() => {
  if (!store.lastUpdated) return '';
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(
    -Math.max(1, Math.round((Date.now() - store.lastUpdated) / 60_000)),
    'minute',
  );
});

function clusterIsActive(item: NavItem) {
  return Boolean(item.children?.some((child) => route.path === child.to));
}

function clusterIsOpen(item: NavItem) {
  return expandedClusters.value.has(item.label) || clusterIsActive(item);
}

function toggleCluster(label: string) {
  const next = new Set(expandedClusters.value);
  if (next.has(label)) next.delete(label);
  else next.add(label);
  expandedClusters.value = next;
}

function closeMobileNav() {
  mobileNavOpen.value = false;
}

watch(
  () => route.path,
  () => closeMobileNav(),
);

onBeforeUnmount(() => { window.removeEventListener('beforeunload', protectDraft); mobileQuery.removeEventListener('change', updateViewport); });
onMounted(() => {
  window.addEventListener('beforeunload', protectDraft);
  mobileQuery.addEventListener('change', updateViewport);
  if (!store.lastUpdated) void store.refreshAll();
});
</script>
