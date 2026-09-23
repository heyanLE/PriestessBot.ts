package com.heyanle.priestess.bot.conversation

/**
 * 会话记录，绑定平台会话标识和本地持久化时间信息。
 */
data class Conversation(
    val id: String,
    val platform: String,
    val sessionId: String,
    val createdAt: Long,
    val updatedAt: Long,
    val agentId: String = "",
)
