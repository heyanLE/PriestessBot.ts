package com.heyanle.priestess.bot.provider.model

import kotlinx.serialization.Serializable

/**
 * 提供给模型的对话消息，兼容 system/user/assistant/tool 等角色。
 */
@Serializable
data class ConversationMessage(
    val role: String,
    val content: String? = null,
    val toolCalls: List<ToolCall>? = null,
    val toolCallId: String? = null,
    val name: String? = null,
) {
    companion object {
        fun system(content: String) = ConversationMessage(role = "system", content = content)
        fun user(content: String) = ConversationMessage(role = "user", content = content)
        fun assistant(content: String, toolCalls: List<ToolCall>? = null) = ConversationMessage(role = "assistant", content = content, toolCalls = toolCalls)
        fun tool(toolCallId: String, name: String, content: String) = ConversationMessage(role = "tool", content = content, toolCallId = toolCallId, name = name)
    }
}
