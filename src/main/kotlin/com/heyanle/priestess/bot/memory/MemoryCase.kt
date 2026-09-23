package com.heyanle.priestess.bot.memory

/**
 * 记忆模块门面，向外提供记忆保存、查询、检索和删除能力。
 */
class MemoryCase(
    private val controller: MemoryController,
) {
    fun save(
        content: String,
        type: MemoryType,
        scope: MemoryScope,
        scopeContext: MemoryScopeContext,
        tags: List<String> = emptyList(),
        confidence: Double = 1.0,
        expiresAt: Long? = null,
        libraryId: String = "default",
    ): MemoryRecord {
        return controller.save(
            content = content,
            type = type,
            scope = scope,
            scopeContext = scopeContext,
            tags = tags,
            confidence = confidence,
            expiresAt = expiresAt,
            libraryId = libraryId,
        )
    }

    fun list(filter: MemoryFilter): List<MemoryRecord> = controller.list(filter)

    fun search(searchQuery: MemorySearchQuery): List<MemorySearchResult> = controller.search(searchQuery)

    fun delete(id: String, scopeContext: MemoryScopeContext): Boolean = controller.delete(id, scopeContext)

    fun expire(nowMillis: Long = System.currentTimeMillis()): Int = controller.expire(nowMillis)
    fun listLibrary(libraryId: String, query: String = "", limit: Int = 100, offset: Long = 0): List<MemoryRecord> = controller.listLibrary(libraryId, query, limit, offset)
    fun deleteLibraryRecord(libraryId: String, id: String): Boolean = controller.deleteLibraryRecord(libraryId, id)
}
