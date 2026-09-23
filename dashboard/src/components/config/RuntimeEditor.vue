<template>
  <div class="v3-stack">
    <section class="panel">
      <h2>服务与存储</h2>
      <div class="v3-form-grid">
        <label>
          平台资源目录
          <input v-model.trim="document.platformDirectory" required />
        </label>
        <label>
          数据库文件
          <input v-model.trim="runtime.database.path" required />
        </label>
        <label class="v3-check">
          <input v-model="runtime.server.enabled" type="checkbox" />
          启用 HTTP 服务
        </label>
        <label class="v3-check">
          <input v-model="runtime.server.corsEnabled" type="checkbox" />
          启用跨域
        </label>
        <label>
          监听地址
          <input v-model.trim="runtime.server.host" required />
        </label>
        <label>
          监听端口
          <input v-model.number="runtime.server.port" type="number" min="1" max="65535" />
        </label>
        <label>
          API 凭据环境变量
          <input
            :value="runtime.server.apiCredentialRef?.key || ''"
            @input="setApiCredential(($event.target as HTMLInputElement).value)"
            placeholder="留空表示未配置"
          />
        </label>
      </div>
    </section>
    <section class="panel">
      <h2>消息处理</h2>
      <p class="muted">干员权限、命令前缀和唤醒规则在各 IM 的路由表中设置。</p>
      <div class="v3-form-grid">
        <label class="v3-check">
          <input v-model="runtime.pipeline.rateLimitEnabled" type="checkbox" />
          启用消息限流
        </label>
        <label>
          每分钟消息上限
          <input v-model.number="runtime.pipeline.rateLimitPerMinute" type="number" min="1" />
        </label>
        <label>
          历史消息上限
          <input v-model.number="runtime.pipeline.maxHistoryMessages" type="number" min="1" />
        </label>
        <label class="v3-check">
          <input v-model="runtime.pipeline.whitelistEnabled" type="checkbox" />
          启用白名单
        </label>
        <label>
          用户白名单
          <StringList v-model="runtime.pipeline.whitelistUsers" label="用户白名单" />
        </label>
        <label>
          群组白名单
          <StringList v-model="runtime.pipeline.whitelistGroups" label="群组白名单" />
        </label>
      </div>
    </section>
    <section class="panel">
      <h2>配置热重载</h2>
      <div class="v3-form-grid">
        <label class="v3-check">
          <input v-model="runtime.reload.enabled" type="checkbox" />
          自动重载
        </label>
        <label>
          检查间隔（毫秒）
          <input v-model.number="runtime.reload.intervalMillis" type="number" min="1" />
        </label>
        <label>
          文件稳定窗口（毫秒）
          <input v-model.number="runtime.reload.stabilityWindowMillis" type="number" min="0" />
        </label>
      </div>
      <button type="button" @click="store.reload" :disabled="store.dirty || store.busy">
        从磁盘重新加载配置
      </button>
    </section>
    <details class="panel">
      <summary>现有插件运行设置</summary>
      <div class="v3-form-grid">
        <label class="v3-check">
          <input v-model="runtime.plugins.enabled" type="checkbox" />
          启用插件
        </label>
        <label class="v3-check">
          <input v-model="runtime.plugins.autoDiscover" type="checkbox" />
          自动发现插件
        </label>
        <label>
          插件目录
          <input v-model="runtime.plugins.directory" />
        </label>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ApplicationConfig } from '../../models/configV3';
import { useConfigV3Store } from '../../stores/configV3';
import StringList from './StringList.vue';
const props = defineProps<{ document: ApplicationConfig }>();
const runtime = computed(() => props.document.runtime);
const store = useConfigV3Store();
function setApiCredential(value: string) {
  runtime.value.server.apiCredentialRef = value.trim()
    ? { source: 'ENVIRONMENT', key: value.trim() }
    : null;
}
</script>
