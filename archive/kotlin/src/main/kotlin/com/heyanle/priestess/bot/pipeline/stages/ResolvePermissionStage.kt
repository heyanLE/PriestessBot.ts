package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.PermissionResolver
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder

class ResolvePermissionStage(
    private val permissionResolver: PermissionResolver,
) : Stage {
    override val name: String = "ResolvePermission"
    override val order: StageOrder = StageOrder.RESOLVE_PERMISSION

    override suspend fun process(ctx: PipelineContext) = run {
        if (ctx.imRoute != null) return@run null
        if (ctx.effectiveRuntimeSnapshot?.application != null && ctx.event.platform.metadata.name == "dashboard") return@run null
        val effective = ctx.effectiveRuntimeSnapshot?.runtime?.permission
        ctx.permissionGroup = if (effective == null) {
            permissionResolver.resolve(ctx.senderId)
        } else {
            val senderId = ctx.senderId.trim()
            when {
                senderId.isNotBlank() && effective.superAdminIds.any { it.trim() == senderId } -> PermissionGroup.SUPER_ADMIN
                senderId.isNotBlank() && effective.adminIds.any { it.trim() == senderId } -> PermissionGroup.ADMIN
                else -> PermissionGroup.OPERATOR
            }
        }
        null
    }
}
