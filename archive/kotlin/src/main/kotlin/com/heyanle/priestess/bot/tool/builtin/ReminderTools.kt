package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.reminder.ReminderCase
import com.heyanle.priestess.bot.reminder.ReminderFilter
import com.heyanle.priestess.bot.reminder.ReminderRecord
import com.heyanle.priestess.bot.reminder.ReminderScopeContext
import com.heyanle.priestess.bot.reminder.ReminderStatus
import com.heyanle.priestess.bot.reminder.ReminderTimeParser
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.ZoneId

class CreateReminderTool(
    private val reminderCaseProvider: () -> ReminderCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "create_reminder",
        description = "Create a workspace, session, and user scoped reminder.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("text", "string", "Reminder text", required = true),
                ParameterDef("due", "string", "Absolute or relative due time", required = true),
                ParameterDef("timezone", "string", "IANA timezone for local absolute due times"),
            ),
            required = listOf("text", "due"),
        ),
        riskLevel = ToolRiskLevel.STATE_WRITE,
        requiredCapabilities = listOf(ToolCapabilities.REMINDER),
        defaultEnabled = false,
        auditLog = true,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val text = args["text"]?.trim().orEmpty()
        val due = args["due"]?.trim().orEmpty()
        if (text.isBlank()) return ToolResult.error("text is required", "VALIDATION_ERROR")
        if (due.isBlank()) return ToolResult.error("due is required", "VALIDATION_ERROR")
        val timezone = parseTimezone(args["timezone"] ?: context.metadata["timezone"])
            ?: return ToolResult.error("Unsupported timezone", "VALIDATION_ERROR")
        val dueAt = try {
            ReminderTimeParser.parse(due, timezone)
        } catch (e: IllegalArgumentException) {
            return ToolResult.error(e.message ?: "Invalid due time", "VALIDATION_ERROR")
        }

        return runCatching {
            val record = reminderCaseProvider().create(
                text = text,
                dueAt = dueAt,
                scopeContext = context.toReminderScopeContext(),
            )
            ToolResult.success(json.encodeToString(CreateReminderResponse(record.toDto())))
        }.getOrElse {
            ToolResult.error(it.message ?: "Failed to create reminder", "VALIDATION_ERROR")
        }
    }
}

class ListRemindersTool(
    private val reminderCaseProvider: () -> ReminderCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "list_reminders",
        description = "List reminders visible to the current workspace, session, and user scope.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("status", "string", "Optional reminder status", enumValues = ReminderStatus.entries.map { it.name.lowercase() }),
                ParameterDef("due_after", "string", "Optional lower due time bound"),
                ParameterDef("due_before", "string", "Optional upper due time bound"),
                ParameterDef("limit", "string", "Maximum results, 1-100"),
            ),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = listOf(ToolCapabilities.REMINDER),
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val status = args["status"]?.takeIf { it.isNotBlank() }?.let(::parseStatus)
        if (args["status"]?.isNotBlank() == true && status == null) {
            return ToolResult.error("Unsupported reminder status", "VALIDATION_ERROR")
        }
        val timezone = parseTimezone(context.metadata["timezone"]) ?: ZoneId.systemDefault()
        val dueAfter = try {
            parseOptionalDue(args["due_after"], timezone)
        } catch (e: IllegalArgumentException) {
            return ToolResult.error("Invalid due_after", "VALIDATION_ERROR")
        }
        val dueBefore = try {
            parseOptionalDue(args["due_before"], timezone)
        } catch (e: IllegalArgumentException) {
            return ToolResult.error("Invalid due_before", "VALIDATION_ERROR")
        }
        val limit = args["limit"]?.toIntOrNull()?.coerceIn(1, 100) ?: 20

        val reminders = reminderCaseProvider().list(
            ReminderFilter(
                scopeContext = context.toReminderScopeContext(),
                status = status,
                dueAfter = dueAfter,
                dueBefore = dueBefore,
                limit = limit,
            ),
        )
        return ToolResult.success(json.encodeToString(ListRemindersResponse(reminders.map { it.toDto() })))
    }

    private fun parseOptionalDue(value: String?, timezone: ZoneId): Long? {
        if (value.isNullOrBlank()) return null
        return runCatching { ReminderTimeParser.parse(value, timezone) }
            .getOrElse { throw IllegalArgumentException("Invalid due time") }
    }
}

class DeleteReminderTool(
    private val reminderCaseProvider: () -> ReminderCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "delete_reminder",
        description = "Delete one visible reminder by exact reminder id.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("reminder_id", "string", "Exact reminder id to delete", required = true),
            ),
            required = listOf("reminder_id"),
        ),
        riskLevel = ToolRiskLevel.STATE_WRITE,
        requiredCapabilities = listOf(ToolCapabilities.REMINDER),
        defaultEnabled = false,
        auditLog = true,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val id = args["reminder_id"]?.trim().orEmpty()
        if (id.isBlank()) {
            return ToolResult.error("reminder_id is required", "VALIDATION_ERROR")
        }
        val deleted = reminderCaseProvider().delete(id, context.toReminderScopeContext())
        if (!deleted) {
            return ToolResult.error("Reminder not found or not visible", "NOT_FOUND")
        }
        return ToolResult.success(json.encodeToString(DeleteReminderResponse(reminderId = id, deleted = true)))
    }
}

@Serializable
data class CreateReminderResponse(
    val reminder: ReminderDto,
)

@Serializable
data class ListRemindersResponse(
    val reminders: List<ReminderDto>,
)

@Serializable
data class DeleteReminderResponse(
    val reminderId: String,
    val deleted: Boolean,
)

@Serializable
data class ReminderDto(
    val id: String,
    val text: String,
    val dueAt: Long,
    val status: String,
    val workspaceId: String,
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val deliveredAt: Long? = null,
    val failureReason: String? = null,
)

private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

private fun AgentToolContext.toReminderScopeContext(): ReminderScopeContext {
    val metadata = this.metadata
    val platform = this.platform
    val session = this.session
    return ReminderScopeContext(
        workspaceId = metadata["workspaceId"] ?: MemoryScopeContext.DEFAULT_WORKSPACE_ID,
        platformId = metadata["platformId"] ?: platform?.metadata?.name,
        sessionId = metadata["sessionId"] ?: session?.id,
        sessionType = session?.type,
        userId = metadata["userId"],
    )
}

private fun parseTimezone(value: String?): ZoneId? {
    if (value.isNullOrBlank()) return ZoneId.systemDefault()
    return runCatching { ZoneId.of(value.trim()) }.getOrNull()
}

private fun parseStatus(value: String): ReminderStatus? {
    return ReminderStatus.entries.find { it.name.equals(value.trim(), ignoreCase = true) }
}

private fun ReminderRecord.toDto(): ReminderDto {
    return ReminderDto(
        id = id,
        text = text,
        dueAt = dueAt,
        status = status.name.lowercase(),
        workspaceId = workspaceId,
        platformId = platformId,
        sessionId = sessionId,
        userId = userId,
        deliveredAt = deliveredAt,
        failureReason = failureReason,
    )
}
