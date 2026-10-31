package com.heyanle.priestess.bot.reminder

import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.ReminderRecordsTable
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.SessionType
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import java.util.UUID

/**
 * 提醒控制器，负责提醒记录的持久化、可见性过滤和到期投递。
 */
class ReminderController(
    private val db: DatabaseCase,
) : BaseController("ReminderController") {
    fun create(
        text: String,
        dueAt: Long,
        scopeContext: ReminderScopeContext,
    ): ReminderRecord {
        val normalizedText = text.trim()
        require(normalizedText.isNotBlank()) { "Reminder text must not be blank" }
        require(scopeContext.workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        require(dueAt > 0) { "Due time must be a positive timestamp" }

        val now = System.currentTimeMillis()
        val record = ReminderRecord(
            id = UUID.randomUUID().toString(),
            workspaceId = scopeContext.workspaceId,
            text = normalizedText,
            dueAt = dueAt,
            status = ReminderStatus.PENDING,
            platformId = scopeContext.platformId,
            sessionId = scopeContext.sessionId,
            sessionType = scopeContext.sessionType,
            userId = scopeContext.userId,
            createdAt = now,
            updatedAt = now,
        )

        return db.execute {
            ReminderRecordsTable.insert {
                it[id] = record.id
                it[workspaceId] = record.workspaceId
                it[ReminderRecordsTable.text] = record.text
                it[ReminderRecordsTable.dueAt] = record.dueAt
                it[status] = record.status.name
                it[platformId] = record.platformId
                it[sessionId] = record.sessionId
                it[sessionType] = record.sessionType?.name
                it[userId] = record.userId
                it[createdAt] = record.createdAt
                it[updatedAt] = record.updatedAt
                it[deliveredAt] = record.deliveredAt
                it[deletedAt] = record.deletedAt
                it[failureReason] = record.failureReason
                it[deliveryAttemptCount] = record.deliveryAttemptCount
            }
            record
        }
    }

    fun list(filter: ReminderFilter): List<ReminderRecord> {
        val limit = filter.limit.coerceIn(1, 100)
        return db.execute {
            ReminderRecordsTable.selectAll()
                .where { ReminderRecordsTable.workspaceId eq filter.scopeContext.workspaceId }
                .orderBy(ReminderRecordsTable.dueAt, SortOrder.ASC)
                .map { it.toReminderRecord() }
                .asSequence()
                .filter { filter.includeDeleted || it.deletedAt == null }
                .filter { it.isVisibleTo(filter.scopeContext) }
                .filter { filter.status == null || it.status == filter.status }
                .filter { filter.dueAfter == null || it.dueAt >= filter.dueAfter }
                .filter { filter.dueBefore == null || it.dueAt <= filter.dueBefore }
                .take(limit)
                .toList()
        }
    }

    fun delete(id: String, scopeContext: ReminderScopeContext): Boolean {
        require(id.isNotBlank()) { "Reminder id must not be blank" }
        val now = System.currentTimeMillis()
        return db.execute {
            val record = ReminderRecordsTable.selectAll()
                .where {
                    (ReminderRecordsTable.id eq id) and
                        (ReminderRecordsTable.workspaceId eq scopeContext.workspaceId)
                }
                .limit(1)
                .firstOrNull()
                ?.toReminderRecord()

            if (record == null || record.deletedAt != null || !record.isVisibleTo(scopeContext)) {
                false
            } else {
                ReminderRecordsTable.update({ ReminderRecordsTable.id eq id }) {
                    it[status] = ReminderStatus.DELETED.name
                    it[updatedAt] = now
                    it[deletedAt] = now
                } > 0
            }
        }
    }

    suspend fun deliverDue(
        platform: Platform,
        nowMillis: Long = System.currentTimeMillis(),
        workspaceId: String? = null,
        messageRenderer: (ReminderRecord) -> String = { "Reminder: ${it.text}" },
    ): ReminderDeliveryResult {
        val due = db.execute {
            ReminderRecordsTable.selectAll()
                .where { ReminderRecordsTable.status eq ReminderStatus.PENDING.name }
                .orderBy(ReminderRecordsTable.dueAt, SortOrder.ASC)
                .map { it.toReminderRecord() }
                .filter { it.dueAt <= nowMillis }
                .filter { it.deletedAt == null }
                .filter { workspaceId == null || it.workspaceId == workspaceId }
                .filter { it.platformId == null || it.platformId == platform.metadata.name }
        }

        var delivered = 0
        var failed = 0
        var skipped = 0
        for (record in due) {
            val sessionId = record.sessionId
            val sessionType = record.sessionType
            if (sessionId.isNullOrBlank() || sessionType == null) {
                markFailed(record.id, nowMillis, "Missing reminder session binding")
                failed++
                continue
            }
            try {
                platform.sendMessage(
                    MessageSession(
                        id = sessionId,
                        type = sessionType,
                        platformName = record.platformId ?: platform.metadata.name,
                    ),
                    MessageChain.text(messageRenderer(record)),
                )
                if (markDelivered(record.id, nowMillis)) {
                    delivered++
                } else {
                    skipped++
                }
            } catch (e: Exception) {
                markFailed(record.id, nowMillis, e.message ?: e::class.simpleName.orEmpty())
                failed++
            }
        }
        return ReminderDeliveryResult(delivered = delivered, failed = failed, skipped = skipped)
    }

    private fun markDelivered(id: String, nowMillis: Long): Boolean {
        return db.execute {
            val attempts = currentAttemptCount(id)
            ReminderRecordsTable.update({
                (ReminderRecordsTable.id eq id) and
                    (ReminderRecordsTable.status eq ReminderStatus.PENDING.name)
            }) {
                it[status] = ReminderStatus.DELIVERED.name
                it[updatedAt] = nowMillis
                it[deliveredAt] = nowMillis
                it[deliveryAttemptCount] = attempts + 1
            } > 0
        }
    }

    private fun markFailed(id: String, nowMillis: Long, reason: String) {
        db.execute {
            val attempts = currentAttemptCount(id)
            ReminderRecordsTable.update({
                (ReminderRecordsTable.id eq id) and
                    (ReminderRecordsTable.status eq ReminderStatus.PENDING.name)
            }) {
                it[status] = ReminderStatus.FAILED.name
                it[updatedAt] = nowMillis
                it[failureReason] = reason.take(500)
                it[deliveryAttemptCount] = attempts + 1
            }
        }
    }

    private fun currentAttemptCount(id: String): Int {
        return ReminderRecordsTable.selectAll()
            .where { ReminderRecordsTable.id eq id }
            .limit(1)
            .firstOrNull()
            ?.get(ReminderRecordsTable.deliveryAttemptCount)
            ?: 0
    }

    private fun ReminderRecord.isVisibleTo(scopeContext: ReminderScopeContext): Boolean {
        if (workspaceId != scopeContext.workspaceId) return false
        if (sessionId != null && sessionId != scopeContext.sessionId) return false
        if (userId != null && userId != scopeContext.userId) return false
        if (platformId != null && platformId != scopeContext.platformId) return false
        return true
    }

    private fun ResultRow.toReminderRecord(): ReminderRecord {
        return ReminderRecord(
            id = this[ReminderRecordsTable.id],
            workspaceId = this[ReminderRecordsTable.workspaceId],
            text = this[ReminderRecordsTable.text],
            dueAt = this[ReminderRecordsTable.dueAt],
            status = ReminderStatus.valueOf(this[ReminderRecordsTable.status]),
            platformId = this[ReminderRecordsTable.platformId],
            sessionId = this[ReminderRecordsTable.sessionId],
            sessionType = this[ReminderRecordsTable.sessionType]?.let { SessionType.valueOf(it) },
            userId = this[ReminderRecordsTable.userId],
            createdAt = this[ReminderRecordsTable.createdAt],
            updatedAt = this[ReminderRecordsTable.updatedAt],
            deliveredAt = this[ReminderRecordsTable.deliveredAt],
            deletedAt = this[ReminderRecordsTable.deletedAt],
            failureReason = this[ReminderRecordsTable.failureReason],
            deliveryAttemptCount = this[ReminderRecordsTable.deliveryAttemptCount],
        )
    }
}
