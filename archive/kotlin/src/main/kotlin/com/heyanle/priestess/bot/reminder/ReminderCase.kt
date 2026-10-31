package com.heyanle.priestess.bot.reminder

import com.heyanle.priestess.bot.platform.Platform

/**
 * 提醒模块门面，向外提供提醒创建、查询、删除和到期投递能力。
 */
class ReminderCase(
    private val controller: ReminderController,
) {
    fun create(text: String, dueAt: Long, scopeContext: ReminderScopeContext): ReminderRecord {
        return controller.create(text, dueAt, scopeContext)
    }

    fun list(filter: ReminderFilter): List<ReminderRecord> = controller.list(filter)

    fun delete(id: String, scopeContext: ReminderScopeContext): Boolean = controller.delete(id, scopeContext)

    suspend fun deliverDue(
        platform: Platform,
        nowMillis: Long = System.currentTimeMillis(),
        workspaceId: String? = null,
    ): ReminderDeliveryResult {
        return controller.deliverDue(platform, nowMillis, workspaceId)
    }
}
