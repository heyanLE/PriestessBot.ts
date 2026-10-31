package com.heyanle.priestess.bot.platform.adapters.telegram

import com.heyanle.priestess.bot.config.model.ImConnectionDocument
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.platform.MessageComponent
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlin.test.*

class TelegramInboundRoutingTest {
    @Test
    fun `getMe identity is cached and structured bot username mention is removed for command routing`() = runBlocking {
        var calls = 0
        val platform = TelegramPlatform(TelegramConfig(token = "test-token")) {
            HttpClient(MockEngine { request ->
                assertTrue(request.url.encodedPath.endsWith("/getMe"))
                calls++
                respond("""{"ok":true,"result":{"id":999,"is_bot":true,"username":"PriestessBot"}}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
            }) { install(ContentNegotiation) { json() } }
        }
        try {
            platform.ensureBotIdentity()
            platform.ensureBotIdentity()
            val text = "@pRiEsTeSsBoT  #help"
            val event = platform.parseUpdate(update(text, listOf(entity("mention", 0, 13))))!!
            assertEquals(1, calls)
            assertEquals("42", event.session.metadata["senderId"])
            assertEquals("999", event.session.metadata["selfId"])
            assertEquals("Alice Example", event.session.metadata["senderName"])
            assertEquals("101", event.messageId)
            assertEquals(listOf(MessageComponent.At("999"), MessageComponent.Text("  #help")), event.chain.components)
            val route = ImRouter().match(ImConnectionDocument("tg", type = "telegram", routes = ImRouter.defaultRoutes("agent")), event)
            assertEquals("group-command", route?.route?.id)
            assertEquals("#help", route?.text)
        } finally {
            platform.terminate()
        }
    }

    @Test
    fun `text mention uses protocol user identity and UTF16 offsets without parsing plain at text`() {
        val platform = TelegramPlatform()
        val event = platform.parseUpdate(update("😀 Alice @impostor", listOf(entity("text_mention", 3, 5, "123"))))!!
        assertEquals(listOf(MessageComponent.Text("😀 "), MessageComponent.At("123"), MessageComponent.Text(" @impostor")), event.chain.components)
        assertEquals("42", event.session.metadata["senderId"])
        assertNull(event.session.metadata["selfId"])
        val plain = platform.parseUpdate(update("@PriestessBot [CQ:at,qq=999] #help"))!!
        assertEquals(listOf(MessageComponent.Text("@PriestessBot [CQ:at,qq=999] #help")), plain.chain.components)
        val malformed = platform.parseUpdate(update("😀 hello", listOf(entity("text_mention", 1, 1, "999"), entity("text_mention", 100, 2, "999"))))!!
        assertEquals("😀 hello", malformed.chain.textContent)
        assertFalse(malformed.chain.components.any { it is MessageComponent.At })
    }

    @Test
    fun `reply author is preserved independently from inbound sender and arbitrary bots are not self`() = runBlocking {
        val platform = TelegramPlatform(TelegramConfig(token = "test-token")) {
            HttpClient(MockEngine {
                respond("""{"ok":true,"result":{"id":999,"is_bot":true,"username":"PriestessBot"}}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
            }) { install(ContentNegotiation) { json() } }
        }
        try {
            platform.ensureBotIdentity()
            for (author in listOf("999", "888")) {
                val event = platform.parseUpdate(update("#help", replyAuthor = author))!!
                assertEquals("42", event.session.metadata["senderId"])
                assertEquals(author, event.session.metadata["replySenderId"])
                assertEquals("90", event.session.metadata["replyMessageId"])
                assertEquals(MessageComponent.Reply("90"), event.chain.components.first())
                val match = ImRouter().match(ImConnectionDocument("tg", type = "telegram", routes = ImRouter.defaultRoutes("agent")), event)
                if (author == "999") assertEquals("group-command", match?.route?.id) else assertNull(match)
            }
        } finally {
            platform.terminate()
        }
    }

    private fun entity(type: String, offset: Int, length: Int, userId: String? = null) = buildJsonObject {
        put("type", type); put("offset", offset); put("length", length)
        userId?.let { putJsonObject("user") { put("id", it) } }
    }

    private fun update(text: String, entities: List<JsonObject> = emptyList(), replyAuthor: String? = null) = buildJsonObject {
        putJsonObject("message") {
            put("message_id", 101)
            put("text", text)
            put("entities", JsonArray(entities))
            putJsonObject("chat") { put("id", -100); put("type", "supergroup"); putJsonObject("photo") { put("id", "ignored") } }
            putJsonObject("from") { put("id", 42); put("first_name", "Alice"); put("last_name", "Example") }
            replyAuthor?.let {
                putJsonObject("reply_to_message") {
                    put("message_id", 90)
                    putJsonObject("from") { put("id", it); put("is_bot", true) }
                }
            }
        }
    }
}
