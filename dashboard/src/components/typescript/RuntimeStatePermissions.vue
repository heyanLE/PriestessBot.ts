<script setup lang="ts">
import { RuntimeStateSchema, runtimeStateLabels, runtimeStateCapabilities, type Capability, type RuntimeState } from '../../../../packages/contracts/src/index';
import { commandPolicyByState } from '../../../../packages/contracts/src/command-policy';
import { commandEnvironmentText } from './command-policy-model';

const labels: Readonly<Record<Capability, string>> = { chat:'对话', 'knowledge.read':'检索知识库', 'memory.read':'读取记忆', 'memory.write':'写入当前范围的记忆', 'files.read':'读取已授权文件', 'files.write':'写入文件', 'process.execute.restricted':'受限命令执行', 'process.execute':'完整 Shell 执行', 'process.pty':'操作终端', 'external.write':'执行外部写入', 'conversation.reset':'重置会话', 'conversation.stop':'停止自己的任务', 'agent.delegate':'委派 Agent', 'resources.manage':'管理资源与共享范围', admin:'管理操作' };
function additionalCapabilities(state: RuntimeState): readonly Capability[] {
  const previous = state === 'elite_operator' ? runtimeStateCapabilities.senior_operator : state === 'senior_operator' ? runtimeStateCapabilities.operator : [];
  return runtimeStateCapabilities[state].filter(capability => !previous.includes(capability) && capability !== 'process.execute.restricted' && capability !== 'process.execute' && capability !== 'process.pty');
}
</script>
<template>
  <section class="runtime-state-permissions" aria-label="固定运行态权限">
    <header><h3>固定运行态权限</h3><p>权限由系统固定。工具、资料和目录仍需在 Agent 中装配。平台和人格限制仍然生效。</p></header>
    <div class="state-profiles"><article v-for="state in RuntimeStateSchema.options" :key="state"><h4>{{runtimeStateLabels[state]}}</h4><strong class="state-command-mode">{{commandPolicyByState[state].summary}}</strong><div v-if="!commandPolicyByState[state].fullShell" class="state-commands"><code v-for="command in commandPolicyByState[state].commands" :key="command">{{command}}</code></div><p v-else>可以使用 Shell、脚本、解释器与终端输入。</p><p class="state-environment">{{commandEnvironmentText(state)}}。</p><p v-if="state!=='operator'">包含{{state==='senior_operator'?'普通干员态':'资深干员态'}}的权限，并增加：</p><ul><li v-for="capability in additionalCapabilities(state)" :key="capability">{{labels[capability]}}</li></ul></article></div>
    <p class="state-boundary">委派不会提升原任务的运行态。未分配的发送者使用普通干员态。发送者不能通过指令自行切换运行态。</p><p class="state-boundary">受限命令只接受指定参数。下载还受执行环境的网络开关限制。批准操作不会增加命令范围。</p>
  </section>
</template>
<style scoped>
.runtime-state-permissions{display:grid;gap:16px;color:var(--ink)}header h3{margin:0 0 7px;font-size:16px}header p,.state-boundary{margin:0;color:var(--muted);font-size:13px;line-height:1.7}.state-profiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.state-profiles article{padding:17px 18px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft);min-width:0}.state-profiles h4{margin:0 0 12px;font-size:14px;color:var(--accent-ink)}.state-profiles p{font-size:12px;color:var(--muted);margin:0 0 8px;line-height:1.6}.state-profiles ul{margin:0;padding-left:17px;font-size:12px;line-height:1.9}.state-boundary{font-size:12px}.state-command-mode{display:block;font-size:13px;line-height:1.7;margin-bottom:10px}.state-commands{display:flex;flex-wrap:wrap;gap:5px 10px;margin:0 0 12px}.state-commands code{font-size:12px;color:var(--accent-ink)}.state-profiles .state-environment{padding-bottom:11px;border-bottom:1px solid var(--line);margin-bottom:13px}@media(max-width:850px){.state-profiles{grid-template-columns:1fr}.state-profiles article{padding:15px}.state-profiles ul{display:flex;flex-wrap:wrap;gap:4px 26px}}
</style>
