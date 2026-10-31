package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.pipeline.*
import com.heyanle.priestess.bot.config.model.ImRouteActionType
import com.heyanle.priestess.bot.groupcontext.GroupContextCase
import com.heyanle.priestess.bot.observability.trace.TraceCategory
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import io.github.oshai.kotlinlogging.KotlinLogging

/** Only the first matched IM route can activate a model or a built-in command. */
class ImRouteStage(
    private val router: ImRouter = ImRouter(),
    private val executions: com.heyanle.priestess.bot.observability.trace.ExecutionTraceController? = null,
    private val groupContext: GroupContextCase? = null,
) : Stage {
    private val logger = KotlinLogging.logger {}
    override val name = "IM route"
    override val order = StageOrder.IM_ROUTE

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        val application = ctx.effectiveRuntimeSnapshot?.application ?: return null
        if (ctx.event.platform.metadata.name == "dashboard") {
            ctx.permissionGroup = PermissionGroup.SUPER_ADMIN
            val requested = ctx.event.session.metadata["agentId"]
            ctx.selectedAgentId = application.agents.firstOrNull { it.enabled && (requested == null || it.id == requested) }?.id
            if (ctx.selectedAgentId == null) {
                ctx.directResponse = "请先配置并启用一个 Agent。"
                ctx.stop()
            }
            if (!ctx.isStopped) startTrace(ctx)
            return null
        }
        val im = application.ims.firstOrNull { it.enabled && it.id == ctx.event.platform.metadata.name }
        ctx.groupCapture = if (im != null) runCatching { groupContext?.capture(ctx.event, im.groupContext) }
            .onFailure { logger.warn(it) { "Could not capture group context for IM '${im.id}'" } }
            .getOrNull() else null
        val decision = im?.let { router.match(it, ctx.event) }
        ctx.imRoute = decision
        if (decision == null) {
            ctx.executionTrace?.record(TraceCategory.IM, "route.unmatched", buildJsonObject { put("imId", ctx.event.platform.metadata.name) })
            ctx.stop()
            return null
        }
        ctx.permissionGroup = decision.permissionGroup
        if (decision.route.action.type == ImRouteActionType.AGENT) groupContext?.markTrigger(ctx.groupCapture)
        else groupContext?.discardRecent(ctx.groupCapture)
        startTrace(ctx)
        if (decision.route.action.type == ImRouteActionType.AGENT) ctx.selectedAgentId = decision.route.action.agentId
        ctx.executionTrace?.record(TraceCategory.IM, "route.matched", buildJsonObject {
            put("routeId", decision.route.id); put("action", decision.route.action.type.name)
            put("agentId", decision.route.action.agentId); put("normalizedText", decision.text)
            put("permissionGroup", decision.permissionGroup.name)
        })
        return null
    }

    private fun startTrace(ctx: PipelineContext) {
        ctx.executionTrace = executions?.start(com.heyanle.priestess.bot.observability.trace.ExecutionTraceInput(
            platform = ctx.event.platform.metadata.name, sessionId = ctx.event.session.id,
            messageId = ctx.event.messageId, senderId = ctx.senderId, input = ctx.event.chain.textContent,
        ))
    }
}
