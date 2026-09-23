package com.heyanle.priestess.bot.conversation

/**
 * 会话模块门面，协调会话记录和消息历史供流水线、服务端与工具模块使用。
 */
class ConversationCase(
    private val controller: ConversationController,
    private val history: MessageHistory,
) {
    fun getOrCreate(platform: String, sessionId: String, agentId: String = ""): Conversation {
        return controller.getOrCreate(platform, sessionId, agentId)
    }

    fun updateActivity(id: String) {
        controller.updateActivity(id)
    }

    fun getRecentMessages(conversationId: String, count: Int): List<StoredMessage> {
        return history.getRecentMessages(conversationId, count)
    }

    fun getAll(): List<Conversation> {
        return controller.getAll()
    }

    fun clearHistory(platform: String, sessionId: String): Conversation {
        val conversation = controller.getOrCreate(platform, sessionId)
        controller.getAll().filter { it.platform == platform && it.sessionId == sessionId }.forEach { history.clear(it.id) }
        controller.updateActivity(conversation.id)
        return conversation
    }

    fun getMessages(conversationId: String, count: Int = 100): List<StoredMessage> {
        return history.getRecentMessages(conversationId, count)
    }

    fun searchMessages(query: ConversationMessageSearchQuery): List<ConversationSearchResult> {
        return history.search(query)
    }

    fun storeMessage(
        conversationId: String,
        role: MessageRole,
        content: String? = null,
        toolCalls: String? = null,
        toolCallId: String? = null,
    ): StoredMessage {
        return history.store(conversationId, role, content, toolCalls, toolCallId)
    }
}
