package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.groupcontext.GroupContextCase
import com.heyanle.priestess.bot.config.model.GroupContextSettingsDocument
import com.heyanle.priestess.bot.knowledge.KnowledgeCase
import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.reminder.ReminderCase
import com.heyanle.priestess.bot.server.ServerCase
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.workspace.WorkspaceCase
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore

/**
 * 注册所有内置工具，并通过工具模块门面保留实时注册表视图。
 */
fun registerBuiltinTools(
    registry: ToolCase,
    knowledgeCaseProvider: (() -> KnowledgeCase)? = null,
    serverCaseProvider: (() -> ServerCase)? = null,
    conversationCaseProvider: (() -> ConversationCase)? = null,
    memoryCaseProvider: (() -> MemoryCase)? = null,
    reminderCaseProvider: (() -> ReminderCase)? = null,
    workspaceCaseProvider: (() -> WorkspaceCase)? = null,
    overflowStore: ToolResultOverflowStore = ToolResultOverflowStore(),
    groupContextProvider: (() -> GroupContextCase)? = null,
    groupContextConfigProvider: ((String) -> GroupContextSettingsDocument?)? = null,
) {
    fun register(tool: FunctionTool, statusReason: String? = null) {
        registry.registerBuiltinTool(tool, statusReason)
    }

    register(ListToolsTool(registeredToolsProvider = { registry.getRegisteredTools() }))
    register(UseSkillTool())
    register(UnloadSkillTool())
    register(SkillsListTool())
    register(SkillViewTool())
    register(SkillManageTool(workspaceCaseProvider))
    register(
        HealthCheckTool(
            serverCaseProvider
                ?.let { provider -> { provider().healthSnapshotJson() } }
                ?: { error("Health dependency is unavailable") },
        ),
        statusReason = if (serverCaseProvider == null) "Requires health dependency" else null,
    )
    register(FetchUrlTool())
    register(ReadToolResultTool(overflowStore))
    register(
        ConversationSearchTool(conversationCaseProvider ?: { error("Conversation history dependency is unavailable") }),
        statusReason = if (conversationCaseProvider == null) "Requires conversation history dependency" else null,
    )
    if (groupContextProvider != null && groupContextConfigProvider != null) {
        register(GroupMessageHistoryTool(groupContextProvider, groupContextConfigProvider))
    }
    register(MemorySaveTool(memoryCaseProvider ?: { error("Memory dependency is unavailable") }), memoryStatusReason(memoryCaseProvider))
    register(MemoryRecallTool(memoryCaseProvider ?: { error("Memory dependency is unavailable") }), memoryStatusReason(memoryCaseProvider))
    register(MemoryDeleteTool(memoryCaseProvider ?: { error("Memory dependency is unavailable") }), memoryStatusReason(memoryCaseProvider))
    register(CreateReminderTool(reminderCaseProvider ?: { error("Reminder dependency is unavailable") }), reminderStatusReason(reminderCaseProvider))
    register(ListRemindersTool(reminderCaseProvider ?: { error("Reminder dependency is unavailable") }), reminderStatusReason(reminderCaseProvider))
    register(DeleteReminderTool(reminderCaseProvider ?: { error("Reminder dependency is unavailable") }), reminderStatusReason(reminderCaseProvider))
    register(WebSearchTool())
    register(WebExtractTool())
    register(ReadFileTool())
    register(WriteFileTool())
    register(PatchFileTool())
    register(SearchFilesTool())
    register(TerminalTool())
    register(ProcessTool())
    register(ReadTerminalTool())
    register(
        KnowledgeSearchTool(knowledgeCaseProvider),
        statusReason = if (knowledgeCaseProvider == null) "Requires knowledge dependency" else null,
    )
    register(
            SystemInfoTool(
                toolListProvider = { registry.getAll().map { it.schema.name } },
            ),
    )
}

private fun memoryStatusReason(provider: (() -> MemoryCase)?): String? {
    return if (provider == null) "Requires memory dependency" else null
}

private fun reminderStatusReason(provider: (() -> ReminderCase)?): String? {
    return if (provider == null) "Requires reminder dependency" else null
}
