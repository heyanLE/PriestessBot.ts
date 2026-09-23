package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.conversation.ConversationCase

data class CommandContext(
    val pipeline: PipelineContext,
    val arguments: List<String>,
    val conversationCase: ConversationCase,
)

interface Command {
    val name: String
    val description: String
    val requiredPermissionGroup: PermissionGroup
    suspend fun execute(context: CommandContext): String
}

class NewCommand : Command {
    override val name: String = "new"
    override val description: String = "Clear the current conversation history."
    override val requiredPermissionGroup: PermissionGroup = PermissionGroup.ADMIN

    override suspend fun execute(context: CommandContext): String {
        val event = context.pipeline.event
        context.conversationCase.clearHistory(event.platform.metadata.name, event.session.id)
        return "已清空当前会话的历史消息。"
    }
}

class CommandCase(
    commands: List<Command> = listOf(NewCommand(), HelpCommand(), StatusCommand()),
) {
    private val commandsByName = commands.associateBy { it.name.lowercase() }

    fun find(name: String): Command? = commandsByName[name.trim().lowercase()]
}

class HelpCommand : Command {
    override val name = "help"
    override val description = "List built-in commands."
    override val requiredPermissionGroup = PermissionGroup.OPERATOR
    override suspend fun execute(context: CommandContext): String {
        val prefix = context.pipeline.imRoute?.route?.action?.commandPrefix ?: "#"
        return "内置指令：\n${prefix}help — 查看帮助\n${prefix}status — 查看当前身份\n${prefix}new — 清空本会话各 Agent 的聊天历史（需资深干员权限）"
    }
}

class StatusCommand : Command {
    override val name = "status"
    override val description = "Show current IM and sender permission."
    override val requiredPermissionGroup = PermissionGroup.OPERATOR
    override suspend fun execute(context: CommandContext): String = with(context.pipeline) {
        "IM：${event.platform.metadata.name}\n用户：$senderId\n身份：${permissionGroup.name}"
    }
}
