package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.message.ResponseAssembler
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.CancellationException

/**
 * 回复发送阶段（管道最后一环）。
 *
 * 将装饰后的响应通过原始 Platform 发送给用户。
 * 负责会话持久化已在 PreProcessStage 的后置逻辑中处理。
 */
class RespondStage(private val assembler: ResponseAssembler = ResponseAssembler()) : Stage {
    private val logger = KotlinLogging.logger {}

    override val name = "Respond"
    override val order = StageOrder.RESPOND

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        val responseText = ctx.decoratedResponse.orEmpty()
        val intent = ctx.agentContext?.responseIntent
            ?.takeIf { ctx.agentResponse is AgentResponse.Final && ctx.directResponse == null }
        val chain = assembler.assemble(ctx.event, responseText, intent)
        ctx.responseChain = chain
        if (chain.components.isEmpty()) {
            logger.info { "[PIPELINE-391] Respond no response to send, skipping" }
            return null
        }

        val platform = ctx.event.platform
        val session = ctx.event.session

        try {
            logger.info {
                "[PIPELINE-310] Respond sending response platform=${platform.metadata.name}, " +
                    "session=${session.id}, length=${responseText.length}"
            }
            platform.sendMessage(session, chain)
            logger.info { "[PIPELINE-319] Respond sent response preview='${responseText.take(100)}'" }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.error(e) { "[PIPELINE-993] Failed to send message" }
            throw e
        }

        return null
    }
}
