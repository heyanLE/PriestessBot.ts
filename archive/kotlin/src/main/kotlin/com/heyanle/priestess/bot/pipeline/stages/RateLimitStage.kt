package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow
import java.util.Deque
import java.util.LinkedList
import java.util.concurrent.ConcurrentHashMap

/**
 * 频率限制阶段：
 * - 基于滑动窗口实现每用户每分钟消息数限制
 * - 超过限制时终止管道
 */
class RateLimitStage(
    private val config: PipelineConfig,
) : Stage {
    private val logger = KotlinLogging.logger {}

    override val name = "RateLimit"
    override val order = StageOrder.RATE_LIMIT

    /** 每个用户的时间戳队列 */
    private val userTimestamps = ConcurrentHashMap<String, Deque<Long>>()

    /** 窗口大小（毫秒） */
    private val windowMs: Long = 60_000L

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        val effective = ctx.effectiveRuntimeSnapshot?.runtime?.pipeline
        val rateLimitEnabled = effective?.rateLimitEnabled ?: config.rateLimitEnabled
        val rateLimitPerMinute = effective?.rateLimitPerMinute ?: config.rateLimitPerMinute
        if (!rateLimitEnabled) return null

        val userId = "${ctx.event.platform.metadata.name}:${ctx.senderId}"
        val now = System.currentTimeMillis()

        val timestamps = userTimestamps.getOrPut(userId) {
            LinkedList<Long>().also {
                // 初始化为 synchronized 容器以保证线程安全
            }
        }

        synchronized(timestamps) {
            // 清理过期的时间戳
            while (timestamps.isNotEmpty() && now - timestamps.first > windowMs) {
                timestamps.removeFirst()
            }

            // 检查是否超限
            if (timestamps.size >= rateLimitPerMinute) {
                ctx.stop()
                log("User '$userId' exceeded rate limit ($rateLimitPerMinute/min), stopping pipeline")
                return null
            }

            // 记录本次请求
            timestamps.addLast(now)
        }

        return null
    }

    private fun log(message: String) {
        logger.info { message }
    }
}
