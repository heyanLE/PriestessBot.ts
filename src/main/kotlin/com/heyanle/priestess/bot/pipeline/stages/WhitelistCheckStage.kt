package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.platform.SessionType
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow

/**
 * 白名单过滤阶段：
 * - 如果未启用白名单 → 直接通过
 * - 启用时检查发送者或群组是否在白名单内
 */
class WhitelistCheckStage(
    private val config: PipelineConfig,
) : Stage {
    private val logger = KotlinLogging.logger {}

    override val name = "WhitelistCheck"
    override val order = StageOrder.WHITELIST_CHECK

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        if (ctx.effectiveRuntimeSnapshot?.application != null && ctx.event.platform.metadata.name == "dashboard") return null
        val effective = ctx.effectiveRuntimeSnapshot?.runtime?.pipeline
        val whitelistEnabled = effective?.whitelistEnabled ?: config.whitelistEnabled
        val whitelistUsers = effective?.whitelistUsers ?: config.whitelistUsers
        val whitelistGroups = effective?.whitelistGroups ?: config.whitelistGroups
        if (!whitelistEnabled) return null

        val senderId = ctx.senderId
        val sessionId = ctx.event.session.id

        // 检查用户是否在白名单
        val userWhitelisted = senderId in whitelistUsers

        // 检查群组是否在白名单（仅群聊场景）
        val groupWhitelisted = if (ctx.event.session.type == SessionType.GROUP) {
            sessionId in whitelistGroups
        } else {
            false
        }

        if (!userWhitelisted && !groupWhitelisted) {
            ctx.stop()
            log("User '$senderId' not in whitelist, stopping pipeline")
        }

        return null
    }

    private fun log(message: String) {
        logger.info { message }
    }
}
