package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import kotlinx.coroutines.flow.Flow

/**
 * 结果装饰阶段。
 *
 * 对 Agent 的响应进行格式化处理：
 * - 错误响应 → 友好的错误提示
 * - 正常响应 → 可选 Markdown 渲染（v1 占位）、添加前缀/后缀
 *
 * v1 实现：透传 Agent 响应文本，错误时转换为用户友好的提示。
 */
class ResultDecorateStage : Stage {
    override val name = "ResultDecorate"
    override val order = StageOrder.RESULT_DECORATE

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        ctx.directResponse?.let {
            ctx.decoratedResponse = it
            return null
        }
        val response = ctx.agentResponse

        when (response) {
            is AgentResponse.Final -> {
                ctx.decoratedResponse = response.content
            }
            is AgentResponse.Error -> {
                // 错误响应：转换为友好提示
                val friendlyMessage = when {
                    response.message.contains("Exceeded maximum steps", ignoreCase = true) ->
                        "抱歉，处理您的请求超时了，请稍后再试或简化您的问题。"
                    response.message.contains("AgentContext not initialized", ignoreCase = true) ->
                        "系统初始化异常，请稍后再试。"
                    else ->
                        "抱歉，处理您的请求时出现了错误：${response.message}"
                }
                ctx.decoratedResponse = friendlyMessage
            }
            is AgentResponse.Thinking -> {
                // 不应该在 Final 阶段看到 Thinking
                ctx.decoratedResponse = "处理中，但未获得最终结果。"
            }
            is AgentResponse.ToolExecuted -> {
                // 不应该在 Final 阶段看到 ToolExecuted
                ctx.decoratedResponse = "工具执行完成，但未获得最终回答。"
            }
            null -> {
                ctx.decoratedResponse = "未收到任何响应。"
            }
        }

        return null
    }

}
