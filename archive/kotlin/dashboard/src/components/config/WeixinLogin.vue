<template>
  <section class="v3-stack">
    <h3>微信扫码连接</h3>
    <p class="muted">保存 IM 后，扫码连接账号；凭据保存在该适配器的状态目录。</p>
    <div class="toolbar">
      <button type="button" class="primary" @click="start" :disabled="disabled || busy">
        {{ session ? '重新生成二维码' : '生成登录二维码' }}
      </button>
      <button v-if="active" type="button" @click="cancel" :disabled="busy">取消登录</button>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <div v-if="session" class="card">
      <img
        v-if="session.qrImageDataUrl && active"
        :src="session.qrImageDataUrl"
        alt="微信登录二维码"
        class="v3-qr-image"
      />
      <strong>{{ statuses[session.status] }}</strong>
      <p>{{ session.message }}</p>
      <small v-if="session.accountId">账号：{{ session.accountId }}</small>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { dashboardApi, type WeixinQrLoginDto } from '../../api/dashboard';
const props = defineProps<{ id: string; disabled?: boolean }>();
const session = ref<WeixinQrLoginDto | null>(null);
const busy = ref(false);
const error = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
const statuses = {
  WAITING: '等待扫码',
  SCANNED: '已扫码，等待确认',
  CONFIRMED: '已连接',
  EXPIRED: '二维码已过期',
  FAILED: '连接失败',
  CANCELLED: '已取消',
};
const active = computed(
  () => session.value?.status === 'WAITING' || session.value?.status === 'SCANNED',
);
function stop() {
  generation++;
  clearTimeout(timer);
}
function schedule(current: number) {
  clearTimeout(timer);
  if (active.value && current === generation)
    timer = setTimeout(() => poll(current), Math.max(500, session.value?.pollAfterMillis || 2000));
}
async function poll(current: number) {
  const previous = session.value;
  if (!previous || current !== generation) return;
  try {
    const response = await dashboardApi.weixinQrLoginStatus(
      previous.platformId,
      previous.sessionId,
    );
    if (current !== generation) return;
    session.value = response;
    error.value = '';
  } catch (cause) {
    if (current === generation) error.value = String(cause);
  } finally {
    schedule(current);
  }
}
async function start() {
  stop();
  const current = generation;
  busy.value = true;
  error.value = '';
  session.value = null;
  try {
    const response = await dashboardApi.startWeixinQrLogin(props.id);
    if (current !== generation) return;
    session.value = response;
    schedule(current);
  } catch (cause) {
    if (current === generation) error.value = String(cause);
  } finally {
    if (current === generation) busy.value = false;
  }
}
async function cancel() {
  const previous = session.value;
  if (!previous) return;
  stop();
  const current = generation;
  busy.value = true;
  error.value = '';
  try {
    const response = await dashboardApi.cancelWeixinQrLogin(
      previous.platformId,
      previous.sessionId,
    );
    if (current === generation) session.value = response;
  } catch (cause) {
    if (current === generation) error.value = String(cause);
  } finally {
    if (current === generation) busy.value = false;
  }
}
watch(
  () => props.id,
  () => {
    stop();
    session.value = null;
    busy.value = false;
    error.value = '';
  },
);
onBeforeUnmount(stop);
</script>
<style scoped>
.v3-qr-image {
  display: block;
  width: 240px;
  max-width: 100%;
  margin-bottom: 14px;
  border-radius: 8px;
}
</style>
