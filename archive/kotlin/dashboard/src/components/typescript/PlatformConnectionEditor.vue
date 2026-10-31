<script setup lang="ts">
import { type PlatformConfig } from '../../../../typescript/packages/contracts/src/index';
const platform = defineModel<PlatformConfig>({ required: true });
withDefaults(defineProps<{ identity?: boolean; disabled?: boolean }>(), { identity: true, disabled: false });
const emit = defineEmits<{ 'identity-change': [id: string] }>();
function changeId(event: Event): void { if (!(event.target instanceof HTMLInputElement)) return; platform.value.id = event.target.value.trim(); emit('identity-change', platform.value.id); }
function changeApiBase(event: Event): void { if (platform.value.type !== 'napcat' || !(event.target instanceof HTMLInputElement)) return; const value = event.target.value.trim(); if (value) platform.value.apiBase = value; else delete platform.value.apiBase; }
</script>
<template>
  <fieldset class="connection-fields" :disabled="disabled">
    <label v-if="identity">机器人名称<input v-model="platform.displayName" maxlength="120" placeholder="例如：我的 QQ 助手"></label>
    <template v-if="platform.type==='napcat'">
      <label>NapCat WebSocket 地址<input v-model="platform.websocketUrl" autocomplete="off" placeholder="ws://127.0.0.1:3001"><small>填写服务器可访问的 OneBot 正向 WebSocket 地址。</small></label>
      <label>令牌环境变量名<input v-model="platform.accessTokenEnv" autocomplete="off" placeholder="NAPCAT_TOKEN"><small>填写服务器环境变量名，例如 NAPCAT_TOKEN。</small></label>
    </template>
    <template v-else-if="platform.type==='telegram'">
      <label>令牌环境变量名<input v-model="platform.tokenEnv" autocomplete="off" placeholder="TELEGRAM_TOKEN"><small>将 BotFather 的令牌保存在服务器环境变量中。这里填写变量名。</small></label>
    </template>
    <template v-else>
      <p class="connection-hint">发布配置后，可以扫码登录微信。也可以使用服务器上已有的账号和令牌。</p>
      <label>令牌环境变量名<input v-model="platform.tokenEnv" autocomplete="off" placeholder="WEIXIN_TOKEN"><small>使用已有令牌时，填写服务器环境变量名。</small></label>
    </template>
    <details class="advanced-connection"><summary>高级连接设置</summary><div class="connection-fields">
      <label v-if="identity">实例 ID<input :value="platform.id" autocomplete="off" @change="changeId"><small>路由和授权使用此 ID。修改后，请同步修改引用它的规则。</small></label>
      <label v-if="platform.type==='napcat'">HTTP API 地址（可选）<input :value="platform.apiBase ?? ''" type="url" placeholder="http://127.0.0.1:3000" @change="changeApiBase"><small>填写 http:// 或 https:// 开头的地址。留空时使用 WebSocket API。</small></label>
      <template v-if="platform.type==='telegram'"><label>Telegram API 地址<input v-model="platform.apiBase" type="url" autocomplete="off"></label><label>长轮询超时（秒）<input v-model.number="platform.pollingTimeoutSeconds" type="number" min="1" max="60"><small>控制每次等待新消息的时长。填写 1 到 60 的整数。</small></label></template>
      <template v-if="platform.type==='weixin'"><label>iLink API 地址<input v-model="platform.apiBase" type="url" autocomplete="off"></label><label>账号 ID<input v-model="platform.accountId" autocomplete="off"></label><label>登录状态文件<input v-model="platform.stateFile" autocomplete="off"><small>此文件保存微信登录状态。填写服务器上的文件路径。</small></label></template>
    </div></details>
  </fieldset>
</template>
<style scoped>
.connection-fields{border:0;padding:0;margin:0;min-width:0;display:grid;gap:20px}.connection-fields label{display:grid;gap:8px;font-size:14px;color:var(--ink,#253f34)}.connection-fields input{width:100%;min-width:0;min-height:42px;border:1px solid var(--line,#c5d8ce);border-radius:6px;padding:10px 12px;background:var(--panel,#fff);font:inherit;color:inherit;box-sizing:border-box}.connection-fields small{font-size:12px;line-height:1.7;color:var(--muted,#6c8276)}.advanced-connection{border-top:1px solid var(--line,#d6e4db);padding-top:18px}.advanced-connection summary{font-size:13px;cursor:pointer;color:var(--muted,#6c8276)}.advanced-connection[open] .connection-fields{margin-top:20px}.connection-hint{margin:0;padding:13px 15px;background:var(--soft,#f0f7f3);color:var(--muted,#6c8276);font-size:13px;line-height:1.7}
</style>
