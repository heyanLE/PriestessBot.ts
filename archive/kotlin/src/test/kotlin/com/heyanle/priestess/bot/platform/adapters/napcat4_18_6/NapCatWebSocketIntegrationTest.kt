package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.client.request.url
import io.ktor.http.HttpHeaders
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NapCatWebSocketIntegrationTest {

    @Test
    fun `connect to local NapCat websocket and call get_status when enabled`() = kotlinx.coroutines.runBlocking {
        if (!enabled()) return@runBlocking

        val host = System.getProperty("napcat.ws.host")
            ?: System.getenv("NAPCAT_WS_HOST")
            ?: "192.168.31.24"
        val port = (System.getProperty("napcat.ws.port")
            ?: System.getenv("NAPCAT_WS_PORT")
            ?: "10001").toInt()
        val accessToken = System.getProperty("napcat.access.token")
            ?: System.getenv("NAPCAT_ACCESS_TOKEN")
        val url = "ws://$host:$port"

        val client = HttpClient(CIO) {
            install(WebSockets)
        }

        try {
            client.webSocket(
                request = {
                    url(url)
                    if (!accessToken.isNullOrBlank()) {
                        header(HttpHeaders.Authorization, "Bearer $accessToken")
                    }
                },
            ) {
                send("""{"action":"get_status","params":{},"echo":"priestess-napcat-test"}""")

                val response = withTimeout(5_000) {
                    while (true) {
                        val frame = incoming.receive()
                        if (frame is Frame.Text) {
                            val text = frame.readText()
                            if (text.contains("priestess-napcat-test") || text.contains("token")) {
                                return@withTimeout text
                            }
                        }
                    }
                    error("unreachable")
                }

                val json = Json.parseToJsonElement(response).jsonObject
                if (accessToken.isNullOrBlank()) {
                    assertEquals(1403, json["retcode"]?.jsonPrimitive?.intOrNull)
                    assertTrue(response.contains("token"))
                } else {
                    assertEquals("priestess-napcat-test", json["echo"]?.jsonPrimitive?.content)
                    assertTrue(json.containsKey("status") || json.containsKey("retcode"))
                }
            }
        } finally {
            client.close()
        }
    }

    private fun enabled(): Boolean {
        return System.getProperty("napcat.integration.enabled") == "true" ||
            System.getenv("NAPCAT_INTEGRATION_ENABLED") == "true"
    }
}
