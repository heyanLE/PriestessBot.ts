<template>
  <div class="im-editor">
    <header class="editor-title im-object-header">
      <div>
        <h2>{{ im.name || '未命名 IM' }}</h2>
        <p>{{ adapterName }} 连接 {{ im.id || '尚未命名' }}</p>
      </div>
      <label class="v3-check object-enabled">
        <input v-model="im.enabled" type="checkbox" />
        启用连接
      </label>
    </header>
    <dl class="editor-summary im-object-summary">
      <div>
        <dt>消息入口</dt>
        <dd>{{ adapterName }}</dd>
      </div>
      <div>
        <dt>路由规则</dt>
        <dd>{{ enabledRouteCount }} 条启用，共 {{ im.routes.length }} 条</dd>
      </div>
      <div>
        <dt>身份配置</dt>
        <dd>{{ im.permission.adminIds.length + im.permission.superAdminIds.length }} 位指定干员</dd>
      </div>
    </dl>
    <EditorSectionTabs
      v-model="activeTab"
      :items="tabs"
      label="IM 配置分区"
      :id-prefix="editorId"
    />
    <div
      v-show="activeTab === 'connection'"
      :id="`${editorId}-panel-connection`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-connection`"
      tabindex="0"
      class="im-editor-panel"
    >
      <section class="editor-section">
        <h3>连接身份</h3>
        <div class="v3-form-grid">
          <label>
            ID
            <input v-model.trim="im.id" :readonly="persisted" required />
          </label>
          <label>
            名称
            <input v-model.trim="im.name" required />
          </label>
          <label>
            适配器
            <select v-model="im.type">
              <option value="napcat4_18_6">NapCat</option>
              <option value="telegram">Telegram</option>
              <option value="weixin">微信</option>
            </select>
          </label>
        </div>
        <h3>连接参数</h3>
        <div v-if="im.type === 'napcat4_18_6'" class="v3-form-grid">
          <label>
            NapCat 地址
            <input v-model.trim="im.settings.host" placeholder="127.0.0.1" />
          </label>
          <label>
            HTTP 端口
            <input
              :value="im.settings.port"
              @input="im.settings.port = ($event.target as HTMLInputElement).value"
              type="number"
              min="1"
              max="65535"
              placeholder="3000"
            />
          </label>
          <label>
            WebSocket 端口
            <input
              :value="im.settings.wsPort"
              @input="im.settings.wsPort = ($event.target as HTMLInputElement).value"
              type="number"
              min="1"
              max="65535"
              placeholder="3001"
            />
          </label>
        </div>
        <div v-if="im.type === 'weixin'" class="v3-form-grid">
          <label>
            账号 ID
            <input v-model.trim="im.settings.accountId" placeholder="扫码后自动获取" />
          </label>
          <label>
            状态目录
            <input
              v-model.trim="im.settings.stateDirectory"
              placeholder=".priestess/weixin/IM-ID"
            />
          </label>
          <label class="v3-span-all">
            API 地址
            <input v-model.trim="im.settings.baseUrl" type="url" placeholder="留空使用默认服务" />
          </label>
        </div>
        <div v-if="im.type === 'telegram'" class="v3-form-grid">
          <label class="v3-span-all">
            HTTP 代理地址（可选）
            <input v-model.trim="im.settings.proxyUrl" type="url" placeholder="http://127.0.0.1:7890" />
            <small>无法直连 Telegram 时填写本机 HTTP 代理；留空使用直连。</small>
          </label>
        </div>
        <p v-if="im.type === 'telegram'" class="muted">
          Telegram 使用 Bot Token 连接。下方凭据名填写 token，值填写保存 Bot Token 的环境变量名。
        </p>
        <details>
          <summary>其他适配器参数</summary>
          <KeyValueEditor :model-value="extraSettings" @update:model-value="setExtraSettings" />
        </details>
        <h3>凭据环境变量</h3>
        <CredentialMapEditor v-model="im.credentialRefs" />
        <WeixinLogin v-if="im.type === 'weixin'" :id="im.id" :disabled="!persisted || dirty" />
      </section>
    </div>
    <div
      v-show="activeTab === 'routes'"
      :id="`${editorId}-panel-routes`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-routes`"
      tabindex="0"
      class="im-editor-panel"
    >
      <section class="editor-section">
        <div class="editor-section-heading">
          <div>
            <h3>顺序路由表</h3>
            <p>从上到下选择第一条匹配规则。命令规则通常放在对话规则前。</p>
          </div>
          <button type="button" @click="addRoute">添加路由</button>
        </div>
        <p v-if="!im.routes.length" class="notice">没有路由，此 IM 不会触发 Agent 或命令。</p>
        <div v-else class="route-order-note">
          <span>首条命中后停止匹配</span>
          <span>{{ im.routes.length }} 条规则</span>
        </div>
        <ol class="route-sequence" aria-label="按匹配优先级排列的路由">
          <li
            v-for="(route, index) in im.routes"
            :key="routeKey(route)"
            class="route-row"
            :class="{ 'is-disabled': !route.enabled, 'is-expanded': isExpanded(route) }"
          >
            <div class="route-row-heading">
              <span class="route-ordinal" aria-hidden="true">
                {{ String(index + 1).padStart(2, '0') }}
              </span>
              <button
                type="button"
                class="route-summary"
                :aria-expanded="isExpanded(route)"
                :aria-controls="`${routeKey(route)}-form`"
                @click="toggleRoute(route)"
              >
                <span class="route-summary-title">
                  <strong>{{ route.name || '新路由' }}</strong>
                  <span class="route-disclosure" aria-hidden="true">
                    {{ isExpanded(route) ? '−' : '+' }}
                  </span>
                </span>
                <span class="route-summary-match">
                  {{ sessionSummary(route) }} / {{ attentionSummary(route) }}
                </span>
                <span class="route-summary-target">
                  <span :title="textSummary(route)">{{ textSummary(route) }}</span>
                  <span>{{ targetSummary(route) }}</span>
                </span>
              </button>
              <div class="route-actions">
                <label class="v3-check">
                  <input v-model="route.enabled" type="checkbox" />
                  启用
                </label>
                <div class="route-order-actions">
                  <button
                    type="button"
                    :disabled="index === 0"
                    @click="moveItem(im.routes, index, -1)"
                    :aria-label="`上移第 ${index + 1} 条路由`"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    :disabled="index === im.routes.length - 1"
                    @click="moveItem(im.routes, index, 1)"
                    :aria-label="`下移第 ${index + 1} 条路由`"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    @click="removeRoute(route, index)"
                    :aria-label="`删除第 ${index + 1} 条路由`"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
            <div v-show="isExpanded(route)" :id="`${routeKey(route)}-form`" class="route-form">
              <div class="v3-form-grid">
                <label>
                  路由 ID
                  <input v-model.trim="route.id" required />
                </label>
                <label>
                  规则名称
                  <input v-model.trim="route.name" required />
                </label>
              </div>
              <div class="v3-checks">
                <label v-for="session in sessions" :key="session.value">
                  <input
                    v-model="route.match.sessionTypes"
                    type="checkbox"
                    :value="session.value"
                  />
                  {{ session.label }}
                </label>
              </div>
              <div class="v3-form-grid">
                <label>
                  关注条件
                  <select v-model="route.match.attention">
                    <option value="ANY">不限</option>
                    <option value="MENTION">包含艾特</option>
                    <option value="REPLY">包含引用回复</option>
                    <option value="MENTION_OR_REPLY">艾特或引用回复</option>
                    <option value="NONE">无艾特或引用</option>
                  </select>
                </label>
                <label>
                  关注对象
                  <select v-model="route.match.attentionTarget">
                    <option value="BOT">机器人</option>
                    <option value="ANY">任何人</option>
                  </select>
                </label>
                <label>
                  文本匹配
                  <select v-model="route.match.textMode">
                    <option value="GLOB">通配匹配（* 和 ?）</option>
                    <option value="PREFIX">前缀匹配</option>
                    <option value="EXACT">完全匹配</option>
                  </select>
                </label>
                <label>
                  匹配内容
                  <input v-model="route.match.textPattern" required />
                </label>
                <label class="v3-check">
                  <input v-model="route.match.stripMentions" type="checkbox" />
                  匹配前移除艾特
                </label>
                <label>
                  动作
                  <select v-model="route.action.type">
                    <option value="AGENT">运行 Agent</option>
                    <option value="COMMAND">执行命令</option>
                  </select>
                </label>
                <label v-if="route.action.type === 'AGENT'">
                  目标 Agent
                  <select v-model="route.action.agentId" required>
                    <option :value="null" disabled>选择 Agent</option>
                    <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                      {{ agent.displayName }}（{{ agent.id }}）
                    </option>
                  </select>
                </label>
                <label v-else>
                  命令前缀
                  <input v-model="route.action.commandPrefix" required />
                </label>
              </div>
            </div>
          </li>
        </ol>
      </section>
      <section class="editor-section">
        <h3>路由预览测试</h3>
        <p class="muted">测试已保存的路由，不调用模型、不发送消息。修改规则后先应用修订。</p>
        <p v-if="dirty || !persisted" class="route-preview-hint">
          {{ persisted ? '规则修改尚未应用，应用修订后可测试。' : '请先保存此 IM，再测试路由。' }}
        </p>
        <form @submit.prevent="testRoute" class="v3-stack">
          <div class="v3-form-grid">
            <label>
              会话类型
              <select v-model="testInput.sessionType">
                <option v-for="session in sessions" :key="session.value" :value="session.value">
                  {{ session.label }}
                </option>
              </select>
            </label>
            <label>
              发送人 ID
              <input v-model="testInput.senderId" />
            </label>
            <label class="v3-span-all">
              消息文本
              <textarea v-model="testInput.text" rows="3" />
            </label>
          </div>
          <div class="v3-checks">
            <label>
              <input v-model="testInput.mentionsBot" type="checkbox" />
              艾特机器人
            </label>
            <label>
              <input v-model="testInput.mentionsAny" type="checkbox" />
              艾特其他人
            </label>
            <label>
              <input v-model="testInput.replyToBot" type="checkbox" />
              回复机器人
            </label>
            <label>
              <input v-model="testInput.hasReply" type="checkbox" />
              包含引用回复
            </label>
          </div>
          <button class="primary" :disabled="testing || dirty || !persisted">
            {{ testing ? '测试中…' : '运行路由测试' }}
          </button>
        </form>
        <p v-if="testError" class="notice error">{{ testError }}</p>
        <div v-if="testResult" class="notice" :class="testResult.matched ? 'ok' : ''">
          <strong>
            {{ testResult.matched ? `命中 ${testResult.routeId}` : '未命中任何路由' }}
          </strong>
          <p>
            动作：{{ actionLabel }} · Agent：{{ testResult.agentId || '无' }} · 权限：{{
              permissionLabels[testResult.permissionGroup as PermissionGroup] ||
              testResult.permissionGroup
            }}
          </p>
          <p>规范化文本：{{ testResult.normalizedText }}</p>
        </div>
      </section>
    </div>
    <div
      v-show="activeTab === 'permissions'"
      :id="`${editorId}-panel-permissions`"
      role="tabpanel"
      :aria-labelledby="`${editorId}-tab-permissions`"
      tabindex="0"
      class="im-editor-panel"
    >
      <section class="editor-section">
        <h3>身份权限</h3>
        <p class="muted">为当前 IM 指定干员身份。其他发送人按普通干员处理。</p>
        <div class="v3-form-grid">
          <label>
            高级资深干员 ID
            <StringList v-model="im.permission.superAdminIds" label="高级资深干员 ID" />
          </label>
          <label>
            资深干员 ID
            <StringList v-model="im.permission.adminIds" label="资深干员 ID" />
          </label>
        </div>
        <p class="muted">每行一个平台用户 ID。同一用户出现在两组时，使用更高身份。</p>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import { configV3Api, type RouteResult } from '../../api/configV3';
import {
  newRoute,
  permissionLabels,
  type PermissionGroup,
  moveItem,
  uniqueId,
  type ImConnection,
  type ImRoute,
  type AgentProfile,
} from '../../models/configV3';
import KeyValueEditor from './KeyValueEditor.vue';
import CredentialMapEditor from './CredentialMapEditor.vue';
import StringList from './StringList.vue';
import WeixinLogin from './WeixinLogin.vue';
import EditorSectionTabs from './EditorSectionTabs.vue';
const props = defineProps<{
  im: ImConnection;
  agents: AgentProfile[];
  persisted: boolean;
  dirty: boolean;
}>();
const editorId = `im-editor-${useId()}`;
const activeTab = ref('connection');
const tabs = [
  { id: 'connection', label: '连接' },
  { id: 'routes', label: '消息路由' },
  { id: 'permissions', label: '身份权限' },
];
const adapterName = computed(
  () =>
    ({ napcat4_18_6: 'NapCat', telegram: 'Telegram', weixin: '微信' })[props.im.type] ||
    props.im.type,
);
const enabledRouteCount = computed(() => props.im.routes.filter((route) => route.enabled).length);
// Object identity keeps the expanded rule stable while IDs are edited or priorities change.
const routeKeys = new WeakMap<ImRoute, string>();
let nextRouteKey = 0;
const expandedRoutes = ref(new Set<string>());
function routeKey(route: ImRoute) {
  let key = routeKeys.get(route);
  if (!key) {
    key = `${editorId}-route-${++nextRouteKey}`;
    routeKeys.set(route, key);
  }
  return key;
}
function isExpanded(route: ImRoute) {
  return expandedRoutes.value.has(routeKey(route));
}
function toggleRoute(route: ImRoute) {
  const next = new Set(expandedRoutes.value);
  const key = routeKey(route);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedRoutes.value = next;
}
function removeRoute(route: ImRoute, index: number) {
  const next = new Set(expandedRoutes.value);
  next.delete(routeKey(route));
  expandedRoutes.value = next;
  props.im.routes.splice(index, 1);
}
function sessionSummary(route: ImRoute) {
  return (
    route.match.sessionTypes
      .map((type) => sessions.find((item) => item.value === type)?.label || type)
      .join('、') || '未选择会话类型'
  );
}
function attentionSummary(route: ImRoute) {
  const labels = {
    ANY: '不限关注条件',
    MENTION: '包含艾特',
    REPLY: '包含引用回复',
    MENTION_OR_REPLY: '艾特或引用回复',
    NONE: '无艾特或引用',
  };
  const label = labels[route.match.attention];
  return route.match.attention === 'ANY'
    ? label
    : `${label}（${route.match.attentionTarget === 'BOT' ? '机器人' : '任何人'}）`;
}
function textSummary(route: ImRoute) {
  const labels = { GLOB: '文本匹配', PREFIX: '文本前缀', EXACT: '文本等于' };
  return `${labels[route.match.textMode]} ${route.match.textPattern || '未设置'}`;
}
function targetSummary(route: ImRoute) {
  if (route.action.type === 'COMMAND') return `执行命令 ${route.action.commandPrefix}`;
  const agent = props.agents.find((item) => item.id === route.action.agentId);
  return agent
    ? `Agent ${agent.displayName}`
    : route.action.agentId
      ? `Agent ${route.action.agentId}`
      : '尚未选择 Agent';
}
const reservedSettings = computed(() =>
  props.im.type === 'napcat4_18_6'
    ? ['host', 'port', 'wsPort']
    : props.im.type === 'weixin'
      ? ['accountId', 'stateDirectory', 'baseUrl']
      : props.im.type === 'telegram' ? ['proxyUrl'] : [],
);
const extraSettings = computed(() =>
  Object.fromEntries(
    Object.entries(props.im.settings).filter(([key]) => !reservedSettings.value.includes(key)),
  ),
);
function setExtraSettings(value: Record<string, string>) {
  props.im.settings = {
    ...Object.fromEntries(
      Object.entries(props.im.settings).filter(([key]) => reservedSettings.value.includes(key)),
    ),
    ...value,
  };
}
const sessions = [
  { value: 'GROUP', label: '群聊' },
  { value: 'PRIVATE', label: '私聊' },
  { value: 'CHANNEL', label: '频道' },
];
const testInput = reactive({
  sessionType: 'GROUP',
  text: '#help',
  mentionsBot: true,
  mentionsAny: false,
  replyToBot: false,
  hasReply: false,
  senderId: '',
});
const testing = ref(false);
const testError = ref('');
const testResult = ref<RouteResult | null>(null);
const actionLabel = computed(() => {
  const action = testResult.value?.action;
  return action && typeof action === 'object' ? action.type : action || '无';
});
function addRoute() {
  props.im.routes.push(newRoute(uniqueId('route', props.im.routes), props.agents[0]?.id || null));
  toggleRoute(props.im.routes[props.im.routes.length - 1]);
}
async function testRoute() {
  testing.value = true;
  testError.value = '';
  testResult.value = null;
  try {
    testResult.value = await configV3Api.routeTest(props.im.id, {
      ...testInput,
      mentionsAny: testInput.mentionsAny || testInput.mentionsBot,
      hasReply: testInput.hasReply || testInput.replyToBot,
    });
  } catch (cause) {
    testError.value = String(cause);
  } finally {
    testing.value = false;
  }
}
watch(
  () => props.im.id,
  () => {
    testResult.value = null;
    testError.value = '';
  },
);
</script>

<style scoped>
.im-editor,
.im-editor-panel {
  min-width: 0;
}
.im-editor-panel {
  padding-top: 20px;
}
.im-object-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.im-object-header h2 {
  margin: 0;
}
.im-object-header p {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
}
.object-enabled {
  flex-shrink: 0;
}
.im-object-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.im-object-summary div {
  min-width: 0;
}
.im-object-summary dt {
  margin-bottom: 6px;
}
.im-object-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.editor-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.editor-section-heading h3 {
  margin: 0;
}
.editor-section-heading p {
  margin: 7px 0 0;
  max-width: 58ch;
}
.route-order-note {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 20px 0 12px;
  font-size: 12px;
}
.route-sequence {
  margin: 0;
  padding: 0;
  list-style: none;
}
.route-row {
  border-top: 1px solid var(--line, #dae3ec);
}
.route-row:last-child {
  border-bottom: 1px solid var(--line, #dae3ec);
}
.route-row-heading {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding: 20px 0;
}
.route-ordinal {
  padding-top: 5px;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--muted, #64748b);
}
.route-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  justify-content: stretch;
  justify-items: stretch;
  align-content: start;
  gap: 8px;
  text-align: left;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  min-height: 0;
  box-shadow: none;
  background: transparent;
  font-weight: 400;
  letter-spacing: normal;
}
.route-summary-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
}
.route-summary-title strong {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.route-summary-match {
  font-size: 12px;
  line-height: 1.6;
}
.route-summary-target {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 16px;
  font-size: 12px;
  line-height: 1.6;
}
.route-summary-target > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.route-disclosure {
  font-size: 20px;
  line-height: 1;
}
.route-actions {
  display: grid;
  gap: 12px;
  justify-items: end;
}
.route-order-actions {
  display: flex;
  gap: 6px;
}
.route-order-actions button {
  min-height: 30px;
  padding: 0 9px;
}
.route-form {
  padding: 0 0 24px 46px;
}
.route-row.is-disabled .route-summary {
  opacity: 0.58;
}
.route-preview-hint {
  font-size: 13px;
  line-height: 1.6;
}
@media (max-width: 700px) {
  .im-object-summary {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .im-object-summary div {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .im-object-summary dt {
    margin: 0;
  }
  .im-object-summary dd {
    text-align: right;
  }
  .route-row-heading {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 10px;
  }
  .route-actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .route-form {
    padding-left: 0;
  }
  .editor-section-heading {
    flex-wrap: wrap;
  }
}
</style>
