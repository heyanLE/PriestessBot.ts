package com.heyanle.priestess.bot.core.db

import com.heyanle.priestess.bot.core.controller.BaseController
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SchemaUtils
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.transactions.TransactionManager
import org.jetbrains.exposed.sql.transactions.transaction
import java.sql.Connection
import java.sql.DriverManager
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * 会话表，保存平台会话维度的对话索引。
 */
object ConversationsTable : Table("conversations") {
    val id = varchar("id", 64)
    val platform = varchar("platform", 32)
    val sessionId = varchar("session_id", 128)
    val agentId = varchar("agent_id", 128).default("")
    val createdAt = long("created_at")
    val updatedAt = long("updated_at")

    override val primaryKey = PrimaryKey(id)
}

/**
 * 消息表，保存对话中的用户、助手和工具消息。
 */
object MessagesTable : Table("messages") {
    val id = varchar("id", 64)
    val conversationId = varchar("conversation_id", 64) references ConversationsTable.id
    val role = varchar("role", 16)
    val content = text("content").nullable()
    val toolCalls = text("tool_calls").nullable()
    val toolCallId = varchar("tool_call_id", 64).nullable()
    val createdAt = long("created_at")

    override val primaryKey = PrimaryKey(id)
}

/**
 * 知识库表，保存知识库元信息。
 */
object KnowledgeBasesTable : Table("knowledge_bases") {
    val id = varchar("id", 64)
    val name = varchar("name", 128)
    val description = text("description")
    val createdAt = long("created_at")
    val updatedAt = long("updated_at")

    override val primaryKey = PrimaryKey(id)
}

/**
 * 知识片段表，保存知识库拆分后的文本内容。
 */
object KnowledgeChunksTable : Table("knowledge_chunks") {
    val id = varchar("id", 64)
    val knowledgeBaseId = varchar("knowledge_base_id", 64) references KnowledgeBasesTable.id
    val documentName = varchar("document_name", 256)
    val content = text("content")
    val createdAt = long("created_at")

    override val primaryKey = PrimaryKey(id)
}

/**
 * 记忆记录表，保存不同作用域下的长期记忆。
 */
object MemoryRecordsTable : Table("memory_records") {
    val id = varchar("id", 64)
    val libraryId = varchar("library_id", 128).default("default")
    val workspaceId = varchar("workspace_id", 128)
    val scope = varchar("scope", 32)
    val platformId = varchar("platform_id", 128).nullable()
    val sessionId = varchar("session_id", 128).nullable()
    val userId = varchar("user_id", 128).nullable()
    val agentName = varchar("agent_name", 128).nullable()
    val type = varchar("type", 32)
    val content = text("content")
    val tags = text("tags")
    val confidence = double("confidence")
    val createdAt = long("created_at")
    val updatedAt = long("updated_at")
    val expiresAt = long("expires_at").nullable()
    val deletedAt = long("deleted_at").nullable()

    override val primaryKey = PrimaryKey(id)
}

/**
 * 人设表，保存工作区内可启用的人设配置。
 */
object PersonasTable : Table("personas") {
    val id = varchar("id", 64)
    val workspaceId = varchar("workspace_id", 128)
    val name = varchar("name", 128)
    val description = text("description")
    val tone = text("tone")
    val boundaries = text("boundaries")
    val systemPromptTemplate = text("system_prompt_template")
    val exampleDialogs = text("example_dialogs").default("[]")
    val enabled = bool("enabled")
    val agentNames = text("agent_names")
    val errorMessages = text("error_messages").default("{}")
    val createdAt = long("created_at")
    val updatedAt = long("updated_at")
    val deletedAt = long("deleted_at").nullable()

    override val primaryKey = PrimaryKey(id)
}

/**
 * 提醒记录表，保存待投递和已投递的提醒任务。
 */
object ReminderRecordsTable : Table("reminder_records") {
    val id = varchar("id", 64)
    val workspaceId = varchar("workspace_id", 128)
    val text = text("text")
    val dueAt = long("due_at")
    val status = varchar("status", 32)
    val platformId = varchar("platform_id", 128).nullable()
    val sessionId = varchar("session_id", 128).nullable()
    val sessionType = varchar("session_type", 32).nullable()
    val userId = varchar("user_id", 128).nullable()
    val createdAt = long("created_at")
    val updatedAt = long("updated_at")
    val deliveredAt = long("delivered_at").nullable()
    val deletedAt = long("deleted_at").nullable()
    val failureReason = text("failure_reason").nullable()
    val deliveryAttemptCount = integer("delivery_attempt_count")

    override val primaryKey = PrimaryKey(id)
}

/**
 * 数据库控制器，负责持有 Exposed 数据库连接、初始化表结构并承接数据库模块生命周期。
 */
class DatabaseController(private val dbPath: String) : BaseController("DatabaseController"), AppDatabase {

    @Volatile
    private var exposedDb: Database? = null
    private var keepAliveConnection: Connection? = null
    private val lock = ReentrantLock()

    init {
        openBlocking()
    }

    override suspend fun open() {
        openBlocking()
    }

    private fun openBlocking() {
        lock.withLock {
            if (exposedDb != null) return
            keepAliveConnection = openKeepAliveConnectionIfNeeded()
            val db = Database.connect(
                url = "jdbc:sqlite:$dbPath",
                driver = "org.sqlite.JDBC",
            )
            exposedDb = db
            transaction(db) {
                SchemaUtils.createMissingTablesAndColumns(
                    ConversationsTable,
                    MessagesTable,
                    KnowledgeBasesTable,
                    KnowledgeChunksTable,
                    MemoryRecordsTable,
                    PersonasTable,
                    ReminderRecordsTable,
                )
            }
        }
    }

    override suspend fun close() {
        lock.withLock {
            val db = exposedDb ?: return
            try {
                TransactionManager.closeAndUnregister(db)
            } finally {
                exposedDb = null
                keepAliveConnection?.close()
                keepAliveConnection = null
            }
        }
    }

    override suspend fun stop() {
        close()
        super.stop()
    }

    fun <T> execute(block: () -> T): T {
        lock.withLock {
            val db = exposedDb
                ?: throw IllegalStateException("Database not open. Call open() first.")
            return transaction(db) { block() }
        }
    }

    private fun openKeepAliveConnectionIfNeeded(): Connection? {
        if (!dbPath.contains("mode=memory", ignoreCase = true)) return null
        if (!dbPath.contains("cache=shared", ignoreCase = true)) return null
        return DriverManager.getConnection("jdbc:sqlite:$dbPath")
    }
}
