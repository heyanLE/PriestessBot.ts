package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

/**
 * Dashboard 服务端配置，控制监听地址、端口、跨域、配置热加载和接口令牌。
 */
@Serializable
data class ServerConfig(
    val enabled: Boolean = false,
    val host: String = "0.0.0.0",
    val port: Int = 8080,
    val corsEnabled: Boolean = true,
    val configWatchEnabled: Boolean = false,
    val configWatchIntervalMillis: Long = 2_000,
    val apiToken: String = "",
)
