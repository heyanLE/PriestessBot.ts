<template>
  <div class="v3-page">
    <section class="v3-config-bar" :aria-label="`${title}保存栏`">
      <div class="config-revision">
        <span class="runtime-dot" :class="store.dirty ? 'dirty-dot' : 'ok'"></span>
        <strong>{{ store.dirty ? '有未保存修改' : store.document ? '所有修改已保存' : '等待加载' }}</strong>
        <details class="config-source">
          <summary>配置来源</summary>
          <div>
            <p>{{ description }}</p>
            <p>{{ store.sourcePath || '等待读取配置路径' }}</p>
            <small>修订 {{ store.revision.slice(0, 10) || '等待加载' }}</small>
          </div>
        </details>
      </div>
      <div class="toolbar">
        <button type="button" :disabled="store.busy" @click="discard">重新读取</button>
        <button
          type="button"
          :disabled="store.busy || !!store.validation.length || !store.document"
          @click="store.preview"
        >
          预览校验
        </button>
        <button type="button" class="primary" :disabled="!store.canSave" @click="store.save">
          应用修订
        </button>
      </div>
    </section>
    <p v-if="store.error" class="notice error" role="alert">{{ store.error }}</p>
    <p v-if="store.notice" class="notice ok" role="status">{{ store.notice }}</p>
    <section
      v-if="store.validation.length && store.dirty"
      class="notice error"
      aria-label="表单校验"
    >
      <strong>请先修正以下项目</strong>
      <ul>
        <li v-for="item in store.validation" :key="item">{{ item }}</li>
      </ul>
    </section>
    <section
      v-if="store.result && (store.previewed === store.content || !store.result.success || store.result.diagnostics?.length || store.result.pendingRestartPaths?.length)"
      class="notice"
      :class="store.result.success ? 'ok' : 'error'"
      role="status"
    >
      <strong>
        {{
          store.result.success
            ? store.previewed === store.content
              ? store.dirty ? '预览已通过，可以应用修订' : '当前配置校验通过'
              : '操作已完成'
            : '配置诊断'
        }}
      </strong>
      <ul v-if="store.result.diagnostics?.length">
        <li v-for="item in store.result.diagnostics" :key="item.path + item.code">
          {{ item.path }} · {{ item.message }}
        </li>
      </ul>
      <p v-if="store.result.pendingRestartPaths?.length">
        待重启：{{ store.result.pendingRestartPaths.join('、') }}
      </p>
    </section>
    <fieldset class="v3-fieldset" :disabled="store.busy">
      <slot v-if="store.document" />
      <p v-else class="notice">
        {{ store.busy ? '正在读取配置…' : '尚未读取到配置，请检查连接后重新读取。' }}
      </p>
    </fieldset>
  </div>
</template>
<script setup lang="ts">
import { onMounted } from 'vue';
import { useConfigV3Store } from '../../stores/configV3';
defineProps<{ title: string; description: string }>();
const store = useConfigV3Store();
function discard() {
  if (!store.dirty || window.confirm('放弃尚未保存的全部配置修改并重新读取？'))
    void store.load(true);
}
onMounted(() => store.load());
</script>
