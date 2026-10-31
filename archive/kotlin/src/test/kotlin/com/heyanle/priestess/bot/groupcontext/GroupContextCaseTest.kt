package com.heyanle.priestess.bot.groupcontext

import com.heyanle.priestess.bot.config.model.GroupContextSettingsDocument
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.testkit.FakePlatform
import kotlinx.coroutines.runBlocking
import java.util.UUID
import kotlin.test.*

class GroupContextCaseTest {
    private fun fixture(): Triple<DatabaseController, GroupHistoryRepository, GroupContextCase> {
        val controller = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        val repository = GroupHistoryRepository(DatabaseCase(controller))
        return Triple(controller, repository, GroupContextCase(repository))
    }

    private fun event(group: String, sender: String, messageId: String, text: String) = MessageEvent(
        FakePlatform(),
        MessageSession(group, SessionType.GROUP, "qq", mapOf("senderId" to sender, "senderName" to "昵称$sender", "selfId" to "bot")),
        MessageChain.text(text), messageId = messageId, timestamp = messageId.toLong() * 1_000,
    )

    @Test
    fun `recent history excludes current and other group messages and consumes deltas once`() = runBlocking {
        val (database, _, history) = fixture()
        val settings = GroupContextSettingsDocument(recentEnabled = true)
        try {
            history.capture(event("group-a", "alice", "1", "第一条群聊"), settings)
            history.capture(event("group-b", "stranger", "2", "别的群秘密"), settings)
            val trigger = history.capture(event("group-a", "bob", "3", "当前提问"), settings)
            history.markTrigger(trigger)
            history.capture(event("group-a", "carol", "4", "提问之后"), settings)
            val claimed = assertNotNull(history.claim(trigger, settings))
            assertContains(claimed.block, "第一条群聊")
            assertContains(claimed.block, "昵称alice")
            assertFalse(claimed.block.contains("当前提问"))
            assertFalse(claimed.block.contains("提问之后"))
            assertFalse(claimed.block.contains("别的群秘密"))
            claimed.commit()

            val next = history.capture(event("group-a", "dave", "5", "下一次提问"), settings)
            history.markTrigger(next)
            val second = assertNotNull(history.claim(next, settings))
            assertContains(second.block, "提问之后")
            assertFalse(second.block.contains("第一条群聊"))
            second.commit()
        } finally {
            database.stop()
        }
    }

    @Test
    fun `pending triggers are isolated and failed claims restore earlier chatter`() = runBlocking {
        val (database, _, history) = fixture()
        val settings = GroupContextSettingsDocument(recentEnabled = true)
        try {
            history.capture(event("group-a", "alice", "1", "之前的讨论"), settings)
            val first = history.capture(event("group-a", "bob", "2", "并发提问甲"), settings)
            history.markTrigger(first)
            val second = history.capture(event("group-a", "carol", "3", "并发提问乙"), settings)
            history.markTrigger(second)
            val claim = assertNotNull(history.claim(second, settings))
            assertContains(claim.block, "之前的讨论")
            assertFalse(claim.block.contains("并发提问甲"))
            claim.restoreIfNeeded()
            claim.restoreIfNeeded()

            val later = history.capture(event("group-a", "dave", "4", "稍后的提问"), settings)
            history.markTrigger(later)
            val restored = assertNotNull(history.claim(later, settings))
            assertContains(restored.block, "之前的讨论")
            assertFalse(restored.block.contains("并发提问甲"))
            restored.commit()
        } finally {
            database.stop()
        }
    }

    @Test
    fun `archive is independent of injection and bounded per group`() = runBlocking {
        val (database, repository, history) = fixture()
        val settings = GroupContextSettingsDocument(archiveEnabled = true, maxArchiveMessages = 3)
        try {
            assertNull(history.capture(event("group-a", "alice", "1", "old"), GroupContextSettingsDocument()))
            for (id in 1..4) history.capture(event("group-a", "alice", id.toString(), "message $id"), settings)
            history.capture(event("group-b", "bob", "5", "other group"), settings)
            val all = repository.search("qq", "group-a", null, "", "", 50, 100)
            assertEquals(listOf("message 2", "message 3", "message 4"), all.map { it.content })
            assertEquals(listOf("message 2", "message 3"), repository.search("qq", "group-a", all.last().id, "", "", 50, 100).map { it.content })
            assertEquals(listOf("message 3"), history.search("qq", "group-a", null, "3", "alice", 50, 100).map { it.content })
            assertTrue(history.search("qq", "group-a", null, "other group", "", 50, 100).isEmpty())
            history.archiveBotReply(event("group-a", "bot", "6", "ignored input"), "机器人答复", settings)
            val after = repository.search("qq", "group-a", null, "", "", 50, 100)
            assertEquals(listOf("message 3", "message 4", "机器人答复"), after.map { it.content })
            assertEquals("bot", after.last().role)
        } finally {
            database.stop()
        }
    }
}
