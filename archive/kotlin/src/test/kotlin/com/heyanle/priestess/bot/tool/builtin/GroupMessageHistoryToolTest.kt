package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.config.model.GroupContextSettingsDocument
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.groupcontext.GroupContextCase
import com.heyanle.priestess.bot.groupcontext.GroupHistoryRepository
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID
import kotlin.test.*

class GroupMessageHistoryToolTest {
    @Test
    fun `read stays in current group and excludes current inbound message`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        val history = GroupContextCase(GroupHistoryRepository(DatabaseCase(database)))
        val settings = GroupContextSettingsDocument(archiveEnabled = true)
        val tool = GroupMessageHistoryTool({ history }) { if (it == "qq") settings else null }
        fun event(group: String, id: String, text: String) = MessageEvent(
            FakePlatform(), MessageSession(group, SessionType.GROUP, "qq", mapOf("senderId" to "alice")),
            MessageChain.text(text), messageId = id,
        )
        try {
            history.capture(event("group-a", "1", "甲群旧讨论"), settings)
            history.capture(event("group-b", "2", "乙群秘密"), settings)
            val current = assertNotNull(history.capture(event("group-a", "3", "当前问题"), settings))
            val context = AgentToolContext(
                session = MessageSession("group-a", SessionType.GROUP, "qq"),
                metadata = mapOf("groupHistoryCurrentId" to current.archiveId.toString()),
            )
            val result = tool.execute(context, mapOf("limit" to "20"))
            assertTrue(result.success)
            val rows = Json.parseToJsonElement(result.output).jsonObject["messages"]!!.jsonArray
            assertEquals(listOf("甲群旧讨论"), rows.map { it.jsonObject["content"]!!.jsonPrimitive.content })
            assertFalse(result.output.contains("乙群秘密"))
            assertFalse(result.output.contains("当前问题"))
            assertEquals("GROUP_ONLY", tool.execute(
                AgentToolContext(session = MessageSession("group-a", SessionType.PRIVATE, "qq")), emptyMap(),
            ).errorCode)
            assertEquals("INVALID_ARGUMENT", tool.execute(context, mapOf("before_id" to "bad")).errorCode)
        } finally {
            database.stop()
        }
    }
}
