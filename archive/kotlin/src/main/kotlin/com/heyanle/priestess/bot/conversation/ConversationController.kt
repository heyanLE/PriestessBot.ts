package com.heyanle.priestess.bot.conversation

import com.heyanle.priestess.bot.core.db.ConversationsTable
import com.heyanle.priestess.bot.core.db.MessagesTable
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.controller.BaseController
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import java.util.UUID
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours

/**
 * 会话模块控制器，负责创建、查询、更新、删除和清理过期会话记录。
 */
class ConversationController(
    private val db: DatabaseCase,
    private val expirationDuration: Duration = 24.hours,
) : BaseController("ConversationController") {

    fun create(platform: String, sessionId: String, agentId: String = ""): Conversation {
        return db.execute {
            val id = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()
            ConversationsTable.insert {
                it[ConversationsTable.id] = id
                it[ConversationsTable.platform] = platform
                it[ConversationsTable.sessionId] = sessionId
                it[ConversationsTable.agentId] = agentId
                it[createdAt] = now
                it[updatedAt] = now
            }
            Conversation(
                id = id,
                platform = platform,
                sessionId = sessionId,
                createdAt = now,
                updatedAt = now,
                agentId = agentId,
            )
        }
    }

    fun findByPlatformSession(platform: String, sessionId: String, agentId: String = ""): Conversation? {
        return db.execute {
            ConversationsTable.selectAll()
                .where { (ConversationsTable.platform eq platform) and (ConversationsTable.sessionId eq sessionId) and (ConversationsTable.agentId eq agentId) }
                .singleOrNull()
                ?.toConversation()
        }
    }

    fun getOrCreate(platform: String, sessionId: String, agentId: String = ""): Conversation {
        return db.execute {
            val existing = ConversationsTable.selectAll()
                .where { (ConversationsTable.platform eq platform) and (ConversationsTable.sessionId eq sessionId) and (ConversationsTable.agentId eq agentId) }
                .singleOrNull()
            if (existing != null) {
                return@execute existing.toConversation()
            }
            val id = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()
            ConversationsTable.insert {
                it[ConversationsTable.id] = id
                it[ConversationsTable.platform] = platform
                it[ConversationsTable.sessionId] = sessionId
                it[ConversationsTable.agentId] = agentId
                it[createdAt] = now
                it[updatedAt] = now
            }
            Conversation(
                id = id,
                platform = platform,
                sessionId = sessionId,
                createdAt = now,
                updatedAt = now,
                agentId = agentId,
            )
        }
    }

    fun updateActivity(id: String) {
        db.execute {
            ConversationsTable.update({ ConversationsTable.id eq id }) {
                it[updatedAt] = System.currentTimeMillis()
            }
        }
    }

    fun delete(id: String) {
        db.execute {
            MessagesTable.deleteWhere { MessagesTable.conversationId eq id }
            ConversationsTable.deleteWhere { ConversationsTable.id eq id }
        }
    }

    fun getAll(): List<Conversation> {
        return db.execute {
            ConversationsTable.selectAll().map { it.toConversation() }
        }
    }

    fun cleanupExpired() {
        db.execute {
            val cutoff = System.currentTimeMillis() - expirationDuration.inWholeMilliseconds
            val expired = ConversationsTable.selectAll()
                .where { ConversationsTable.updatedAt less cutoff }
                .map { it[ConversationsTable.id] }
            for (convId in expired) {
                MessagesTable.deleteWhere { MessagesTable.conversationId eq convId }
                ConversationsTable.deleteWhere { ConversationsTable.id eq convId }
            }
        }
    }

    private fun ResultRow.toConversation(): Conversation {
        return Conversation(
            id = this[ConversationsTable.id],
            platform = this[ConversationsTable.platform],
            sessionId = this[ConversationsTable.sessionId],
            createdAt = this[ConversationsTable.createdAt],
            updatedAt = this[ConversationsTable.updatedAt],
            agentId = this[ConversationsTable.agentId],
        )
    }
}
