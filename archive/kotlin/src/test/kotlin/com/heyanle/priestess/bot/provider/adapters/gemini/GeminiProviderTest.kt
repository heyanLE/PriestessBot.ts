package com.heyanle.priestess.bot.provider.adapters.gemini

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

class GeminiProviderTest {

    @Test
    fun `textChat maps messages to gemini request and parses response`() = runBlocking {
        var capturedUrl = ""
        var capturedBody = ""
        val client = HttpClient(
            MockEngine { request ->
                capturedUrl = request.url.toString()
                capturedBody = (request.body as TextContent).text
                respond(
                    content = """
                        {
                          "candidates": [
                            {
                              "content": {
                                "parts": [
                                  { "text": "hello from gemini" }
                                ]
                              },
                              "finishReason": "STOP"
                            }
                          ],
                          "usageMetadata": {
                            "promptTokenCount": 5,
                            "candidatesTokenCount": 6,
                            "totalTokenCount": 11
                          }
                        }
                    """.trimIndent(),
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        ) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val provider = GeminiProvider(
            config = ProviderConfig(
                name = "gemini-main",
                type = "gemini",
                model = "gemini-2.5-flash",
                baseUrl = "https://generativelanguage.googleapis.com/v1beta",
                apiKey = "gemini-key",
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
                maxTokens = 128,
            ),
        )

        val body = Json.parseToJsonElement(capturedBody).jsonObject
        val contents = body["contents"]!!.jsonArray

        assertEquals(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key",
            capturedUrl,
        )
        assertEquals(
            "be concise",
            body["system_instruction"]!!.jsonObject["parts"]!!.jsonArray.single().jsonObject["text"]!!.jsonPrimitive.content,
        )
        assertEquals("user", contents[0].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("model", contents[1].jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("hello from gemini", response.content)
        assertEquals("STOP", response.finishReason)
        assertEquals(11, response.tokenUsage.totalTokens)
    }

    @Test
    fun `getModels parses gemini model ids`() = runBlocking {
        val client = HttpClient(
            MockEngine {
                respond(
                    content = """{"models":[{"name":"models/gemini-2.5-flash"},{"name":"models/gemini-2.5-pro"}]}""",
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        ) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }

        val provider = GeminiProvider(
            config = ProviderConfig(type = "gemini", apiKey = "test-key"),
            client = client,
        )

        assertEquals(listOf("gemini-2.5-flash", "gemini-2.5-pro"), provider.getModels())
    }
}
