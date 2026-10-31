<template>
  <div class="tactical-list-view">
    <section class="panel tactical-list-hero">
      <div class="tactical-list-hero-grid">
        <div class="tactical-list-copy">
          <div class="tactical-list-band">
            <span>资源</span>
            <span>模型服务</span>
          </div>

          <h2>模型服务能力矩阵</h2>
          <p>
            在运行时分发请求前，统一查看模型服务覆盖范围、能力和健康状态。
          </p>

          <div class="tactical-stat-grid">
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">已注册</span>
              <strong>{{ store.providers.length }}</strong>
              <p>当前运行时中登记的模型服务。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">支持工具</span>
              <strong>{{ toolReadyCount }}</strong>
              <p>支持工具调用协议的模型服务。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">支持视觉</span>
              <strong>{{ visionReadyCount }}</strong>
              <p>能够处理图片输入的模型服务。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">在线验证</span>
              <strong>{{ onlineCount }}</strong>
              <p>{{ testedCount > 0 ? `最近已测试 ${testedCount} 个。` : '等待健康检查。' }}</p>
            </article>
          </div>
        </div>

        <aside class="tactical-ledger">
          <h3>检查重点</h3>
          <p>先根据能力覆盖比较适用性，再在运行异常时验证在线状态。</p>

          <div class="tactical-ledger-row">
            <span>健康检查</span>
            <strong>{{ testedCount > 0 ? `${onlineCount}/${testedCount} 在线` : '尚未运行' }}</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>流式覆盖</span>
            <strong>{{ streamingReadyCount }} 个模型服务支持流式响应</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>操作建议</span>
            <strong>在智能体路由分流前，确保高能力模型服务清晰可见。</strong>
          </div>
        </aside>
      </div>
    </section>

    <section class="panel tactical-table-panel">
      <div class="section-title">
        <div>
          <h2>模型服务列表</h2>
          <p>已注册 {{ store.providers.length }} 个运行时模型服务。</p>
        </div>
        <button type="button" class="primary" @click="store.testProviders()">全部测试</button>
      </div>

      <EmptyState
        v-if="store.providers.length === 0"
        class="tactical-empty"
        title="暂无模型服务"
        detail="运行时发布模型服务列表后，能力卡片会显示在这里。"
      />

      <div v-else class="tactical-card-grid">
        <article v-for="provider in store.providers" :key="provider.name" class="card tactical-card-row">
          <div class="tactical-card-head">
            <div>
              <strong>{{ provider.displayName }}</strong>
              <p>{{ provider.kind }} / <span class="tactical-inline-code">{{ provider.name }}</span></p>
            </div>
            <StatusDot :label="healthLabel(provider.name)" :tone="healthTone(provider.name)" />
          </div>

          <div class="tactical-kv-list">
            <div class="tactical-kv">
              <span class="tactical-inline-code">工具调用</span>
              <strong>{{ yesNo(provider.supportToolCalling) }}</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">视觉</span>
              <strong>{{ yesNo(provider.supportVision) }}</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">流式响应</span>
              <strong>{{ yesNo(provider.supportStreaming) }}</strong>
            </div>
          </div>

          <div class="tactical-chip-list">
            <span v-if="provider.supportToolCalling" class="chip">工具调用</span>
            <span v-if="provider.supportVision" class="chip">视觉</span>
            <span v-if="provider.supportStreaming" class="chip">流式响应</span>
            <span v-if="!provider.supportToolCalling && !provider.supportVision && !provider.supportStreaming" class="chip">仅文本</span>
          </div>
        </article>
      </div>
    </section>

    <section v-if="store.providers.length > 0" class="panel tactical-table-panel">
      <div class="section-title compact">
        <div>
          <h2>紧凑矩阵</h2>
          <p>用于快速横向比较的紧凑视图。</p>
        </div>
      </div>

      <div class="table-wrap tactical-table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>健康状态</th>
              <th>能力</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="provider in store.providers" :key="provider.name">
              <td>
                <strong>{{ provider.displayName }}</strong>
                <p class="muted">{{ provider.name }}</p>
              </td>
              <td>{{ provider.kind }}</td>
              <td>
                <StatusDot :label="healthLabel(provider.name)" :tone="healthTone(provider.name)" />
              </td>
              <td>
                <div class="chip-row">
                  <span class="chip">工具 {{ yesNo(provider.supportToolCalling) }}</span>
                  <span class="chip">视觉 {{ yesNo(provider.supportVision) }}</span>
                  <span class="chip">流式 {{ yesNo(provider.supportStreaming) }}</span>
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

const toolReadyCount = computed(() => store.providers.filter((provider) => provider.supportToolCalling).length);
const visionReadyCount = computed(() => store.providers.filter((provider) => provider.supportVision).length);
const streamingReadyCount = computed(() => store.providers.filter((provider) => provider.supportStreaming).length);
const testedCount = computed(() => Object.keys(store.providerTests).length);
const onlineCount = computed(() => Object.values(store.providerTests).filter(Boolean).length);

function healthLabel(name: string) {
  if (!(name in store.providerTests)) return '未测试';
  return store.providerTests[name] ? '在线' : '失败';
}

function healthTone(name: string): 'ok' | 'warn' | 'muted' | 'error' {
  if (!(name in store.providerTests)) return 'muted';
  return store.providerTests[name] ? 'ok' : 'error';
}

function yesNo(value: boolean) {
  return value ? '是' : '否';
}
</script>
