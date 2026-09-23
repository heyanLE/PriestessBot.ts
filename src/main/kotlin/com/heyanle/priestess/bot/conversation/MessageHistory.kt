package com.heyanle.priestess.bot.conversation

import com.heyanle.priestess.bot.core.db.ConversationsTable
import com.heyanle.priestess.bot.core.db.MessagesTable
import com.heyanle.priestess.bot.core.db.DatabaseCase
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * 消息角色，标识历史消息在对话中的来源和用途。
 */
enum class MessageRole(val label: String) {
    USER("user"),
    ASSISTANT("assistant"),
    SYSTEM("system"),
    TOOL("tool"),
}

/**
 * 已持久化消息记录，包含文本、工具调用和写入时间等数据库字段。
 */
data class StoredMessage(
    val id: String,
    val conversationId: String,
    val role: MessageRole,
    val content: String?,
    val toolCalls: String?,
    val toolCallId: String?,
    val createdAt: Long,
)

/**
 * 会话消息搜索条件，用于按会话、平台、角色和时间范围筛选历史消息。
 */
data class ConversationMessageSearchQuery(
    val conversationId: String? = null,
    val platform: String? = null,
    val sessionId: String? = null,
    val query: String = "",
    val role: MessageRole? = null,
    val sinceMillis: Long? = null,
    val untilMillis: Long? = null,
    val limit: Int = 20,
)

/**
 * 会话消息搜索结果，聚合命中的消息、所属会话和展示片段。
 */
data class ConversationSearchResult(
    val message: StoredMessage,
    val conversation: Conversation,
    val snippet: String,
)

/**
 * 消息历史仓库，负责写入、读取、搜索和删除会话消息记录。
 */
class MessageHistory(
    private val db: DatabaseCase,
) {
    private val lastStoredAt = AtomicLong(0L)

    fun store(
        conversationId: String,
        role: MessageRole,
        content: String? = null,
        toolCalls: String? = null,
        toolCallId: String? = null,
    ): StoredMessage {
        return db.execute {
            val id = UUID.randomUUID().toString()
            val now = nextStoredAt()
            MessagesTable.insert {
                it[MessagesTable.id] = id
                it[MessagesTable.conversationId] = conversationId
                it[MessagesTable.role] = role.label
                it[MessagesTable.content] = content
                it[MessagesTable.toolCalls] = toolCalls
                it[MessagesTable.toolCallId] = toolCallId
                it[createdAt] = now
            }
            StoredMessage(id, conversationId, role, content, toolCalls, toolCallId, now)
        }
    }

    private fun nextStoredAt(): Long {
        return lastStoredAt.updateAndGet { previous ->
            val current = System.currentTimeMillis()
            if (current > previous) current else previous + 1
        }
    }

    fun getByConversation(conversationId: String, limit: Int? = null): List<StoredMessage> {
        return db.execute {
            MessagesTable.selectAll()
                .where { MessagesTable.conversationId eq conversationId }
                .orderBy(MessagesTable.createdAt, SortOrder.ASC)
                .let { query ->
                    if (limit != null) query.limit(limit) else query
                }
                .map { it.toStoredMessage() }
        }
    }

    fun getRecentMessages(conversationId: String, count: Int): List<StoredMessage> {
        return db.execute {
            MessagesTable.selectAll()
                .where { MessagesTable.conversationId eq conversationId }
                .orderBy(MessagesTable.createdAt, SortOrder.DESC)
                .limit(count)
                .map { it.toStoredMessage() }
                .reversed()
        }
    }

    fun clear(conversationId: String) {
        db.execute {
            MessagesTable.deleteWhere { MessagesTable.conversationId eq conversationId }
        }
    }

    fun search(searchQuery: ConversationMessageSearchQuery): List<ConversationSearchResult> {
        val limit = searchQuery.limit.coerceIn(1, 50)
        val normalizedQuery = searchQuery.query.trim()
        return db.execute {
            val joined = MessagesTable
                .innerJoin(ConversationsTable)
                .selectAll()
                .apply {
                    searchQuery.conversationId?.takeIf { it.isNotBlank() }?.let { id ->
                        where { MessagesTable.conversationId eq id }
                    }
                }

            joined
                .orderBy(MessagesTable.createdAt, SortOrder.DESC)
                .map { row -> row.toSearchResult() }
                .asSequence()
                .filter { result ->
                    searchQuery.platform.isNullOrBlank() || result.conversation.platform == searchQuery.platform
                }
                .filter { result ->
                    searchQuery.sessionId.isNullOrBlank() || result.conversation.sessionId == searchQuery.sessionId
                }
                .filter { result ->
                    searchQuery.role == null || result.message.role == searchQuery.role
                }
                .filter { result ->
                    searchQuery.sinceMillis == null || result.message.createdAt >= searchQuery.sinceMillis
                }
                .filter { result ->
                    searchQuery.untilMillis == null || result.message.createdAt <= searchQuery.untilMillis
                }
                .filter { result ->
                    normalizedQuery.isBlank() || result.message.content.orEmpty().contains(normalizedQuery, ignoreCase = true)
                }
                .take(limit)
                .map { result ->
                    result.copy(snippet = snippet(result.message.content.orEmpty(), normalizedQuery))
                }
                .toList()
                .asReversed()
        }
    }

    fun deleteByConversation(conversationId: String) {
        db.execute {
            MessagesTable.deleteWhere { MessagesTable.conversationId eq conversationId }
        }
    }

    private fun ResultRow.toStoredMessage(): StoredMessage {
        val roleStr = this[MessagesTable.role]
        val role = MessageRole.entries.find { it.label == roleStr }
            ?: throw IllegalStateException("Unknown message role: $roleStr")
        return StoredMessage(
            id = this[MessagesTable.id],
            conversationId = this[MessagesTable.conversationId],
            role = role,
            content = this[MessagesTable.content],
            toolCalls = this[MessagesTable.toolCalls],
            toolCallId = this[MessagesTable.toolCallId],
            createdAt = this[MessagesTable.createdAt],
        )
    }

    private fun ResultRow.toSearchResult(): ConversationSearchResult {
        return ConversationSearchResult(
            message = toStoredMessage(),
            conversation = Conversation(
                id = this[ConversationsTable.id],
                platform = this[ConversationsTable.platform],
                sessionId = this[ConversationsTable.sessionId],
                createdAt = this[ConversationsTable.createdAt],
                updatedAt = this[ConversationsTable.updatedAt],
                agentId = this[ConversationsTable.agentId],
            ),
            snippet = "",
        )
    }

    private fun snippet(content: String, query: String): String {
        if (content.isBlank()) return ""
        if (query.isBlank()) return content.take(240)
        val index = content.indexOf(query, ignoreCase = true).coerceAtLeast(0)
        val start = (index - 80).coerceAtLeast(0)
        val end = (index + query.length + 160).coerceAtMost(content.length)
        val prefix = if (start > 0) "..." else ""
        val suffix = if (end < content.length) "..." else ""
        return prefix + content.substring(start, end) + suffix
    }
}
