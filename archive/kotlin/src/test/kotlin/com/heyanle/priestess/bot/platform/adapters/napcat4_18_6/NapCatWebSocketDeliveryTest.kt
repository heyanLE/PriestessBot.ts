package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.server.application.install
import io.ktor.server.response.respondText
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import kotlin.test.*

class NapCatWebSocketDeliveryTest {
    @Test
    fun `response from event handler waits for matching websocket acknowledgement`() = checkDelivery("ok")

    @Test
    fun `OneBot websocket rejection fails without HTTP resend`() = checkDelivery("failed")

    @Test
    fun `missing websocket acknowledgement times out without HTTP resend`() = checkDelivery(null)

    @Test
    fun `file attachment uploads over websocket in WS-only deployments`() = checkDelivery("ok", attachment = true)

    private fun checkDelivery(status: String?, attachment: Boolean = false) = testApplication {
        val delivery = CompletableDeferred<Result<String?>>()
        val payload = CompletableDeferred<JsonObject>()
        var httpCalls = 0
        application {
            install(io.ktor.server.websocket.WebSockets)
            routing {
                post("/send_group_msg") {
                    httpCalls++
                    call.respondText("""{"status":"ok","data":{"message_id":999}}""")
                }
                webSocket("/") {
                    send("""{"post_type":"message","message_type":"group","group_id":456,"user_id":123,"message_id":12,"message":"hello"}""")
                    for (frame in incoming) {
                        if (frame !is Frame.Text) continue
                        val request = Json.parseToJsonElement(frame.readText()).jsonObject
                        payload.complete(request)
                        if (status != null) {
                            // An unrelated echo must not complete this request.
                            send("""{"echo":"unrelated","status":"ok","data":{"message_id":999}}""")
                            send(buildJsonObject {
                                put("echo", request.getValue("echo"))
                                put("status", status)
                                put("retcode", if (status == "ok") 0 else 100)
                                put("message", "rejected")
                                putJsonObject("data") { put("message_id", 789) }
                            }.toString())
                        }
                    }
                }
            }
        }
        val platform = NapCatPlatform(
            NapCatConfig(host = "localhost", port = 80, wsPort = 80),
            createClient { install(WebSockets) },
            actionTimeoutMillis = if (status == null) 250 else 2_000,
        )
        platform.setMessageHandler { event ->
            delivery.complete(runCatching {
                platform.sendMessage(event.session, MessageChain(listOf(
                    MessageComponent.Reply(event.messageId),
                ) + if (attachment) listOf(
                    MessageComponent.File("https://files.example/a.zip", "a.zip", "folder-1"),
                ) else listOf(MessageComponent.At("123"), MessageComponent.Text("final"))))
            })
        }
        val job = platform.run()
        try {
            val result = withTimeout(5_000) { delivery.await() }
            if (status == "ok") assertEquals(if (attachment) null else "789", result.getOrThrow()) else assertTrue(result.isFailure)
            if (status == "failed") assertContains(result.exceptionOrNull()?.message.orEmpty(), "retcode=100")
            val request = payload.await()
            assertEquals(if (attachment) "upload_group_file" else "send_group_msg", request.getValue("action").jsonPrimitive.content)
            val params = request.getValue("params").jsonObject
            if (attachment) {
                assertEquals("https://files.example/a.zip", params.getValue("file").jsonPrimitive.content)
                assertEquals("folder-1", params.getValue("folder").jsonPrimitive.content)
                assertEquals(456, params.getValue("group_id").jsonPrimitive.int)
            } else {
                val segments = params.getValue("message").jsonArray
                assertEquals(listOf("reply", "at", "text"), segments.map { it.jsonObject.getValue("type").jsonPrimitive.content })
            }
            assertEquals(0, httpCalls)
        } finally {
            job.cancelAndJoin()
            platform.terminate()
        }
    }
}
