package com.heyanle.priestess.bot.platform.adapters.telegram

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TelegramPlatformTest {
    @Test
    fun `rich message sends original markdown without regex conversion`() = runBlocking {
        var path = ""
        var requestBody = ""
        val platform = TelegramPlatform(
            config = TelegramConfig(token = "test-token"),
            clientFactory = {
                testClient { request ->
                    path = request.url.encodedPath
                    requestBody = (request.body as TextContent).text
                    successfulResponse("42")
                }
            },
        )

        val markdown = "# 标题\n\n- **粗体**\n- `code`\n\n> 引用"
        val messageId = platform.sendMessage(testSession(), MessageChain.text(markdown))

        val payload = Json.parseToJsonElement(requestBody).jsonObject
        assertEquals("/bottest-token/sendRichMessage", path)
        assertEquals(markdown, payload["rich_message"]!!.jsonObject["markdown"]!!.jsonPrimitive.content)
        assertEquals("42", messageId)
    }

    @Test
    fun `rich message failure falls back to plain text and returns fallback id`() = runBlocking {
        val paths = mutableListOf<String>()
        val bodies = mutableListOf<String>()
        val platform = TelegramPlatform(
            config = TelegramConfig(token = "test-token"),
            clientFactory = {
                testClient { request ->
                    paths += request.url.encodedPath
                    bodies += (request.body as TextContent).text
                    if (request.url.encodedPath.endsWith("/sendRichMessage")) {
                        respond(
                            content = """{"ok":false,"error_code":400,"description":"Bad Request: unsupported method"}""",
                            status = HttpStatusCode.BadRequest,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    } else {
                        successfulResponse("43")
                    }
                }
            },
        )

        val markdown = "**保留为可读 Markdown**"
        val messageId = platform.sendMessage(testSession(), MessageChain.text(markdown))

        assertEquals(listOf("/bottest-token/sendRichMessage", "/bottest-token/sendMessage"), paths)
        val fallback = Json.parseToJsonElement(bodies[1]).jsonObject
        assertEquals(markdown, fallback["text"]!!.jsonPrimitive.content)
        assertTrue("parse_mode" !in fallback)
        assertEquals("43", messageId)
    }

    @Test
    fun `plain text fallback surfaces its telegram api failure`() = runBlocking {
        val platform = TelegramPlatform(
            config = TelegramConfig(token = "test-token"),
            clientFactory = {
                testClient {
                    respond(
                        content = """{"ok":false,"error_code":400,"description":"Bad Request: rejected"}""",
                        status = HttpStatusCode.BadRequest,
                        headers = headersOf(HttpHeaders.ContentType, "application/json"),
                    )
                }
            },
        )

        assertFailsWith<IllegalStateException> {
            platform.sendMessage(testSession(), MessageChain.text("hello"))
        }
    }

    @Test
    fun `chunker keeps Unicode code points intact and prefers paragraph boundaries`() {
        val message = "第一段\n\n第二段"
        val chunks = TelegramMessageChunker.split(message, 5)

        assertEquals(listOf("第一段\n\n", "第二段"), chunks)
        assertEquals(message, chunks.joinToString(separator = ""))
        assertTrue(chunks.all { it.codePointCount(0, it.length) <= 5 })

        val emojiChunks = TelegramMessageChunker.split("😀😀😀", 2)
        assertEquals(listOf("😀😀", "😀"), emojiChunks)
    }

    @Test
    fun `telegram update exposes sender id separately from group chat id`() {
        val platform = TelegramPlatform(TelegramConfig(token = "test-token"))
        val event = platform.parseUpdate(
            Json.parseToJsonElement(
                """{"message":{"text":"hello","from":{"id":42},"chat":{"id":100,"type":"group"}}}""",
            ).jsonObject,
        )!!

        assertEquals("42", event.session.metadata["senderId"])
        assertEquals("100", event.session.id)
    }

    private fun testClient(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData): HttpClient =
        HttpClient(MockEngine(handler)) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

    private fun MockRequestHandleScope.successfulResponse(messageId: String) = respond(
        content = """{"ok":true,"result":{"message_id":$messageId}}""",
        headers = headersOf(HttpHeaders.ContentType, "application/json"),
    )

    private fun testSession() = MessageSession(
        id = "123",
        type = SessionType.PRIVATE,
        platformName = "telegram",
    )
}
