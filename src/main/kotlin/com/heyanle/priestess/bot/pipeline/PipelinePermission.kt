package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.config.PermissionConfig

enum class PermissionGroup {
    /** 普通干员：允许使用常规读取和低风险会话能力。 */
    OPERATOR,
    /** 资深干员：允许使用显式启用的写入和管理能力。 */
    ADMIN,
    /** 超级管理员：包含全部下级权限。 */
    SUPER_ADMIN;

    fun satisfies(required: PermissionGroup): Boolean = ordinal >= required.ordinal
}

class PermissionResolver(
    private val configProvider: () -> PermissionConfig,
) {
    fun resolve(senderId: String): PermissionGroup {
        val normalized = senderId.trim()
        val config = configProvider()
        if (normalized.isNotBlank() && normalized in config.superAdminIds.normalizedIds()) {
            return PermissionGroup.SUPER_ADMIN
        }
        if (normalized.isNotBlank() && normalized in config.adminIds.normalizedIds()) {
            return PermissionGroup.ADMIN
        }
        return PermissionGroup.OPERATOR
    }

    private fun List<String>.normalizedIds(): Set<String> =
        asSequence().map(String::trim).filter(String::isNotBlank).toSet()
}

data class PermissionMessageContext(
    val workspaceId: String = "",
    val agentName: String = "",
)

fun interface PermissionDeniedMessageResolver {
    fun resolve(context: PermissionMessageContext): String

    companion object {
        const val DEFAULT_MESSAGE = "抱歉，当前权限不足，无法执行此操作。"

        val Default = PermissionDeniedMessageResolver { DEFAULT_MESSAGE }
    }
}
