package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/**
 * 模型提供商配置，描述一个 LLM 后端实例的类型、模型、地址、密钥和扩展参数。
 */
@Serializable
data class ProviderConfig(
    val name: String = "",
    val type: String = "",
    val model: String = "",
    val baseUrl: String = "",
    val apiKey: String = "",
    val enabled: Boolean = true,
    val config: Map<String, String> = emptyMap(),
    /** Runtime-only compatibility switch: v2 credentials were already resolved by the compiler. */
    @Transient
    val credentialResolved: Boolean = false,
) {
    fun resolveApiKey(): String = apiKey
}
