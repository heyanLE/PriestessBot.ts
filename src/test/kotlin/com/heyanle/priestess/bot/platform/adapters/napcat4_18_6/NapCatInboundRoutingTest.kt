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
            val event = platform.resolveReplySender(original)
            assertEquals(1, calls)
            assertEquals("123", event.session.metadata["senderId"])
            assertEquals("999", event.session.metadata["replySenderId"])
            assertEquals(original.messageId, event.messageId)
            assertEquals(original.chain, event.chain)
            val match = ImRouter().match(ImConnectionDocument("qq", type = "napcat", routes = ImRouter.defaultRoutes("agent")), event)
            assertEquals("group-command", match?.route?.id)
        } finally {
            platform.terminate()
        }
    }

    @Test
    fun `reply segment author avoids lookup and native array never borrows author from raw CQ`() = runBlocking {
        val platform = NapCatPlatform(httpClient = HttpClient(MockEngine { error("must not send a request") }))
        try {
            val json = message(replyAuthor = "456")
            val event = NapCatEventParser.parseOneBotEvent(platform, json)!!
            assertEquals("456", event.session.metadata["replySenderId"])
            assertSame(event, platform.resolveReplySender(event))
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
            val event = platform.resolveReplySender(NapCatEventParser.parseOneBotEvent(platform, message())!!)
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
