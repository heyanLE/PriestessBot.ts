package com.heyanle.priestess.bot.platform.adapters.weixin

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WeixinApiClientTest {
    @Test
    fun `getupdates sends required headers cursor and base info`() = runBlocking {
        var requestPath = ""
        var authorization = ""
        var authorizationType = ""
        var uin = ""
        var requestBody = ""
        val client = testClient { request ->
            requestPath = request.url.encodedPath
            authorization = request.headers[HttpHeaders.Authorization].orEmpty()
            authorizationType = request.headers["AuthorizationType"].orEmpty()
            uin = request.headers["X-WECHAT-UIN"].orEmpty()
            requestBody = (request.body as TextContent).text
            respond(
                content = """{"ret":0,"get_updates_buf":"next","msgs":[]}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = KtorWeixinApi(
            config = testConfig(token = "bot-secret"),
            pollClient = client,
            sendClient = client,
            uinProvider = { "random-uin" },
        )

        val result = api.getUpdates("saved-cursor", 5_000)

        assertEquals("/ilink/bot/getupdates", requestPath)
        assertEquals("Bearer bot-secret", authorization)
        assertEquals("ilink_bot_token", authorizationType)
        assertEquals("random-uin", uin)
        val payload = Json.parseToJsonElement(requestBody).jsonObject
        assertEquals("saved-cursor", payload["get_updates_buf"]!!.jsonPrimitive.content)
        assertEquals("2.2.0", payload["base_info"]!!.jsonObject["channel_version"]!!.jsonPrimitive.content)
        assertEquals("next", result["get_updates_buf"]!!.jsonPrimitive.content)
        api.close()
    }

    @Test
    fun `http error is secret safe and classifies retryability`() = runBlocking {
        val client = testClient {
            respond(
                content = "server echoed bot-secret",
                status = io.ktor.http.HttpStatusCode.ServiceUnavailable,
            )
        }
        val api = KtorWeixinApi(testConfig(token = "bot-secret"), client, client)

        val error = assertFailsWith<WeixinTransportException> {
            api.sendText("peer", "hello", "context-secret", "client-1")
        }

        assertEquals(true, error.retryable)
        assertEquals(false, error.message.orEmpty().contains("bot-secret"))
        assertEquals(false, error.message.orEmpty().contains("context-secret"))
        api.close()
    }

    @Test
    fun `sendmessage includes stable identifiers text and context`() = runBlocking {
        var requestBody = ""
        val client = testClient { request ->
            requestBody = (request.body as TextContent).text
            respond(
                content = """{"ret":0}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = KtorWeixinApi(testConfig(token = "bot-secret"), client, client)

        api.sendText("peer-a", "你好", "context-a", "client-a")

        val message = Json.parseToJsonElement(requestBody).jsonObject["msg"]!!.jsonObject
        assertEquals("peer-a", message["to_user_id"]!!.jsonPrimitive.content)
        assertEquals("client-a", message["client_id"]!!.jsonPrimitive.content)
        assertEquals("context-a", message["context_token"]!!.jsonPrimitive.content)
        assertEquals(
            "你好",
            message["item_list"]!!.jsonArray.single().jsonObject["text_item"]!!.jsonObject["text"]!!.jsonPrimitive.content,
        )
        api.close()
    }

    private fun testClient(
        handler: suspend io.ktor.client.engine.mock.MockRequestHandleScope.(io.ktor.client.request.HttpRequestData) -> io.ktor.client.request.HttpResponseData,
    ): HttpClient = HttpClient(MockEngine(handler)) {
        install(HttpTimeout)
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }

    private fun testConfig(token: String) = WeixinConfig(
        token = token,
        accountId = "account-a",
        baseUrl = "https://ilink.example.test",
    )
}
