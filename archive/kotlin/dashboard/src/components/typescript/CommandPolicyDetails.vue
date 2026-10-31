<script setup lang="ts">
import { ref, computed } from 'vue';
import { RuntimeStateSchema, runtimeStateLabels, type RuntimeState } from '../../../../typescript/packages/contracts/src/index';
import { commandPolicyByState, restrictedDownloadLimits } from '../../../../typescript/packages/contracts/src/command-policy';
import { commandDefinitionsForState, commandEnvironmentText, commandInputText } from './command-policy-model';

const selectedState = ref<RuntimeState>('operator');
const policy = computed(() => commandPolicyByState[selectedState.value]);
const commands = computed(() => commandDefinitionsForState(selectedState.value));
</script>
<template>
  <section class="command-policy-details" aria-label="按运行态限制的命令范围">
    <header><h3>可用命令与参数</h3><p>先选择运行态，再查看命令范围。下表只读，实际执行由服务端检查。</p></header>
    <div class="command-state-options" aria-label="查看运行态命令"><button v-for="state in RuntimeStateSchema.options" :key="state" type="button" :aria-pressed="selectedState===state" @click="selectedState=state">{{runtimeStateLabels[state]}}</button></div>
    <div class="command-mode"><strong>{{policy.summary}}</strong><p>{{commandEnvironmentText(selectedState)}}。</p><p>{{commandInputText(selectedState)}}。</p></div>
    <template v-if="!policy.fullShell">
      <p class="command-boundary">只执行下表列出的命令和参数。服务端会检查目标路径。不会把输入直接交给 Shell 执行。</p>
      <div class="command-table-wrap"><table><thead><tr><th>命令</th><th>用途</th><th>支持的参数</th></tr></thead><tbody><tr v-for="command in commands" :key="command.name"><th scope="row"><code>{{command.name}}</code></th><td>{{command.summary}}</td><td><code>{{command.syntax}}</code></td></tr></tbody></table></div>
      <details class="command-help"><summary>受限命令的共同规则</summary><ul><li>每次只提交一条命令。不要使用管道、重定向或命令替换。</li><li>不能运行脚本、解释器或其他未列出的程序。</li><li>只能访问 Agent 已授权的工作目录。本机执行环境不接受这些低态命令。</li><li>文件整理与下载至少需要资深干员态。</li><li v-if="policy.commands.includes('cp')">cp、mv 不会覆盖已有文件。写入或下载失败时，可能留下部分文件。请检查目标，并选择新路径重试。</li></ul></details>
      <details v-if="policy.commands.includes('curl')" class="command-help"><summary>下载限制</summary><ul><li>先为执行环境开启网络，再使用 curl 下载。</li><li>只接受 HTTP(S) GET。下载目标必须解析为公网 IPv4。</li><li>不能访问内网或本机地址。不能上传文件或添加请求头。<template v-if="!restrictedDownloadLimits.redirects">不跟随重定向。</template></li><li>下载到工作目录的新文件。<template v-if="!restrictedDownloadLimits.overwrite">不会覆盖已有文件。</template></li><li>单文件最多 {{restrictedDownloadLimits.maxBytes / (1024 * 1024)}} MiB，最长等待 {{restrictedDownloadLimits.timeoutMs / 1000}} 秒。</li></ul></details>
    </template>
    <div v-else class="command-shell-note"><p>可以使用完整 Shell 语法、脚本、解释器和终端输入。</p><p>实际权限仍由执行环境决定。Docker 使用容器边界。本机环境使用服务账户权限。</p><p>逐次审批规则仍然生效。批准操作不会提升运行态。</p></div>
  </section>
</template>
<style scoped>
.command-policy-details{display:grid;gap:16px;min-width:0;color:var(--ink)}header h3{margin:0 0 8px;font-size:16px}header p,.command-boundary,.command-shell-note p{margin:0;color:var(--muted);font-size:13px;line-height:1.8}.command-state-options{display:flex;flex-wrap:wrap;gap:8px}.command-state-options button{font:inherit;font-size:12px;padding:8px 11px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--muted);cursor:pointer}.command-state-options button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-ink)}.command-mode{display:grid;gap:7px;padding:14px 16px;border-left:3px solid var(--accent);background:var(--surface-soft);font-size:13px;line-height:1.7}.command-mode p{margin:0;color:var(--muted);font-size:12px}.command-table-wrap{overflow-x:auto;min-width:0}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.8}thead th{color:var(--muted);font-weight:500;background:var(--surface-soft)}tbody th{width:75px;font-weight:500}code{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}td:last-child{width:46%}.command-help{font-size:12px;color:var(--muted);line-height:1.8}.command-help summary{cursor:pointer;color:var(--accent-ink)}.command-help ul{padding-left:18px;margin:10px 0 0}.command-shell-note{display:grid;gap:12px}@media(max-width:700px){th,td{padding:10px 6px}td:last-child{width:auto}thead{display:none}tr{display:grid;grid-template-columns:1fr;padding:12px 0;border-bottom:1px solid var(--line)}th,td{border:0;padding:3px 0}tbody th{width:auto}.command-state-options button{flex:1;min-width:100px}}
</style>
