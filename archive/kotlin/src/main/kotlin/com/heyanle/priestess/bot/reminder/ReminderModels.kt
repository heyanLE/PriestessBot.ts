package com.heyanle.priestess.bot.reminder

import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.Serializable

/**
 * 提醒状态，描述提醒从待投递到完成或删除的生命周期。
 */
@Serializable
enum class ReminderStatus {
    PENDING,
    DELIVERED,
    FAILED,
    DELETED,
}

/**
 * 提醒记录，保存提醒文本、到期时间、目标会话和投递结果。
 */
@Serializable
data class ReminderRecord(
    val id: String,
    val workspaceId: String,
    val text: String,
    val dueAt: Long,
    val status: ReminderStatus,
    val platformId: String? = null,
    val sessionId: String? = null,
    val sessionType: SessionType? = null,
    val userId: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deliveredAt: Long? = null,
    val deletedAt: Long? = null,
    val failureReason: String? = null,
    val deliveryAttemptCount: Int = 0,
)

/**
 * 提醒作用域上下文，用于限定提醒对当前工作区、平台、会话或用户可见。
 */
data class ReminderScopeContext(
    val workspaceId: String = MemoryScopeContext.DEFAULT_WORKSPACE_ID,
    val platformId: String? = null,
    val sessionId: String? = null,
    val sessionType: SessionType? = null,
    val userId: String? = null,
)

/**
 * 提醒列表过滤条件，用于按作用域、状态和到期时间筛选提醒。
 */
data class ReminderFilter(
    val scopeContext: ReminderScopeContext,
    val status: ReminderStatus? = null,
    val dueAfter: Long? = null,
    val dueBefore: Long? = null,
    val includeDeleted: Boolean = false,
    val limit: Int = 50,
)

/**
 * 提醒投递结果，统计一次到期投递中的成功、失败和跳过数量。
 */
data class ReminderDeliveryResult(
    val delivered: Int,
    val failed: Int,
    val skipped: Int,
)
