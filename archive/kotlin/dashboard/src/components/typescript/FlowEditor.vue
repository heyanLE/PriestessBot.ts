<script setup lang="ts">
import { randomId } from '../../utils/random-id';
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import RuntimeStatePermissions from './RuntimeStatePermissions.vue';
import { AgentIdSchema, SessionIdSchema, type RuntimeConfig, type FlowConfig, type FlowSimulation, type FlowNodeId } from '../../../../typescript/packages/contracts/src/index';
const props = defineProps<{ trace?: FlowSimulation['path'] }>();
const config = defineModel<RuntimeConfig>({ required: true });
type NodeKey = Exclude<keyof FlowConfig, 'id' | 'revision'>;
const nodes: { key: NodeKey; title: string; detail: string }[] = [
  { key: 'normalization', title: '信息处理', detail: '消息链 · 去重 · 文字 / 图片 / 文件' },
  { key: 'acceptance', title: '消息准入', detail: '私聊 · 群聊触发 · 速率限制' },
  { key: 'authorization', title: '运行态授权', detail: '普通 / 资深 / 高级资深干员' },
  { key: 'routing', title: '选择 Agent', detail: '按顺序匹配规则 · 默认 Agent' },
  { key: 'commands', title: '指令分派', detail: '指令名 → 参数 → 执行 → 回复' },
  { key: 'context', title: '上下文装配', detail: '长期记忆 · 知识检索' },
  { key: 'execution', title: 'Agent 执行', detail: 'Agents SDK · 工具 · 子 Agent' },
  { key: 'delivery', title: '回复投递', detail: '流式更新 · 平台降级' },
];
const traceIds: Record<NodeKey, FlowNodeId> = { normalization:'normalize',acceptance:'accept',authorization:'authorize',routing:'route',commands:'command',context:'context',execution:'agent',delivery:'deliver' };
function traceStatus(key:NodeKey) { return props.trace?.find(step=>step.nodeId===traceIds[key])?.status; }
const selected = ref<NodeKey>('routing');
const selectedLabel = computed(() => nodes.find(node => node.key === selected.value)?.title);
const flow = computed(() => config.value.flow);
function addRule() { flow.value.routing.rules.push({ id: randomId(), agentId: flow.value.routing.defaultAgentId }); }
function moveRule(index: number, delta: number) { const target = index + delta; const rules = flow.value.routing.rules; if (target < 0 || target >= rules.length) return; const rule = rules[index]; if (!rule) return; rules.splice(index, 1); rules.splice(target, 0, rule); }
function setRuleSession(index:number,event:Event){const rule=flow.value.routing.rules[index];if(!rule||!(event.target instanceof HTMLInputElement))return;const value=event.target.value.trim();if(value)rule.sessionId=SessionIdSchema.parse(value);else delete rule.sessionId;}
function selectAgent(event: Event) { if (event.target instanceof HTMLSelectElement) flow.value.routing.defaultAgentId = AgentIdSchema.parse(event.target.value); }
</script>
<template>
<div class="ts-flow-layout">
  <div class="ts-flow-canvas" aria-label="固定消息路由流程">
    <p class="muted ts-flow-note">一套路由 · 点击节点编辑参数</p>
    <div class="ts-flow-terminal">消息接入 <small>input</small></div>
    <ol class="ts-flow-nodes">
      <li v-for="(node, index) in nodes" :key="node.key">
        <button :class="{ selected: selected === node.key, passed: traceStatus(node.key) === 'passed', rejected: traceStatus(node.key) === 'rejected' }" :aria-pressed="selected === node.key" @click="selected = node.key">
          <span class="ts-node-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span><strong>{{ node.title }}</strong><small>{{ node.detail }}</small><small v-if="traceStatus(node.key)">模拟：{{ traceStatus(node.key) === 'passed' ? '通过' : traceStatus(node.key) === 'rejected' ? '拒绝' : '忽略' }}</small></span><span aria-hidden="true">›</span>
        </button>
        <span v-if="index < nodes.length - 1" class="ts-node-link" aria-hidden="true">↓</span>
      </li>
    </ol>
    <div class="ts-flow-terminal">处理结束 <small>end</small></div>
  </div>
  <section class="ts-node-inspector" :aria-label="`${selectedLabel}参数`">
    <h2>{{ selectedLabel }}</h2><p class="muted">参数保存在当前草稿中，校验发布后生效。</p>
    <div v-if="selected === 'normalization'" class="ts-fields">
      <label>消息去重窗口（毫秒）<input v-model.number="flow.normalization.dedupeWindowMs" type="number" min="1000"></label>
      <label>最大消息字符数<input v-model.number="flow.normalization.maxMessageChars" type="number" min="1"></label>
      <p class="notice">不同平台的文字、图片、文件、提及与引用统一为消息链，再进入后续节点。</p>
    </div>
    <div v-if="selected === 'acceptance'" class="ts-fields">
      <label class="ts-check"><input v-model="flow.acceptance.privateEnabled" type="checkbox">接受私聊</label>
      <label>群聊触发条件<select v-model="flow.acceptance.groupPolicy"><option value="mention_or_reply">提及机器人或回复机器人</option><option value="all">所有群消息</option><option value="disabled">关闭群聊</option></select></label>
      <label class="ts-check"><input v-model="flow.acceptance.groupCommandsRequireAttention" type="checkbox">群聊指令也要求提及或回复机器人</label>
      <label>窗口内消息上限（0 为不限速）<input v-model.number="flow.acceptance.rateLimitCount" type="number" min="0"></label>
      <label class="ts-check"><input v-model="flow.acceptance.allowlist.enabled" type="checkbox">启用会话白名单</label>
      <p class="notice">白名单按机器人实例与会话类型精确匹配；启用后空列表拒绝所有 IM 会话。Dashboard 管理聊天不受白名单限制。</p>
      <div class="section-title compact"><h3>允许的会话</h3><button @click="flow.acceptance.allowlist.entries.push({platform: config.platforms[0]?.id ?? '', sessionType: 'group', sessionId: ''})">添加会话</button></div>
      <article v-for="(entry,index) in flow.acceptance.allowlist.entries" :key="index" class="card ts-fields">
        <label>机器人实例<input v-model="entry.platform"></label><label>会话类型<select v-model="entry.sessionType"><option value="private">私聊</option><option value="group">群聊</option></select></label><label>会话 ID<input v-model="entry.sessionId"></label><button class="danger" @click="flow.acceptance.allowlist.entries.splice(index,1)">删除会话</button>
      </article>
      <label class="ts-check"><input v-model="flow.acceptance.allowlist.bypassAdministratorsInPrivate" type="checkbox">白名单管理员可绕过私聊白名单</label>
      <label class="ts-check"><input v-model="flow.acceptance.allowlist.bypassAdministratorsInGroups" type="checkbox">白名单管理员可绕过群聊白名单</label>
      <div class="section-title compact"><h3>白名单管理员</h3><button @click="flow.acceptance.allowlist.administrators.push({platform: config.platforms[0]?.id ?? '', senderId: ''})">添加管理员</button></div>
      <p class="notice">此处仅控制白名单例外；运行态与工具权限仍由授权配置决定。</p>
      <article v-for="(entry,index) in flow.acceptance.allowlist.administrators" :key="index" class="card ts-fields"><label>机器人实例<input v-model="entry.platform"></label><label>发送者 ID<input v-model="entry.senderId"></label><button class="danger" @click="flow.acceptance.allowlist.administrators.splice(index,1)">删除管理员</button></article>
      <label>速率窗口（毫秒）<input v-model.number="flow.acceptance.rateLimitWindowMs" type="number" min="1000"></label>
    </div>
    <div v-if="selected === 'authorization'" class="ts-fields">
      <p class="notice">按发送者授权确定运行态。每个态使用固定权限。路由节点不提升或覆盖发送者的态。</p>
      <RouterLink class="button-link" to="/permissions">管理发送者授权</RouterLink>
      <RuntimeStatePermissions/>
    </div>
    <div v-if="selected === 'routing'" class="ts-fields">
      <label>默认 Agent<select :value="flow.routing.defaultAgentId" @change="selectAgent"><option v-for="agent in config.agents" :key="agent.id" :value="agent.id">{{ agent.displayName }} · {{ agent.id }}</option></select></label>
      <div class="section-title compact"><h3>按顺序匹配</h3><button @click="addRule">添加规则</button></div>
      <p v-if="!flow.routing.rules.length" class="notice">暂无匹配规则，符合准入条件的消息进入默认 Agent。</p>
      <article v-for="(rule, index) in flow.routing.rules" :key="rule.id" class="card ts-fields">
        <div class="toolbar"><strong>规则 {{ index + 1 }}</strong><button :disabled="index === 0" aria-label="上移规则" @click="moveRule(index,-1)">↑</button><button :disabled="index === flow.routing.rules.length - 1" aria-label="下移规则" @click="moveRule(index,1)">↓</button><button class="danger" @click="flow.routing.rules.splice(index,1)">删除规则</button></div>
        <label>IM 实例（留空匹配全部）<input v-model="rule.platform"></label><label>发送者 ID<input v-model="rule.senderId"></label><label>会话 ID（留空不限）<input :value="rule.sessionId" @change="setRuleSession(index,$event)"></label><label>包含文字<input v-model="rule.textIncludes"></label>
        <label>目标 Agent<select v-model="rule.agentId"><option v-for="agent in config.agents" :key="agent.id" :value="agent.id">{{ agent.displayName }}</option></select></label>
      </article>
    </div>
    <div v-if="selected === 'commands'" class="ts-fields"><label>指令前缀<input v-model="flow.commands.prefix" maxlength="8"></label><p class="notice">指令在代码中声明名称、参数、执行和回复。普通消息继续进入 Agent。</p></div>
    <div v-if="selected === 'context'" class="ts-fields"><label>召回记忆条数<input v-model.number="flow.context.memoryLimit" type="number" min="0" max="30"></label><label>知识检索条数<input v-model.number="flow.context.knowledgeLimit" type="number" min="0" max="30"></label><label>上下文字符预算<input v-model.number="flow.context.maxChars" type="number" min="100"></label></div>
    <div v-if="selected === 'execution'" class="ts-fields"><label>执行超时（毫秒）<input v-model.number="flow.execution.timeoutMs" type="number" min="100"></label><label>最大轮数<input v-model.number="flow.execution.maxTurns" type="number" min="1" max="100"></label><label>全局并发会话数<input v-model.number="flow.execution.globalConcurrency" type="number" min="1" max="128"></label><label>单会话等待队列上限<input v-model.number="flow.execution.perSessionQueueLimit" type="number" min="1" max="1000"></label><label>全局等待队列上限<input v-model.number="flow.execution.globalQueueLimit" type="number" min="1" max="10000"></label><p class="notice">Agent 保留独立定义。当前使用 Agents SDK，引擎通过统一契约接入。</p></div>
    <div v-if="selected === 'delivery'" class="ts-fields"><label class="ts-check"><input v-model="flow.delivery.stream" type="checkbox">启用流式回复</label><label>更新节流（毫秒）<input v-model.number="flow.delivery.throttleMs" type="number" min="100"></label><label>平台降级<select v-model="flow.delivery.fallback"><option value="final">等待完整回复</option><option value="chunks">分段发送</option></select></label><label>每段字符数<input v-model.number="flow.delivery.chunkChars" type="number" min="100"></label></div>
  </section>
</div>
</template>
