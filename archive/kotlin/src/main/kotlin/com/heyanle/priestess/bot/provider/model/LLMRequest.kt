package com.heyanle.priestess.bot.provider.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * 大模型请求，包含模型名、对话消息、工具定义和生成参数。
 */
@Serializable
data class LLMRequest(
    val model: String = "",
    val messages: List<ConversationMessage> = emptyList(),
    val tools: List<JsonObject> = emptyList(),
    val temperature: Double = 0.7,
    val maxTokens: Int? = null,
    val stream: Boolean = false,
)
