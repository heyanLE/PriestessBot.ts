<template>
  <div class="tactical-list-view">
    <section class="panel tactical-list-hero">
      <div class="tactical-list-hero-grid">
        <div class="tactical-list-copy">
          <div class="tactical-list-band">
            <span>资源</span>
            <span>插件</span>
          </div>

          <h2>插件列表</h2>
          <p>
            在可选能力进入运行时前，集中查看插件生命周期、失败状态和扩展分布。
          </p>

          <div class="tactical-stat-grid">
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">已发现</span>
              <strong>{{ store.plugins.plugins.length }}</strong>
              <p>当前插件目录中发现的插件包。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">已启用</span>
              <strong>{{ enabledCount }}</strong>
              <p>已接入控制台和运行时的插件。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">失败</span>
              <strong>{{ failedCount }}</strong>
              <p>当前需要检查的插件包。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">扩展</span>
              <strong>{{ store.plugins.extensions.length }}</strong>
              <p>已发现插件提供的扩展能力。</p>
            </article>
          </div>
        </div>

        <aside class="tactical-ledger">
          <h3>检查重点</h3>
          <p>插件发现与启用相互独立，便于控制可选能力。</p>

          <div class="tactical-ledger-row">
            <span>发现状态</span>
            <strong>{{ store.plugins.plugins.length > 0 ? '插件列表已加载' : '等待发现扫描' }}</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>扩展分布</span>
            <strong>{{ extensionSummary }}</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>操作建议</span>
            <strong>失败插件应作为明显告警展示，避免隐藏在普通表格中。</strong>
          </div>
        </aside>
      </div>
    </section>

    <section class="panel tactical-table-panel">
      <div class="section-title">
        <div>
          <h2>插件清单</h2>
          <p>已发现 {{ store.plugins.plugins.length }} 个插件、{{ store.plugins.extensions.length }} 个扩展。</p>
        </div>
        <button type="button" class="primary" @click="store.discoverPlugins()">重新发现</button>
      </div>

      <EmptyState
        v-if="store.plugins.plugins.length === 0"
        class="tactical-empty"
        title="未发现插件"
        detail="将插件清单放入已配置目录，然后运行发现扫描。"
      />

      <div v-else class="tactical-card-grid">
        <article v-for="plugin in store.plugins.plugins" :key="plugin.manifest.id" class="card tactical-card-row">
          <div class="tactical-card-head">
            <div>
              <strong>{{ plugin.manifest.name }}</strong>
              <p>{{ plugin.manifest.id }} / v{{ plugin.manifest.version }}</p>
            </div>
            <StatusDot :label="pluginStateLabel(plugin.state)" :tone="pluginTone(plugin.state)" />
          </div>

          <div class="tactical-chip-list">
            <span v-for="capability in plugin.manifest.capabilities" :key="capability" class="chip">{{ capability }}</span>
            <span v-if="plugin.manifest.capabilities.length === 0" class="chip">未声明能力</span>
          </div>

          <p>{{ plugin.manifest.description || '未提供描述。' }}</p>

          <p v-if="plugin.error" class="notice error plugin-error">{{ plugin.error }}</p>

          <div class="tactical-action-row">
            <button type="button" @click="store.setPluginState(plugin.manifest.id, 'load')">加载</button>
            <button type="button" class="primary" @click="store.setPluginState(plugin.manifest.id, 'enable')">启用</button>
            <button type="button" @click="store.setPluginState(plugin.manifest.id, 'disable')">禁用</button>
            <button type="button" @click="store.setPluginState(plugin.manifest.id, 'unload')">卸载</button>
          </div>
        </article>
      </div>
    </section>

    <section v-if="store.plugins.plugins.length > 0" class="panel tactical-table-panel">
      <div class="section-title compact">
        <div>
          <h2>紧凑表格</h2>
          <p>用于快速检查插件生命周期的紧凑视图。</p>
        </div>
      </div>

      <div class="table-wrap tactical-table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>插件</th>
              <th>版本</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plugin in store.plugins.plugins" :key="plugin.manifest.id">
              <td>
                <strong>{{ plugin.manifest.name }}</strong>
                <p class="muted">{{ plugin.manifest.id }}</p>
                <p v-if="plugin.error" class="notice error plugin-error">{{ plugin.error }}</p>
              </td>
              <td>{{ plugin.manifest.version }}</td>
              <td>
                <StatusDot :label="pluginStateLabel(plugin.state)" :tone="pluginTone(plugin.state)" />
              </td>
              <td>
                <div class="toolbar">
                  <button type="button" @click="store.setPluginState(plugin.manifest.id, 'load')">加载</button>
                  <button type="button" class="primary" @click="store.setPluginState(plugin.manifest.id, 'enable')">启用</button>
                  <button type="button" @click="store.setPluginState(plugin.manifest.id, 'disable')">禁用</button>
                  <button type="button" @click="store.setPluginState(plugin.manifest.id, 'unload')">卸载</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import StatusDot from '../components/StatusDot.vue';
import { useDashboardStore } from '../stores/dashboard';

const store = useDashboardStore();

const enabledCount = computed(() => store.plugins.plugins.filter((plugin) => plugin.state === 'ENABLED').length);
const failedCount = computed(() => store.plugins.plugins.filter((plugin) => plugin.state === 'FAILED').length);
const extensionSummary = computed(() => {
  if (store.plugins.extensions.length === 0) return '尚未注册扩展能力';
  return `当前已开放 ${store.plugins.extensions.length} 个扩展能力。`;
});

function pluginTone(state: string): 'ok' | 'warn' | 'muted' | 'error' {
  if (state === 'ENABLED') return 'ok';
  if (state === 'FAILED') return 'error';
  if (state === 'LOADED') return 'warn';
  return 'muted';
}

function pluginStateLabel(state: string) {
  const labels: Record<string, string> = {
    DISCOVERED: '已发现',
    LOADED: '已加载',
    ENABLED: '已启用',
    DISABLED: '已禁用',
    FAILED: '失败',
    UNLOADED: '已卸载',
  };
  return labels[state] ?? state;
}
</script>

<style scoped>
.plugin-error {
  margin-bottom: 0;
}
</style>
