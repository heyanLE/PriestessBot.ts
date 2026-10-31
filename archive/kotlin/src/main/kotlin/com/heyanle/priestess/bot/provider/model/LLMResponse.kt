package com.heyanle.priestess.bot.provider.model

import kotlinx.serialization.Serializable

/**
 * 大模型响应，包含文本内容、工具调用、结束原因和 token 用量。
 */
@Serializable
data class LLMResponse(
    val content: String = "",
    val toolCalls: List<ToolCall> = emptyList(),
    val finishReason: String = "",
    val tokenUsage: TokenUsage = TokenUsage(),
) {
    fun hasToolCalls(): Boolean = toolCalls.isNotEmpty()
}

/**
 * 模型请求的工具调用，保存调用标识、工具名和 JSON 参数。
 */
@Serializable
data class ToolCall(
    val id: String = "",
    val name: String = "",
    val arguments: String = "", // JSON string
)

/**
 * 模型 token 用量统计。
 */
@Serializable
data class TokenUsage(
    val promptTokens: Int = 0,
    val completionTokens: Int = 0,
    val totalTokens: Int = 0,
)
