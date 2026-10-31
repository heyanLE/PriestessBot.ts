package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

/**
 * 平台接入配置，描述一个聊天平台实例的类型、连接参数和扩展配置。
 */
@Serializable
data class PlatformConfig(
    val name: String = "",
    val type: String = "",
    val enabled: Boolean = true,
    val host: String = "127.0.0.1",
    val port: Int = 3000,
    val wsPort: Int = 3001,
    val token: String = "",
    val baseUrl: String = "",
    val useWs: Boolean = true,
    val config: Map<String, String> = emptyMap(),
)
