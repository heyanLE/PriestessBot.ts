package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.platform.MessageComponent
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow

/**
 * 唤醒检测阶段：
 * - 私聊消息 → 直接通过
 * - 群聊消息 → 需要满足以下之一：
 *   1. @提及机器人
 *   2. 消息以配置的前缀开头
 * - 频道消息 → 需要满足前缀或 @提及
 */
class WakingCheckStage(
    private val config: PipelineConfig,
) : Stage {
    private val logger = KotlinLogging.logger {}

    override val name = "WakingCheck"
    override val order = StageOrder.WAKING_CHECK

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        if (ctx.effectiveRuntimeSnapshot?.application != null) return null
        // 私聊消息默认通过
        if (ctx.isPrivate) {
            return null
        }

        val text = ctx.textContent.trim()
        val wakingPrefix = ctx.effectiveRuntimeSnapshot?.runtime?.pipeline?.wakingPrefix ?: config.wakingPrefix

        // 检查是否 @提及了机器人
        val selfId = ctx.event.session.metadata["selfId"]
        val hasBotAtMention = selfId != null &&
            ctx.event.chain.components.any { component ->
                component is MessageComponent.At && component.userId == selfId
            }

        // 检查是否有命令前缀
        val hasPrefix = wakingPrefix.isNotEmpty() && text.startsWith(wakingPrefix)

        if (!hasBotAtMention && !hasPrefix) {
            ctx.stop()
            log("Group message without bot @mention or prefix, stopping pipeline")
        }

        return null
    }

    private fun log(message: String) {
        logger.info { message }
    }
}
