package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.testReminderCase
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReminderToolsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `create list and delete reminder through tools`() = runBlocking {
        val reminders = testReminderCase("reminder-tools-flow")
        val context = AgentToolContext(
            platform = FakePlatform(),
            session = FakePlatform.fakeSession(id = "session-1"),
            metadata = mapOf(
                "workspace_id" to "workspace-a",
                "user_id" to "user-1",
                "timezone" to "UTC",
            ),
        )
        val create = CreateReminderTool { reminders }
        val list = ListRemindersTool { reminders }
        val delete = DeleteReminderTool { reminders }

        val created = create.execute(context, mapOf("text" to "ship tests", "due" to "10m"))

        assertTrue(created.success)
        val createdResponse = json.decodeFromString<CreateReminderResponse>(created.output)
        assertEquals("ship tests", createdResponse.reminder.text)
        assertEquals("pending", createdResponse.reminder.status)
        assertEquals("session-1", createdResponse.reminder.sessionId)

        val listed = json.decodeFromString<ListRemindersResponse>(
            list.execute(context, mapOf("status" to "pending", "limit" to "5")).output,
        )
        assertEquals(listOf(createdResponse.reminder.id), listed.reminders.map { it.id })

        val deleted = delete.execute(context, mapOf("reminder_id" to createdResponse.reminder.id))
        assertTrue(deleted.success)
        val afterDelete = json.decodeFromString<ListRemindersResponse>(list.execute(context, emptyMap()).output)
        assertTrue(afterDelete.reminders.isEmpty())
    }

    @Test
    fun `create returns structured validation error for invalid due time`() = runBlocking {
        val tool = CreateReminderTool { testReminderCase("reminder-tools-validation") }

        val result = tool.execute(AgentToolContext(), mapOf("text" to "bad due", "due" to "next someday"))

        assertFalse(result.success)
        assertEquals("VALIDATION_ERROR", result.errorCode)
    }

    @Test
    fun `list respects current session scope`() = runBlocking {
        val reminders = testReminderCase("reminder-tools-scope")
        val current = AgentToolContext(
            session = FakePlatform.fakeSession(id = "session-1"),
            metadata = mapOf("workspace_id" to "workspace-a"),
        )
        val other = AgentToolContext(
            session = FakePlatform.fakeSession(id = "session-2"),
            metadata = mapOf("workspace_id" to "workspace-a"),
        )
        CreateReminderTool { reminders }.execute(current, mapOf("text" to "current", "due" to "10m"))
        CreateReminderTool { reminders }.execute(other, mapOf("text" to "other", "due" to "10m"))

        val response = json.decodeFromString<ListRemindersResponse>(
            ListRemindersTool { reminders }.execute(current, emptyMap()).output,
        )

        assertEquals(listOf("current"), response.reminders.map { it.text })
    }

    @Test
    fun `reminder tools declare permission metadata`() {
        val reminders = { testReminderCase("reminder-tools-metadata") }
        val create = CreateReminderTool(reminders).schema
        val list = ListRemindersTool(reminders).schema
        val delete = DeleteReminderTool(reminders).schema

        assertEquals(ToolRiskLevel.STATE_WRITE, create.riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), create.requiredCapabilities)
        assertFalse(create.defaultEnabled)
        assertTrue(create.auditLog)

        assertEquals(ToolRiskLevel.SAFE_READ, list.riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), list.requiredCapabilities)
        assertTrue(list.defaultEnabled)
        assertFalse(list.auditLog)

        assertEquals(ToolRiskLevel.STATE_WRITE, delete.riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), delete.requiredCapabilities)
        assertFalse(delete.defaultEnabled)
        assertTrue(delete.auditLog)
    }
}
