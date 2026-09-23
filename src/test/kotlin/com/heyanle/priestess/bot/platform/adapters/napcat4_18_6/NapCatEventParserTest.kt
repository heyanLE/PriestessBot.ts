package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.coroutines.Job
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class NapCatEventParserTest {

    private val platform = TestPlatform("napcat-test")

    @Test
    fun `parse private websocket message event`() {
        val json = Json.parseToJsonElement(
            """
            {
              "post_type": "message",
              "message_type": "private",
              "user_id": 123456,
              "raw_message": "hello priestess"
            }
            """.trimIndent(),
        ).jsonObject

        val event = NapCatEventParser.parseOneBotEvent(platform, json)

        requireNotNull(event)
        assertEquals(SessionType.PRIVATE, event.session.type)
        assertEquals("123456", event.session.id)
        assertEquals("napcat-test", event.session.platformName)
        assertEquals("hello priestess", event.chain.textContent)
    }

    @Test
    fun `parse group websocket message event`() {
        val json = Json.parseToJsonElement(
            """
            {
              "post_type": "message",
              "message_type": "group",
              "group_id": 654321,
              "user_id": 123456,
              "raw_message": "group hello"
            }
            """.trimIndent(),
        ).jsonObject

        val event = NapCatEventParser.parseOneBotEvent(platform, json)

        requireNotNull(event)
        assertEquals(SessionType.GROUP, event.session.type)
        assertEquals("654321", event.session.id)
        assertEquals("group hello", event.chain.textContent)
    }

    @Test
    fun `parse group websocket at mention as message component`() {
        val json = Json.parseToJsonElement(
            """
            {
              "post_type": "message",
              "message_type": "group",
              "self_id": 3334969096,
              "group_id": 654321,
              "user_id": 123456,
              "raw_message": "[CQ:at,qq=3334969096] hello"
            }
            """.trimIndent(),
        ).jsonObject

        val event = NapCatEventParser.parseOneBotEvent(platform, json)

        requireNotNull(event)
        assertEquals("123456", event.session.metadata["senderId"])
        assertEquals("3334969096", event.session.metadata["selfId"])
        assertEquals(
            listOf(MessageComponent.At("3334969096"), MessageComponent.Text(" hello")),
            event.chain.components,
        )
    }

    @Test
    fun `parse message identifiers and escaped file image reply components`() {
        val json = Json.parseToJsonElement(
            """
            {
              "post_type": "message",
              "message_type": "group",
              "message_id": 9988,
              "self_id": 42,
              "group_id": 654321,
              "user_id": 123456,
              "raw_message": "before[CQ:reply,id=8877][CQ:file,file=report&#44;final.pdf,url=https://files.example/a.pdf][CQ:image,file=https://img.example/a.png]after"
            }
            """.trimIndent(),
        ).jsonObject

        val event = requireNotNull(NapCatEventParser.parseOneBotEvent(platform, json))

        assertEquals("9988", event.messageId)
        assertEquals("9988", event.sourceId)
        assertEquals("654321", event.session.metadata["groupId"])
        assertEquals("8877", event.session.metadata["replyMessageId"])
        assertEquals(
            listOf(
                MessageComponent.Text("before"),
                MessageComponent.Reply("8877"),
                MessageComponent.File("https://files.example/a.pdf", "report,final.pdf"),
                MessageComponent.Image("https://img.example/a.png"),
                MessageComponent.Text("after"),
            ),
            event.chain.components,
        )
    }

    @Test
    fun `ignore non-message websocket event`() {
        val json = Json.parseToJsonElement(
            """
            {
              "post_type": "notice",
              "notice_type": "group_increase",
              "user_id": 123456
            }
            """.trimIndent(),
        ).jsonObject

        assertNull(NapCatEventParser.parseOneBotEvent(platform, json))
    }

    @Test
    fun `parse http fallback message with sender user id`() {
        val json = Json.parseToJsonElement(
            """
            {
              "message_type": "group",
              "group_id": "654321",
              "sender": { "user_id": 123456 },
              "message": "fallback hello"
            }
            """.trimIndent(),
        ).jsonObject

        val event = NapCatEventParser.parseHttpMessage(platform, json)

        requireNotNull(event)
        assertEquals(SessionType.GROUP, event.session.type)
        assertEquals("654321", event.session.id)
        assertEquals("fallback hello", event.chain.textContent)
    }

    @Test
    fun `native array preserves reply at and literal text without interpreting CQ`() {
        val json = Json.parseToJsonElement("""
            {
              "post_type":"message", "message_type":"group", "message_id":9988,
              "self_id":42, "user_id":123, "group_id":654321,
              "raw_message":"ignored fallback",
              "message":[
                {"type":"reply","data":{"id":8877}},
                {"type":"at","data":{"qq":"42"}},
                {"type":"text","data":{"text":"hello [CQ:at,qq=all] &amp;"}},
                {"type":"image","data":{"file":"image.png"}},
                {"type":"file","data":{"file_id":"f1","name":"a,b.pdf"}}
              ]
            }
        """.trimIndent()).jsonObject
        for (event in listOf(NapCatEventParser.parseOneBotEvent(platform, json), NapCatEventParser.parseHttpMessage(platform, json))) {
            requireNotNull(event)
            assertEquals("8877", event.session.metadata["replyMessageId"])
            assertEquals(listOf(
                MessageComponent.Reply("8877"), MessageComponent.At("42"),
                MessageComponent.Text("hello [CQ:at,qq=all] &amp;"), MessageComponent.Image("image.png"),
                MessageComponent.File("f1", "a,b.pdf"),
            ), event.chain.components)
        }
    }

    @Test
    fun `CQ plain text is decoded once after segment extraction`() {
        val json = Json.parseToJsonElement("""{
            "post_type":"message", "user_id":123,
            "raw_message":"&#91;CQ:at,qq=all&#93; &amp;amp;[CQ:reply,id=-123]"
        }""").jsonObject
        val event = requireNotNull(NapCatEventParser.parseOneBotEvent(platform, json))
        assertEquals(listOf(MessageComponent.Text("[CQ:at,qq=all] &amp;"), MessageComponent.Reply("-123")), event.chain.components)
        assertEquals("-123", event.session.metadata["replyMessageId"])
    }

    @Test
    fun `sender group card takes precedence over nickname for websocket and HTTP events`() {
        val json = Json.parseToJsonElement("""{
            "post_type":"message", "message_type":"group", "group_id":654321,
            "user_id":123, "sender":{"user_id":123,"card":"群名片","nickname":"账号昵称"},
            "message":"hello"
        }""").jsonObject
        for (event in listOf(NapCatEventParser.parseOneBotEvent(platform, json), NapCatEventParser.parseHttpMessage(platform, json))) {
            requireNotNull(event)
            assertEquals("群名片", event.session.metadata["senderName"])
            assertEquals("123", event.session.metadata["senderId"])
        }
    }

    @Test
    fun `blank or missing card falls back to nickname and absent names stay absent`() {
        val cases = listOf(
            """{"user_id":123,"card":"  ","nickname":"账号昵称"}""" to "账号昵称",
            """{"user_id":123,"nickname":"私聊昵称"}""" to "私聊昵称",
            """{"user_id":123,"card":null,"nickname":"昵称"}""" to "昵称",
            """{"user_id":123,"card":"","nickname":"  "}""" to null,
            """{"user_id":123}""" to null,
            "null" to null,
        )
        for ((sender, expectedName) in cases) {
            val json = Json.parseToJsonElement("""{
                "post_type":"message", "message_type":"private", "user_id":123,
                "sender":$sender, "message":"hello"
            }""").jsonObject
            for (event in listOf(NapCatEventParser.parseOneBotEvent(platform, json), NapCatEventParser.parseHttpMessage(platform, json))) {
                requireNotNull(event)
                assertEquals(expectedName, event.session.metadata["senderName"], sender)
                assertEquals("123", event.session.metadata["senderId"])
            }
        }
    }

    private class TestPlatform(name: String) : Platform() {
        override val metadata = PlatformMetadata(
            name = name,
            displayName = name,
            supportStreaming = false,
            supportProactiveMessage = false,
        )

        override suspend fun run(): Job = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = null
    }
}
