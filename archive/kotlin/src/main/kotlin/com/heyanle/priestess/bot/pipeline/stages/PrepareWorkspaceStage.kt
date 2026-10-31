package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.config.resolve.WorkspaceSelectionContext
import com.heyanle.priestess.bot.config.resolve.WorkspaceSelector
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder

/** Selects only catalog-registered Workspaces from the already-pinned v2 snapshot. */
class PrepareWorkspaceStage(
    private val workspaceSelector: WorkspaceSelector = WorkspaceSelector(),
) : Stage {
    override val name = "PrepareWorkspace"
    override val order = StageOrder.PREPARE_WORKSPACE

    override suspend fun process(ctx: PipelineContext): kotlinx.coroutines.flow.Flow<Unit>? {
        val effective = checkNotNull(ctx.effectiveRuntimeSnapshot) { "Effective configuration was not pinned" }
        if (effective.application != null) {
            val agentId = ctx.selectedAgentId ?: return null
            val unit = effective.workspaces[agentId]
            if (unit == null) {
                reject(ctx, "AGENT_UNAVAILABLE", "Selected Agent '$agentId' is unavailable")
            } else {
                ctx.pinEffectiveWorkspace(unit, "IM route", ctx.imRoute?.route?.id)
            }
            return null
        }
        val metadata = ctx.event.session.metadata
        if (!metadata["workspaceDir"].isNullOrBlank()) {
            reject(ctx, "WORKSPACE_DIRECTORY_OVERRIDE_REJECTED", "Message metadata cannot select a Workspace directory")
            return null
        }
        val platformId = ctx.event.platform.metadata.name
        val selection = workspaceSelector.select(
            effective.workspaceCatalog,
            WorkspaceSelectionContext(
                explicitWorkspaceId = metadata["workspaceId"] ?: metadata["workspace_id"],
                platformId = platformId,
                platformDefaultWorkspaceId = effective.platforms[platformId]?.defaultWorkspaceId,
                sessionId = ctx.event.session.id,
                userId = ctx.senderId,
                groupId = metadata["groupId"] ?: metadata["group_id"].orEmpty(),
            ),
        )
        if (!selection.isSuccess) {
            val diagnostic = selection.diagnostics.first()
            ctx.shared["configurationDiagnostics"] = selection.diagnostics
            reject(ctx, diagnostic.code, diagnostic.message)
            return null
        }
        val entry = checkNotNull(selection.entry)
        val workspace = effective.workspaces[entry.id]
        if (workspace == null) {
            reject(ctx, "WORKSPACE_EFFECTIVE_SNAPSHOT_MISSING", "Workspace '${entry.id}' has no active snapshot")
            return null
        }
        ctx.pinEffectiveWorkspace(workspace, selection.reason, selection.ruleId)
        return null
    }

    private fun reject(ctx: PipelineContext, code: String, message: String) {
        System.err.println("[PIPELINE-107] $code: $message")
        ctx.directResponse = "Configuration error: $message"
        ctx.stop()
    }
}
