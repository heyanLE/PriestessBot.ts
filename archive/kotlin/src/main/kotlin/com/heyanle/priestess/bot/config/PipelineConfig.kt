package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

/**
 * 消息流水线配置，控制唤醒、白名单、限流和历史消息窗口。
 */
@Serializable
data class PipelineConfig(
    val wakingPrefix: String = "/",
    val whitelistEnabled: Boolean = false,
    val whitelistUsers: List<String> = emptyList(),
    val whitelistGroups: List<String> = emptyList(),
    val rateLimitEnabled: Boolean = true,
    val rateLimitPerMinute: Int = 20,
    val maxHistoryMessages: Int = 50,
)
