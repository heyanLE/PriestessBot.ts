<script setup lang="ts">
import type { ContextPolicy } from '../../../../packages/contracts/src/context-policy';
const policy = defineModel<ContextPolicy>({ required: true });
defineProps<{ connections: readonly { id: string }[]; agentModel: string }>();
</script>
<template>
  <div class="ts-fields">
    <p class="muted">上下文窗口限制一次模型请求的容量。任务 Token 预算由 Agent 的执行设置控制。压缩只改变发给模型的历史，不删除完整会话记录。</p>
    <div class="ts-form-grid">
      <label>历史压缩方式<select v-model="policy.strategy" aria-describedby="context-strategy-help"><option value="semantic">模型摘要（失败时改用摘录）</option><option value="extractive">保留限定长度的历史摘录</option><option value="truncate_by_turns">按完整轮次裁剪</option></select><small id="context-strategy-help" aria-hidden="true">模型摘要会调用摘要模型。摘录和按轮次裁剪不调用摘要模型。</small></label>
      <label>模型上下文窗口（估算 Token）<input v-model.number="policy.contextWindowTokens" type="number" min="2048" max="2000000" aria-describedby="context-window-help"><small id="context-window-help" aria-hidden="true">填写模型支持的窗口容量。系统会为提示词、工具和输出预留空间。</small></label>
      <label>自动压缩阈值（估算 Token）<input v-model.number="policy.compactAtTokens" type="number" min="1024" :max="policy.contextWindowTokens-1" aria-describedby="context-threshold-help"><small id="context-threshold-help" aria-hidden="true">历史超过此值时可触发压缩。此值须低于上下文窗口，并高于保留目标 {{ policy.targetTokens }}。</small></label>
      <label>已完成历史轮数上限（-1 不限制）<input v-model.number="policy.maxTurns" type="number" min="-1" max="1000" aria-describedby="context-turns-help"><small id="context-turns-help" aria-hidden="true">填写正整数，或填 -1 取消轮数限制。此限制独立于 Token 阈值。</small></label>
      <label>近期原文保留比例<input v-model.number="policy.keepRecentRatio" type="number" min="0" max="0.3" step="0.01" aria-describedby="context-recent-help"><small id="context-recent-help" aria-hidden="true">摘要或摘录时，按历史 Token 估算量保留近期原文。0.15 表示 15%。</small></label>
      <label>每次裁剪轮数<input v-model.number="policy.trimTurns" type="number" min="1" max="1000" aria-describedby="context-trim-help"><small id="context-trim-help" aria-hidden="true">按轮次裁剪时，移除指定数量的最早完整轮次。历史轮数超限时也使用此值。</small></label>
    </div>
    <template v-if="policy.strategy==='semantic'">
      <div class="ts-form-grid">
        <label>摘要模型服务<select v-model="policy.summaryConnectionId" aria-describedby="context-summary-service-help"><option value="">沿用 Agent 的模型服务</option><option v-for="connection in connections" :key="connection.id" :value="connection.id">{{connection.id}}</option></select><small id="context-summary-service-help" aria-hidden="true">选择执行历史摘要的模型连接。</small></label>
        <label>摘要模型<input v-model="policy.summaryModel" :placeholder="`留空沿用 ${agentModel}`" aria-describedby="context-summary-model-help"><small id="context-summary-model-help" aria-hidden="true">填写所选服务支持的模型名。留空使用 Agent 的模型名。</small></label>
        <label>摘要输出预算（Token）<input v-model.number="policy.summaryMaxTokens" type="number" min="128" :max="Math.min(8192,policy.targetTokens-1)" aria-describedby="context-summary-budget-help"><small id="context-summary-budget-help" aria-hidden="true">限制一次摘要的输出长度。此值须低于保留目标 {{ policy.targetTokens }}。</small></label>
        <label>摘要超时（毫秒）<input v-model.number="policy.summaryTimeoutMs" type="number" min="1000" max="120000" aria-describedby="context-summary-timeout-help"><small id="context-summary-timeout-help" aria-hidden="true">1000 毫秒等于 1 秒。超时后改用历史摘录。</small></label>
      </div>
      <label>额外摘要要求<textarea v-model="policy.summaryInstructions" rows="4" placeholder="例如：保留已确认的决定、待办和用户偏好。标明工具操作是否已经完成。"></textarea></label>
    </template>
    <details class="muted"><summary>Token 估算与压缩规则</summary><p>已发送内容优先使用模型返回的输入 Token 数。新增内容按以下权重估算：中文字符 0.6、其他字符 0.3、每张图片 765。</p><p>后续工具轮次只在模型窗口不足时压缩。系统保留当前请求及完整工具调用链。</p><p>摘要会保留近期原文和安全的开场内容。压缩后仍超限时，系统继续裁剪旧历史。摘要失败时改用带来源信息的历史摘录。</p><p>摘要消耗计入任务用量。是否限制累计消耗，由任务预算模式决定。</p><p>若单个完整轮次仍超过窗口，运行会报错。请检查该轮输入与工具结果，或选择窗口更大的模型。</p></details>
  </div>
</template>
