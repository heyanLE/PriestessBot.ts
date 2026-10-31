package com.heyanle.priestess.bot.reminder

import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.testReminderCase
import kotlinx.coroutines.runBlocking
import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReminderControllerTest {
    @Test
    fun `parses absolute and relative due times`() {
        val now = Instant.parse("2026-06-24T00:00:00Z").toEpochMilli()

        assertEquals(now + 10 * 60 * 1000, ReminderTimeParser.parse("10m", ZoneId.of("UTC"), now))
        assertEquals(now + 2 * 60 * 60 * 1000, ReminderTimeParser.parse("in 2 hours", ZoneId.of("UTC"), now))
        assertEquals(
            Instant.parse("2026-06-24T09:30:00Z").toEpochMilli(),
            ReminderTimeParser.parse("2026-06-24T09:30:00Z", ZoneId.of("UTC"), now),
        )
        assertEquals(
            Instant.parse("2026-06-24T01:30:00Z").toEpochMilli(),
            ReminderTimeParser.parse("2026-06-24T09:30:00", ZoneId.of("Asia/Shanghai"), now),
        )
    }

    @Test
    fun `lists and deletes only visible reminders`() {
        val reminders = testReminderCase("reminder-scope")
        val current = ReminderScopeContext(
            workspaceId = "workspace-a",
            platformId = "fake-platform",
            sessionId = "session-1",
            sessionType = SessionType.PRIVATE,
            userId = "user-1",
        )
        val otherSession = current.copy(sessionId = "session-2")

        val visible = reminders.create("visible", dueAt = 1_000, scopeContext = current)
        reminders.create("hidden", dueAt = 1_000, scopeContext = otherSession)

        assertEquals(listOf(visible.id), reminders.list(ReminderFilter(scopeContext = current)).map { it.id })
        assertFalse(reminders.delete(visible.id, otherSession))
        assertTrue(reminders.delete(visible.id, current))
        assertTrue(reminders.list(ReminderFilter(scopeContext = current)).isEmpty())
    }

    @Test
    fun `delivers due reminders once and updates status`() = runBlocking {
        val reminders = testReminderCase("reminder-delivery")
        val platform = FakePlatform()
        val context = ReminderScopeContext(
            workspaceId = "workspace-a",
            platformId = platform.metadata.name,
            sessionId = "session-1",
            sessionType = SessionType.PRIVATE,
            userId = "user-1",
        )
        reminders.create("drink water", dueAt = 1_000, scopeContext = context)

        val first = reminders.deliverDue(platform, nowMillis = 2_000, workspaceId = "workspace-a")
        val second = reminders.deliverDue(platform, nowMillis = 3_000, workspaceId = "workspace-a")

        assertEquals(1, first.delivered)
        assertEquals(0, first.failed)
        assertEquals(0, second.delivered)
        assertEquals(1, platform.sentMessages.size)
        assertEquals("Reminder: drink water", platform.sentMessages.single().second.textContent)
        assertEquals(
            listOf(ReminderStatus.DELIVERED),
            reminders.list(ReminderFilter(scopeContext = context, status = ReminderStatus.DELIVERED)).map { it.status },
        )
    }
}
