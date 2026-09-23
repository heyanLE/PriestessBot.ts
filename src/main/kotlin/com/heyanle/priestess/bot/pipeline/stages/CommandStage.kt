package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.config.CommandConfig
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.pipeline.CommandCase
import com.heyanle.priestess.bot.pipeline.CommandContext
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.PermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionMessageContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder

class CommandStage(
    private val configProvider: () -> CommandConfig,
    private val commandCase: CommandCase,
    private val conversationCase: ConversationCase,
    private val permissionDeniedMessageResolver: PermissionDeniedMessageResolver,
) : Stage {
    override val name: String = "Command"
    override val order: StageOrder = StageOrder.COMMAND

    override suspend fun process(ctx: PipelineContext) = run {
        val route = ctx.imRoute
        if (ctx.effectiveRuntimeSnapshot?.application != null && route?.route?.action?.type != com.heyanle.priestess.bot.config.model.ImRouteActionType.COMMAND) return@run null
        val prefix = (route?.route?.action?.commandPrefix ?: ctx.effectiveRuntimeSnapshot?.runtime?.command?.prefix ?: configProvider().prefix).trim()
        if (prefix.isEmpty()) return@run null
        val text = (route?.text ?: ctx.textContent).trim()
        if (!text.startsWith(prefix)) {
            if (route != null) ctx.directResponse = "内置指令需要以 $prefix 开头。"
            return@run null
        }
        val tokens = text.removePrefix(prefix).trim().split(Regex("\\s+")).filter(String::isNotBlank)
        if (tokens.isEmpty()) {
            if (route != null) ctx.directResponse = "请在 $prefix 后输入内置指令，例如 ${prefix}help。"
            return@run null
        }
        val command = commandCase.find(tokens.first())
        if (command == null) {
            ctx.directResponse = "未知指令：${tokens.first()}"
            return@run null
        }
        if (!ctx.permissionGroup.satisfies(command.requiredPermissionGroup)) {
            ctx.directResponse = permissionDeniedMessageResolver.resolve(messageContext(ctx))
            return@run null
        }
        ctx.directResponse = command.execute(CommandContext(ctx, tokens.drop(1), conversationCase))
        null
    }

    private fun messageContext(ctx: PipelineContext): PermissionMessageContext {
        return PermissionMessageContext(
            workspaceId = ctx.effectiveWorkspaceSnapshot?.config?.id.orEmpty(),
            agentName = ctx.configurationTrace?.agentId.orEmpty(),
        )
    }
}
