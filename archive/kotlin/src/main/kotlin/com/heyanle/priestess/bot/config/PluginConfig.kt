package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

/**
 * 插件系统配置，控制插件目录、启停状态和自动发现行为。
 */
@Serializable
data class PluginConfig(
    val enabled: Boolean = true,
    val directory: String = "plugins",
    val autoDiscover: Boolean = true,
)
