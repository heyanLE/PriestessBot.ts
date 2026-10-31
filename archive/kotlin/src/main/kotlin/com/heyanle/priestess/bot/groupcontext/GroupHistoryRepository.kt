package com.heyanle.priestess.bot.groupcontext

import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.GroupMessagesTable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.less
import org.jetbrains.exposed.sql.SqlExpressionBuilder.lessEq

data class ArchivedGroupMessage(
    val id: Long,
    val platformId: String,
    val groupId: String,
    val messageId: String?,
    val role: String,
    val senderId: String?,
    val senderName: String?,
    val content: String,
    val createdAt: Long,
)

/** Durable group history is scoped to the concrete IM connection and group. */
class GroupHistoryRepository(private val database: DatabaseCase) {
    fun append(
        platformId: String,
        groupId: String,
        messageId: String?,
        role: String,
        senderId: String?,
        senderName: String?,
        content: String,
        createdAt: Long,
        maxMessages: Int,
    ): Long = database.execute {
        val id = GroupMessagesTable.insert {
            it[GroupMessagesTable.platformId] = platformId
            it[GroupMessagesTable.groupId] = groupId
            it[GroupMessagesTable.messageId] = messageId
            it[GroupMessagesTable.role] = role
            it[GroupMessagesTable.senderId] = senderId
            it[GroupMessagesTable.senderName] = senderName
            it[GroupMessagesTable.content] = content
            it[GroupMessagesTable.createdAt] = createdAt
        }[GroupMessagesTable.id]
        val scope = (GroupMessagesTable.platformId eq platformId) and (GroupMessagesTable.groupId eq groupId)
        val firstOverLimit = GroupMessagesTable.selectAll().where { scope }
            .orderBy(GroupMessagesTable.id, SortOrder.DESC)
            .limit(1, maxMessages.toLong())
            .firstOrNull()?.get(GroupMessagesTable.id)
        if (firstOverLimit != null) {
            GroupMessagesTable.deleteWhere { scope and (GroupMessagesTable.id lessEq firstOverLimit) }
        }
        id
    }

    fun search(
        platformId: String,
        groupId: String,
        beforeId: Long?,
        keyword: String,
        sender: String,
        limit: Int,
        maxScan: Int,
    ): List<ArchivedGroupMessage> = database.execute {
        val scope = (GroupMessagesTable.platformId eq platformId) and (GroupMessagesTable.groupId eq groupId)
        GroupMessagesTable.selectAll()
            .where { if (beforeId == null) scope else scope and (GroupMessagesTable.id less beforeId) }
            .orderBy(GroupMessagesTable.id, SortOrder.DESC)
            .limit(maxScan)
            .map { row ->
                ArchivedGroupMessage(
                    id = row[GroupMessagesTable.id],
                    platformId = row[GroupMessagesTable.platformId],
                    groupId = row[GroupMessagesTable.groupId],
                    messageId = row[GroupMessagesTable.messageId],
                    role = row[GroupMessagesTable.role],
                    senderId = row[GroupMessagesTable.senderId],
                    senderName = row[GroupMessagesTable.senderName],
                    content = row[GroupMessagesTable.content],
                    createdAt = row[GroupMessagesTable.createdAt],
                )
            }
            .asSequence()
            .filter { keyword.isBlank() || it.content.contains(keyword, ignoreCase = true) }
            .filter {
                sender.isBlank() || it.senderId.orEmpty().contains(sender, ignoreCase = true) ||
                    it.senderName.orEmpty().contains(sender, ignoreCase = true)
            }
            .take(limit)
            .toList()
            .reversed()
    }
}
