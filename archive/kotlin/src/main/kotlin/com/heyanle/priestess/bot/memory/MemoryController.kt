package com.heyanle.priestess.bot.memory

import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.MemoryRecordsTable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.andWhere
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.jetbrains.exposed.sql.lowerCase
import java.util.UUID

/**
 * 记忆控制器，负责记忆记录的持久化、可见性过滤和检索评分。
 */
class MemoryController(
    private val db: DatabaseCase,
) : BaseController("MemoryController") {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

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
        val normalizedContent = content.trim()
        require(normalizedContent.isNotBlank()) { "Memory content must not be blank" }
        validateScope(scope, scopeContext)
        require(scopeContext.allowedScopes == null || scope in scopeContext.allowedScopes) { "Memory scope is not allowed for this context" }
        val normalizedLibrary = libraryId.trim()
        require(normalizedLibrary.isNotBlank() && normalizedLibrary.length <= 128) { "Memory library id must contain 1-128 characters" }
        require(scopeContext.libraryIds == null || normalizedLibrary in scopeContext.libraryIds) { "Memory library is not selected for this context" }
        require(confidence.isFinite()) { "Memory confidence must be finite" }
        val normalizedTags = tags.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        val now = System.currentTimeMillis()
        val record = MemoryRecord(
            id = UUID.randomUUID().toString(),
            workspaceId = scopeContext.workspaceId.ifBlank { MemoryScopeContext.DEFAULT_WORKSPACE_ID },
            scope = scope,
            platformId = scopeContext.platformId,
            sessionId = scopeContext.sessionId,
            userId = scopeContext.userId,
            agentName = scopeContext.agentName,
            type = type,
            content = normalizedContent,
            tags = normalizedTags,
            confidence = confidence.coerceIn(0.0, 1.0),
            createdAt = now,
            updatedAt = now,
            expiresAt = expiresAt,
            libraryId = normalizedLibrary,
        )

        return db.execute {
            MemoryRecordsTable.insert {
                it[id] = record.id
                it[workspaceId] = record.workspaceId
                it[MemoryRecordsTable.libraryId] = record.libraryId
                it[MemoryRecordsTable.scope] = record.scope.name
                it[platformId] = record.platformId
                it[sessionId] = record.sessionId
                it[userId] = record.userId
                it[agentName] = record.agentName
                it[MemoryRecordsTable.type] = record.type.name
                it[MemoryRecordsTable.content] = record.content
                it[MemoryRecordsTable.tags] = json.encodeToString(record.tags)
                it[MemoryRecordsTable.confidence] = record.confidence
                it[createdAt] = record.createdAt
                it[updatedAt] = record.updatedAt
                it[MemoryRecordsTable.expiresAt] = record.expiresAt
                it[MemoryRecordsTable.deletedAt] = record.deletedAt
            }
            record
        }
    }

    fun list(filter: MemoryFilter): List<MemoryRecord> {
        val limit = filter.limit.coerceIn(1, 100)
        return visibleRecords(filter).take(limit)
    }

    private fun visibleRecords(filter: MemoryFilter): List<MemoryRecord> {
        if (filter.scopeContext.libraryIds?.isEmpty() == true) return emptyList()
        val normalizedTag = filter.tag?.trim()?.takeIf { it.isNotBlank() }
        return db.execute {
            MemoryRecordsTable.selectAll()
                .where { MemoryRecordsTable.workspaceId eq filter.scopeContext.workspaceId }
                .apply { filter.scopeContext.libraryIds?.let { ids -> andWhere { MemoryRecordsTable.libraryId inList ids } } }
                .orderBy(MemoryRecordsTable.updatedAt to SortOrder.DESC, MemoryRecordsTable.id to SortOrder.ASC)
                .map { it.toMemoryRecord() }
                .asSequence()
                .filter { filter.includeDeleted || it.deletedAt == null }
                .filter { filter.includeExpired || !it.isExpired(filter.nowMillis) }
                .filter { it.isVisibleTo(filter.scopeContext) }
                .filter { filter.type == null || it.type == filter.type }
                .filter { normalizedTag == null || it.tags.any { tag -> tag.equals(normalizedTag, ignoreCase = true) } }
                .toList()
        }
    }

    fun search(searchQuery: MemorySearchQuery): List<MemorySearchResult> {
        val limit = searchQuery.limit.coerceIn(1, 20)
        val normalizedQuery = searchQuery.query.trim()
        val records = visibleRecords(
            MemoryFilter(
                scopeContext = searchQuery.scopeContext,
                type = searchQuery.type,
                nowMillis = searchQuery.nowMillis,
                limit = 100,
            ),
        ).asSequence()
            .filter { searchQuery.scope == null || it.scope == searchQuery.scope }
            .mapNotNull { score(it, normalizedQuery) }
            .filter { normalizedQuery.isBlank() || it.score > 0.0 }
            .sortedWith(
                compareByDescending<MemorySearchResult> { it.score }
                    .thenByDescending { it.record.updatedAt }
                    .thenBy { it.record.id },
            )
            .take(limit)
            .toList()
        return records
    }

    fun delete(id: String, scopeContext: MemoryScopeContext): Boolean {
        require(id.isNotBlank()) { "Memory id must not be blank" }
        val now = System.currentTimeMillis()
        return db.execute {
            val record = MemoryRecordsTable.selectAll()
                .where {
                    (MemoryRecordsTable.id eq id) and
                        (MemoryRecordsTable.workspaceId eq scopeContext.workspaceId)
                }
                .limit(1)
                .firstOrNull()
                ?.toMemoryRecord()

            if (record == null || record.deletedAt != null || !record.isVisibleTo(scopeContext)) {
                false
            } else {
                MemoryRecordsTable.update({ MemoryRecordsTable.id eq id }) {
                    it[updatedAt] = now
                    it[deletedAt] = now
                } > 0
            }
        }
    }

    fun expire(nowMillis: Long = System.currentTimeMillis()): Int {
        return db.execute {
            val expiredIds = MemoryRecordsTable.selectAll()
                .where { MemoryRecordsTable.deletedAt.isNull() }
                .map { it.toMemoryRecord() }
                .filter { it.isExpired(nowMillis) }
                .map { it.id }

            expiredIds.sumOf { id ->
                MemoryRecordsTable.update({ MemoryRecordsTable.id eq id }) {
                    it[updatedAt] = nowMillis
                    it[deletedAt] = nowMillis
                }
            }
        }
    }

    private fun validateScope(scope: MemoryScope, scopeContext: MemoryScopeContext) {
        require(scopeContext.workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        when (scope) {
            MemoryScope.GLOBAL -> Unit
            MemoryScope.PLATFORM -> require(!scopeContext.platformId.isNullOrBlank()) {
                "PLATFORM memory requires platform id"
            }
            MemoryScope.SESSION -> require(!scopeContext.sessionId.isNullOrBlank()) {
                "SESSION memory requires session id"
            }
            MemoryScope.USER -> require(!scopeContext.userId.isNullOrBlank()) {
                "USER memory requires user id"
            }
            MemoryScope.AGENT -> require(!scopeContext.agentName.isNullOrBlank()) {
                "AGENT memory requires agent name"
            }
        }
    }

    private fun score(record: MemoryRecord, query: String): MemorySearchResult? {
        if (query.isBlank()) {
            return MemorySearchResult(record, record.confidence, "recent memory")
        }
        val queryTokens = tokenize(query)
        if (queryTokens.isEmpty()) return null

        val contentTokens = tokenize(record.content)
        val tagTokens = record.tags.flatMap(::tokenize)
        val contentMatches = queryTokens.count { it in contentTokens }
        val tagMatches = queryTokens.count { it in tagTokens }
        val exactPhrase = record.content.contains(query, ignoreCase = true)
        val score = contentMatches.toDouble() +
            (tagMatches * 1.5) +
            (if (exactPhrase) 2.0 else 0.0) +
            record.confidence

        if (score <= record.confidence) return null
        val reasons = buildList {
            if (exactPhrase) add("exact phrase")
            if (contentMatches > 0) add("$contentMatches content term(s)")
            if (tagMatches > 0) add("$tagMatches tag term(s)")
        }
        return MemorySearchResult(record, score, reasons.joinToString(", "))
    }

    private fun tokenize(value: String): Set<String> {
        return buildSet {
            TOKEN_PATTERN.findAll(value.lowercase()).forEach { match ->
                val token = match.value
                add(token)
                if (Character.UnicodeScript.of(token.codePointAt(0)) == Character.UnicodeScript.HAN) {
                    val points = token.codePoints().toArray()
                    for (index in 0 until points.lastIndex) {
                        add(String(Character.toChars(points[index])) + String(Character.toChars(points[index + 1])))
                    }
                }
            }
        }
    }

    /** Authenticated catalog administration; Agent tools use scope-filtered list/search/delete. */
    fun listLibrary(libraryId: String, query: String = "", limit: Int = 100, offset: Long = 0): List<MemoryRecord> = db.execute {
        MemoryRecordsTable.selectAll().where {
            (MemoryRecordsTable.workspaceId eq "platform") and (MemoryRecordsTable.libraryId eq libraryId) and MemoryRecordsTable.deletedAt.isNull()
        }.apply {
            if (query.isNotBlank()) andWhere { MemoryRecordsTable.content.lowerCase() like "%${query.lowercase()}%" }
        }.orderBy(MemoryRecordsTable.updatedAt, SortOrder.DESC).limit(limit.coerceIn(1, 200), offset.coerceAtLeast(0)).map { it.toMemoryRecord() }
    }

    fun deleteLibraryRecord(libraryId: String, id: String): Boolean = db.execute {
        MemoryRecordsTable.update({
            (MemoryRecordsTable.workspaceId eq "platform") and (MemoryRecordsTable.libraryId eq libraryId) and
                (MemoryRecordsTable.id eq id) and MemoryRecordsTable.deletedAt.isNull()
        }) { it[deletedAt] = System.currentTimeMillis() } > 0
    }

    private fun MemoryRecord.isExpired(nowMillis: Long): Boolean {
        return expiresAt != null && expiresAt <= nowMillis
    }

    private fun MemoryRecord.isVisibleTo(scopeContext: MemoryScopeContext): Boolean {
        if (workspaceId != scopeContext.workspaceId) return false
        if (scopeContext.allowedScopes != null && scope !in scopeContext.allowedScopes) return false
        if (scopeContext.libraryIds != null && libraryId !in scopeContext.libraryIds) return false
        return when (scope) {
            MemoryScope.GLOBAL -> true
            MemoryScope.PLATFORM -> platformId == scopeContext.platformId
            MemoryScope.SESSION -> sessionId == scopeContext.sessionId && (platformId == null || platformId == scopeContext.platformId)
            MemoryScope.USER -> userId == scopeContext.userId && (platformId == null || platformId == scopeContext.platformId)
            MemoryScope.AGENT -> agentName == scopeContext.agentName
        }
    }

    private fun ResultRow.toMemoryRecord(): MemoryRecord {
        return MemoryRecord(
            id = this[MemoryRecordsTable.id],
            workspaceId = this[MemoryRecordsTable.workspaceId],
            libraryId = this[MemoryRecordsTable.libraryId],
            scope = MemoryScope.valueOf(this[MemoryRecordsTable.scope]),
            platformId = this[MemoryRecordsTable.platformId],
            sessionId = this[MemoryRecordsTable.sessionId],
            userId = this[MemoryRecordsTable.userId],
            agentName = this[MemoryRecordsTable.agentName],
            type = MemoryType.valueOf(this[MemoryRecordsTable.type]),
            content = this[MemoryRecordsTable.content],
            tags = json.decodeFromString(this[MemoryRecordsTable.tags]),
            confidence = this[MemoryRecordsTable.confidence],
            createdAt = this[MemoryRecordsTable.createdAt],
            updatedAt = this[MemoryRecordsTable.updatedAt],
            expiresAt = this[MemoryRecordsTable.expiresAt],
            deletedAt = this[MemoryRecordsTable.deletedAt],
        )
    }

    private companion object {
        val TOKEN_PATTERN = Regex("[a-z0-9]+|[\\p{IsHan}]+")
    }
}
