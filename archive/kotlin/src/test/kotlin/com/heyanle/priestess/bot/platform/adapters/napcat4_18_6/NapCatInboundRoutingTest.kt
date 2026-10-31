package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.config.model.ImConnectionDocument
import com.heyanle.priestess.bot.im.ImRouter
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlin.test.*

class NapCatInboundRoutingTest {
    @Test
    fun `reply sender is resolved from get_msg before routing without changing the inbound sender`() = runBlocking {
        var calls = 0
        val platform = NapCatPlatform(httpClient = HttpClient(MockEngine { request ->
            calls++
            assertTrue(request.url.encodedPath.endsWith("/get_msg"))
            assertEquals(-88, Json.parseToJsonElement((request.body as TextContent).text).jsonObject["message_id"]?.jsonPrimitive?.int)
            respond("""{"status":"ok","retcode":0,"data":{"sender":{"user_id":999}}}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json() } })
        try {
            val original = NapCatEventParser.parseOneBotEvent(platform, message())!!
            assertNull(original.session.metadata["replySenderId"])
            val event = platform.resolveReplyContext(original)
            assertEquals(1, calls)
            assertEquals("123", event.session.metadata["senderId"])
            assertEquals("999", event.session.metadata["replySenderId"])
            assertEquals(original.messageId, event.messageId)
            assertEquals("999", event.chain.components.filterIsInstance<com.heyanle.priestess.bot.platform.MessageComponent.Reply>().single().senderId)
            val match = ImRouter().match(ImConnectionDocument("qq", type = "napcat", routes = ImRouter.defaultRoutes("agent")), event)
            assertEquals("group-command", match?.route?.id)
        } finally {
            platform.terminate()
        }
    }

    @Test
    fun `inline reply author is retained while get_msg supplies quoted text`() = runBlocking {
        var calls = 0
        val platform = NapCatPlatform(httpClient = HttpClient(MockEngine {
            calls++
            respond("""{"status":"ok","retcode":0,"data":{"sender":{"user_id":456,"card":"","nickname":"原作者"},"message":[{"type":"text","data":{"text":"被回复的正文"}}]}}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json() } })
        try {
            val json = message(replyAuthor = "456")
            val event = NapCatEventParser.parseOneBotEvent(platform, json)!!
            assertEquals("456", event.session.metadata["replySenderId"])
            val enriched = platform.resolveReplyContext(event)
            assertEquals(1, calls)
            assertEquals("456", enriched.session.metadata["replySenderId"])
            val quote = enriched.chain.components.filterIsInstance<com.heyanle.priestess.bot.platform.MessageComponent.Reply>().single()
            assertEquals("原作者", quote.senderName)
            assertEquals("被回复的正文", quote.chain?.textContent)
            assertEquals("#help", enriched.chain.textContent)
            assertTrue(com.heyanle.priestess.bot.message.InboundMessageFormatter.format(enriched).contains("被回复的正文"))
            val withoutAuthor = NapCatEventParser.parseOneBotEvent(platform, message())!!
            assertNull(withoutAuthor.session.metadata["replySenderId"])
        } finally {
            platform.terminate()
        }
    }

    @Test
    fun `failed author lookup does not guess reply-to-bot`() = runBlocking {
        val platform = NapCatPlatform(httpClient = HttpClient(MockEngine {
            respond("""{"status":"failed","retcode":100,"message":"not found"}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }) { install(ContentNegotiation) { json() } })
        try {
            val event = platform.resolveReplyContext(NapCatEventParser.parseOneBotEvent(platform, message())!!)
            assertNull(event.session.metadata["replySenderId"])
            assertNull(ImRouter().match(ImConnectionDocument("qq", type = "napcat", routes = ImRouter.defaultRoutes("agent")), event))
        } finally {
            platform.terminate()
        }
    }

    private fun message(replyAuthor: String? = null) = buildJsonObject {
        put("post_type", "message"); put("message_type", "group")
        put("user_id", 123); put("self_id", 999); put("group_id", 456); put("message_id", 789)
        put("raw_message", "[CQ:reply,id=-88,qq=999]#help")
        putJsonArray("message") {
            add(buildJsonObject {
                put("type", "reply")
                putJsonObject("data") { put("id", -88); replyAuthor?.let { put("user_id", it) } }
            })
            add(buildJsonObject { put("type", "text"); putJsonObject("data") { put("text", "#help") } })
        }
    }
}
