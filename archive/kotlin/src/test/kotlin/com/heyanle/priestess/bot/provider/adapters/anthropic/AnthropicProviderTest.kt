package com.heyanle.priestess.bot.provider.adapters.anthropic

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.LLMRequest
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class AnthropicProviderTest {

    @Test
    fun `textChat maps messages to anthropic request and parses response`() = runBlocking {
        var capturedUrl = ""
        var capturedApiKey = ""
        var capturedVersion = ""
        var capturedBody = ""
        val client = HttpClient(
            MockEngine { request ->
                capturedUrl = request.url.toString()
                capturedApiKey = request.headers["x-api-key"].orEmpty()
                capturedVersion = request.headers["anthropic-version"].orEmpty()
                capturedBody = (request.body as TextContent).text
                respond(
                    content = """
                        {
                          "content": [
                            { "type": "text", "text": "hello from claude" }
                          ],
                          "stop_reason": "end_turn",
                          "usage": {
                            "input_tokens": 3,
                            "output_tokens": 4
                          }
                        }
                    """.trimIndent(),
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        ) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val provider = AnthropicProvider(
            config = ProviderConfig(
                name = "claude",
                type = "anthropic",
                model = "claude-sonnet-4-5",
                baseUrl = "https://api.anthropic.com/v1",
                apiKey = "anthropic-key",
                config = mapOf("anthropicVersion" to "2023-06-01"),
            ),
            client = client,
        )

        val response = provider.textChat(
            LLMRequest(
                messages = listOf(
                    ConversationMessage.system("be concise"),
                    ConversationMessage.user("hi"),
                    ConversationMessage.assistant("hello"),
                ),
                maxTokens = 64,
            ),
        )

        val body = Json.parseToJsonElement(capturedBody).jsonObject
        val messages = body["messages"]!!.jsonArray

        assertEquals("https://api.anthropic.com/v1/messages", capturedUrl)
        assertEquals("anthropic-key", capturedApiKey)
        assertEquals("2023-06-01", capturedVersion)
        assertEquals("claude-sonnet-4-5", body["model"]!!.jsonPrimitive.content)
        assertEquals("be concise", body["system"]!!.jsonPrimitive.content)
        assertEquals("user", messages[0].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("assistant", messages[1].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("hello from claude", response.content)
        assertEquals("end_turn", response.finishReason)
        assertEquals(7, response.tokenUsage.totalTokens)
    }

    @Test
    fun `getModels parses anthropic model ids`() = runBlocking {
        val client = HttpClient(
            MockEngine {
                respond(
                    content = """{"data":[{"id":"claude-sonnet-4-5"},{"id":"claude-haiku-4-5"}]}""",
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        ) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val provider = AnthropicProvider(
            config = ProviderConfig(type = "anthropic", apiKey = "test-key"),
            client = client,
        )

        assertEquals(listOf("claude-sonnet-4-5", "claude-haiku-4-5"), provider.getModels())
    }
}
