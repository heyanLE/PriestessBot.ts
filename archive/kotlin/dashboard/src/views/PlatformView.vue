<template>
  <div class="tactical-list-view">
    <section class="panel tactical-list-hero">
      <div class="tactical-list-hero-grid">
        <div class="tactical-list-copy">
          <div class="tactical-list-band">
            <span>资源</span>
            <span>平台</span>
          </div>

          <h2>平台列表</h2>
          <p>
            在消息进入会话管道前，集中查看接入通道、连接端点和运行操作。
          </p>

          <div class="tactical-stat-grid">
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">已配置</span>
              <strong>{{ store.platforms.length }}</strong>
              <p>运行时中登记的平台通道。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">已启用</span>
              <strong>{{ store.enabledPlatforms }}</strong>
              <p>当前允许启动的接入通道。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">运行中</span>
              <strong>{{ store.runningPlatforms }}</strong>
              <p>当前正在接收消息的平台。</p>
            </article>
            <article class="card tactical-stat-card">
              <span class="tactical-stat-label">待启动</span>
              <strong>{{ standbyCount }}</strong>
              <p>已配置但尚未启动的平台。</p>
            </article>
          </div>
        </div>

        <aside class="tactical-ledger">
          <h3>检查重点</h3>
          <p>清晰展示运行入口：先看状态，再看端点，最后执行操作。</p>

          <div class="tactical-ledger-row">
            <span>在线状态</span>
            <strong>{{ store.runningPlatforms > 0 ? `${store.runningPlatforms} 个平台在线` : '暂无在线平台' }}</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>端点概览</span>
            <strong>{{ endpointSummary }}</strong>
          </div>
          <div class="tactical-ledger-row">
            <span>操作建议</span>
            <strong>每个平台的启停操作都放在对应卡片中，方便快速定位。</strong>
          </div>
        </aside>
      </div>
    </section>

    <section class="panel tactical-table-panel">
      <div class="section-title">
        <div>
          <h2>平台清单</h2>
          <p>{{ store.enabledPlatforms }} 个已启用，{{ store.runningPlatforms }} 个运行中。</p>
        </div>
      </div>

      <EmptyState
        v-if="store.platforms.length === 0"
        class="tactical-empty"
        title="暂无平台配置"
        detail="请通过配置页面或配置文件添加平台。"
      />

      <div v-else class="tactical-card-grid">
        <article v-for="platform in store.platforms" :key="platform.name" class="card tactical-card-row">
          <div class="tactical-card-head">
            <div>
              <strong>{{ platform.name }}</strong>
              <p>{{ platform.type }} / 接入通道</p>
            </div>
            <StatusDot :label="statusLabel(platform)" :tone="statusTone(platform)" />
          </div>

          <div v-if="platform.type === 'weixin'" class="tactical-kv-list">
            <div class="tactical-kv">
              <span class="tactical-inline-code">协议</span>
              <strong>Tencent iLink</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">登录</span>
              <strong>{{ platform.running ? '已连接' : '需要扫码' }}</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">状态</span>
              <strong>{{ platform.running ? '在线' : '待启动' }}</strong>
            </div>
          </div>
          <div v-else class="tactical-kv-list">
            <div class="tactical-kv">
              <span class="tactical-inline-code">HTTP</span>
              <strong>{{ formatEndpoint(platform.host, platform.port) }}</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">WS</span>
              <strong>{{ platform.wsPort > 0 ? platform.wsPort : '已禁用' }}</strong>
            </div>
            <div class="tactical-kv">
              <span class="tactical-inline-code">状态</span>
              <strong>{{ platform.running ? '在线' : platform.enabled ? '待启动' : '已停用' }}</strong>
            </div>
          </div>

          <div class="tactical-action-row">
            <button
              v-if="platform.type === 'weixin'"
              class="btn primary"
              type="button"
              :disabled="qrBusy"
              @click="startWeixinLogin(platform)"
            >
              {{ platform.running ? '重新扫码登录' : '微信扫码连接' }}
            </button>
            <span v-else class="muted">请在配置 v2 中修改启用状态。</span>
          </div>
        </article>
      </div>
    </section>

    <section v-if="store.platforms.length > 0" class="panel tactical-table-panel">
      <div class="section-title compact">
        <div>
          <h2>端点矩阵</h2>
          <p>用于快速检查和问题交接的端点对照表。</p>
        </div>
      </div>

      <div class="table-wrap tactical-table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>端点</th>
              <th>状态</th>
              <th>配置</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="platform in store.platforms" :key="platform.name">
              <td><strong>{{ platform.name }}</strong></td>
              <td>{{ platform.type }}</td>
              <td>
                <code>{{ formatEndpoint(platform.host, platform.port) }}</code>
                <p class="muted">ws {{ platform.wsPort }}</p>
              </td>
              <td>
                <StatusDot :label="statusLabel(platform)" :tone="statusTone(platform)" />
              </td>
              <td>
                <span class="muted">版本化 v2 配置源</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="qrOpen" class="weixin-qr-backdrop" @click.self="closeQrDialog">
        <section class="panel weixin-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="weixin-qr-title">
          <div class="section-title compact">
            <div>
              <h2 id="weixin-qr-title">微信扫码登录</h2>
              <p>{{ qrLogin?.platformId }}</p>
            </div>
            <button class="btn" type="button" @click="closeQrDialog">关闭</button>
          </div>

          <div class="weixin-qr-content">
            <img
              v-if="qrLogin?.qrImageDataUrl"
              :key="qrLogin.qrRevision"
              class="weixin-qr-image"
              :src="qrLogin.qrImageDataUrl"
              alt="微信登录二维码"
            />
            <div v-else class="weixin-qr-placeholder">
              <StatusDot :label="qrStatusLabel" :tone="qrStatusTone" />
            </div>

            <StatusDot :label="qrStatusLabel" :tone="qrStatusTone" />
            <p>{{ qrLogin?.message || (qrBusy ? '正在生成二维码…' : '等待操作') }}</p>
            <p v-if="qrRemainingSeconds > 0" class="muted">本次扫码会话剩余约 {{ qrRemainingSeconds }} 秒</p>
            <p v-if="qrLogin?.accountId" class="muted">账号：{{ qrLogin.accountId }}</p>
            <p v-if="qrError" class="weixin-qr-error">{{ qrError }}</p>
          </div>

          <div class="tactical-action-row weixin-qr-actions">
            <button
              v-if="qrLogin && isQrActive(qrLogin.status)"
              class="btn"
              type="button"
              :disabled="qrBusy"
              @click="cancelQrLogin"
            >取消登录</button>
            <button
              v-if="qrLogin && !isQrActive(qrLogin.status) && qrLogin.status !== 'CONFIRMED'"
              class="btn primary"
              type="button"
              :disabled="qrBusy"
              @click="restartQrLogin"
            >重新生成</button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import StatusDot from '../components/StatusDot.vue';
import { useDashboardStore } from '../stores/dashboard';
import { dashboardApi, type PlatformStatusDto, type WeixinQrLoginDto } from '../api/dashboard';

const store = useDashboardStore();
const qrOpen = ref(false);
const qrBusy = ref(false);
const qrLogin = ref<WeixinQrLoginDto | null>(null);
const qrError = ref('');
const qrPlatform = ref<PlatformStatusDto | null>(null);
let qrPollTimer: number | null = null;

const standbyCount = computed(() => store.platforms.filter((platform) => platform.enabled && !platform.running).length);
const endpointSummary = computed(() => {
  if (store.platforms.length === 0) return '尚未加载端点';
  return `${store.platforms.length} 个平台使用 HTTP，并可选启用 WS 接入。`;
});
const qrRemainingSeconds = computed(() => {
  if (!qrLogin.value) return 0;
  return Math.max(0, Math.ceil((qrLogin.value.expiresAtEpochMillis - Date.now()) / 1000));
});
const qrStatusLabel = computed(() => {
  const labels: Record<WeixinQrLoginDto['status'], string> = {
    WAITING: '等待扫码',
    SCANNED: '已扫码，待确认',
    CONFIRMED: '登录成功',
    EXPIRED: '二维码已过期',
    FAILED: '登录失败',
    CANCELLED: '已取消',
  };
  return qrLogin.value ? labels[qrLogin.value.status] : '正在准备';
});
const qrStatusTone = computed<"ok" | "warn" | "muted" | "error">(() => {
  if (qrLogin.value?.status === 'CONFIRMED') return 'ok';
  if (qrLogin.value?.status === 'FAILED') return 'error';
  if (qrLogin.value?.status === 'WAITING' || qrLogin.value?.status === 'SCANNED') return 'warn';
  return 'muted';
});

function isQrActive(status: WeixinQrLoginDto['status']) {
  return status === 'WAITING' || status === 'SCANNED';
}

function clearQrPoll() {
  if (qrPollTimer !== null) window.clearTimeout(qrPollTimer);
  qrPollTimer = null;
}

function scheduleQrPoll() {
  clearQrPoll();
  if (!qrLogin.value || !isQrActive(qrLogin.value.status)) return;
  qrPollTimer = window.setTimeout(pollQrStatus, Math.max(500, qrLogin.value.pollAfterMillis));
}

async function pollQrStatus() {
  if (!qrLogin.value) return;
  try {
    qrLogin.value = await dashboardApi.weixinQrLoginStatus(qrLogin.value.platformId, qrLogin.value.sessionId);
    qrError.value = '';
    if (qrLogin.value.status === 'CONFIRMED') await store.refreshAll();
  } catch (cause) {
    qrError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    scheduleQrPoll();
  }
}

async function startWeixinLogin(platform: PlatformStatusDto) {
  clearQrPoll();
  qrOpen.value = true;
  qrBusy.value = true;
  qrError.value = '';
  qrLogin.value = null;
  qrPlatform.value = platform;
  try {
    qrLogin.value = await dashboardApi.startWeixinQrLogin(platform.name);
    scheduleQrPoll();
  } catch (cause) {
    qrError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    qrBusy.value = false;
  }
}

async function cancelQrLogin() {
  if (!qrLogin.value) return;
  clearQrPoll();
  qrBusy.value = true;
  try {
    qrLogin.value = await dashboardApi.cancelWeixinQrLogin(qrLogin.value.platformId, qrLogin.value.sessionId);
  } catch (cause) {
    qrError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    qrBusy.value = false;
  }
}

async function restartQrLogin() {
  if (qrPlatform.value) await startWeixinLogin(qrPlatform.value);
}

function closeQrDialog() {
  clearQrPoll();
  if (qrLogin.value && isQrActive(qrLogin.value.status)) {
    void dashboardApi.cancelWeixinQrLogin(qrLogin.value.platformId, qrLogin.value.sessionId).catch(() => undefined);
  }
  qrOpen.value = false;
}

onBeforeUnmount(closeQrDialog);

function statusLabel(platform: PlatformStatusDto) {
  if (platform.running) return '运行中';
  if (platform.enabled) return '已启用';
  return '已停止';
}

function statusTone(platform: PlatformStatusDto): 'ok' | 'warn' | 'muted' | 'error' {
  if (platform.running) return 'ok';
  if (platform.enabled) return 'warn';
  return 'muted';
}

function formatEndpoint(host: string, port: number) {
  return `${host}:${port}`;
}
</script>

<style scoped>
.weixin-qr-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(3 8 18 / 78%);
}

.weixin-qr-dialog {
  width: min(460px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
}

.weixin-qr-content {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 18px 0;
  text-align: center;
}

.weixin-qr-image,
.weixin-qr-placeholder {
  width: min(320px, 78vw);
  aspect-ratio: 1;
  border-radius: 12px;
  background: #fff;
}

.weixin-qr-image {
  display: block;
  padding: 10px;
}

.weixin-qr-placeholder {
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 5%);
  border: 1px dashed var(--border-color, #465266);
}

.weixin-qr-error {
  color: var(--danger, #ff6b78);
}

.weixin-qr-actions {
  justify-content: center;
}
</style>
