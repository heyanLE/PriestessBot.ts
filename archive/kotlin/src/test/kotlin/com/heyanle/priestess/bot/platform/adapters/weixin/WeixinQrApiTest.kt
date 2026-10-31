package com.heyanle.priestess.bot.platform.adapters.weixin

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WeixinQrApiTest {
    @Test
    fun `QR request uses tokenless protocol headers and scannable image content`() = runBlocking {
        var path = ""
        var query = ""
        var appId = ""
        var clientVersion = ""
        var authorizationPresent = false
        val client = testClient { request ->
            path = request.url.encodedPath
            query = request.url.parameters["bot_type"].orEmpty()
            appId = request.headers["iLink-App-Id"].orEmpty()
            clientVersion = request.headers["iLink-App-ClientVersion"].orEmpty()
            authorizationPresent = request.headers.contains(HttpHeaders.Authorization)
            respond(
                """{"qrcode":"opaque-token","qrcode_img_content":"https://weixin.qq.com/x/scan-me"}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = KtorWeixinQrApi(client)

        val code = api.requestQrCode()

        assertEquals("/ilink/bot/get_bot_qrcode", path)
        assertEquals("3", query)
        assertEquals("bot", appId)
        assertEquals("131584", clientVersion)
        assertFalse(authorizationPresent)
        assertEquals("opaque-token", code.token)
        assertEquals("https://weixin.qq.com/x/scan-me", code.scanContent)
        api.close()
    }

    @Test
    fun `status query URL encodes opaque token`() = runBlocking {
        var token = ""
        val client = testClient { request ->
            token = request.url.parameters["qrcode"].orEmpty()
            respond(
                """{"status":"wait"}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = KtorWeixinQrApi(client)

        api.queryStatus(WeixinConfig.DEFAULT_BASE_URL, "opaque +/? token")

        assertEquals("opaque +/? token", token)
        api.close()
    }

    @Test
    fun `redirect policy accepts only trusted HTTPS hosts`() {
        assertEquals("https://ilinkai.weixin.qq.com", WeixinQrOriginPolicy.redirectBaseUrl("ilinkai.weixin.qq.com"))
        assertFailsWith<IllegalArgumentException> { WeixinQrOriginPolicy.redirectBaseUrl("evil.example") }
        assertFailsWith<IllegalArgumentException> { WeixinQrOriginPolicy.redirectBaseUrl("ilinkai.weixin.qq.com@evil.example") }
        assertFailsWith<IllegalArgumentException> { WeixinQrOriginPolicy.validateConfirmedBaseUrl("http://ilinkai.weixin.qq.com") }
    }

    @Test
    fun `renderer creates local PNG data URL`() {
        val dataUrl = WeixinQrRenderer.pngDataUrl("https://weixin.qq.com/x/scan-me", 128)
        assertTrue(dataUrl.startsWith("data:image/png;base64,"))
        val bytes = java.util.Base64.getDecoder().decode(dataUrl.substringAfter(','))
        assertTrue(bytes.take(8).toByteArray().contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)))
    }

    private fun testClient(
        handler: suspend io.ktor.client.engine.mock.MockRequestHandleScope.(io.ktor.client.request.HttpRequestData) -> io.ktor.client.request.HttpResponseData,
    ): HttpClient = HttpClient(MockEngine(handler)) {
        install(HttpTimeout)
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }
}
