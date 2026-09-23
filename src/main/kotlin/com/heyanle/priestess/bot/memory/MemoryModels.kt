package com.heyanle.priestess.bot.memory

import kotlinx.serialization.Serializable

/**
 * 记忆作用域，描述一条记忆对哪些上下文可见。
 */
@Serializable
enum class MemoryScope {
    GLOBAL,
    PLATFORM,
    SESSION,
    USER,
    AGENT,
}

/**
 * 记忆类型，描述记忆内容的业务分类。
 */
@Serializable
enum class MemoryType {
    FACT,
    PREFERENCE,
    EVENT,
    SUMMARY,
}

/**
 * 记忆记录，保存可检索的长期上下文内容及其作用域信息。
 */
@Serializable
data class MemoryRecord(
    val id: String,
    val workspaceId: String,
    val scope: MemoryScope,
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val agentName: String? = null,
    val type: MemoryType,
    val content: String,
    val tags: List<String> = emptyList(),
    val confidence: Double = 1.0,
    val createdAt: Long,
    val updatedAt: Long,
    val expiresAt: Long? = null,
    val deletedAt: Long? = null,
    val libraryId: String = "default",
)

/**
 * 记忆作用域上下文，用于判断记录是否对当前会话或用户可见。
 */
data class MemoryScopeContext(
    val workspaceId: String = DEFAULT_WORKSPACE_ID,
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val agentName: String? = null,
    /** null is an administrative cross-library query; an empty set grants no library access. */
    val libraryIds: Set<String>? = null,
    /** null leaves scope policy unrestricted; an empty set makes every scope unavailable. */
    val allowedScopes: Set<MemoryScope>? = null,
) {
    companion object {
        const val DEFAULT_WORKSPACE_ID = "default"
    }
}

/**
 * 记忆列表过滤条件，用于按上下文、类型、标签和状态筛选记录。
 */
data class MemoryFilter(
    val scopeContext: MemoryScopeContext,
    val type: MemoryType? = null,
    val tag: String? = null,
    val includeExpired: Boolean = false,
    val includeDeleted: Boolean = false,
    val nowMillis: Long = System.currentTimeMillis(),
    val limit: Int = 50,
)

/**
 * 记忆检索请求，描述检索关键词、上下文和结果限制。
 */
data class MemorySearchQuery(
    val query: String,
    val scopeContext: MemoryScopeContext,
    val scope: MemoryScope? = null,
    val type: MemoryType? = null,
    val limit: Int = 10,
    val nowMillis: Long = System.currentTimeMillis(),
)

/**
 * 记忆检索结果，包含命中的记录、得分和匹配原因。
 */
@Serializable
data class MemorySearchResult(
    val record: MemoryRecord,
    val score: Double,
    val matchReason: String,
)
