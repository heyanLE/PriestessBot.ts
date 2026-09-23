package com.heyanle.priestess.bot.platform.adapters.telegram

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TelegramPollingTest {
    @Test
    fun `polling errors are surfaced instead of looking like an empty queue`() = runBlocking {
        for (code in listOf(401, 409)) {
            val platform = TelegramPlatform(TelegramConfig(token = "test-secret")) {
                HttpClient(MockEngine {
                    respond(
                        """{"ok":false,"error_code":$code,"description":"polling rejected"}""",
                        HttpStatusCode.fromValue(code),
                        headersOf(HttpHeaders.ContentType, "application/json"),
                    )
                }) { install(ContentNegotiation) { json(Json) } }
            }
            try {
                val error = assertFailsWith<IllegalStateException> { platform.fetchUpdates() }
                assertTrue(error.message.orEmpty().contains("getUpdates"))
            } finally { platform.terminate() }
        }
    }

    @Test
    fun `successful empty poll and failed poll preserve next update offset`() = runBlocking {
        val offsets = mutableListOf<String?>()
        var calls = 0
        val platform = TelegramPlatform(TelegramConfig(token = "test-secret")) {
            HttpClient(MockEngine { request ->
                offsets += request.url.parameters["offset"]
                val body = when (calls++) {
                    0 -> """{"ok":true,"result":[{"update_id":42}]}"""
                    1 -> """{"ok":false,"error_code":409,"description":"conflict"}"""
                    else -> """{"ok":true,"result":[]}"""
                }
                respond(body, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            }) { install(ContentNegotiation) { json(Json) } }
        }
        try {
            assertEquals(1, platform.fetchUpdates().size)
            assertFailsWith<IllegalStateException> { platform.fetchUpdates() }
            assertTrue(platform.fetchUpdates().isEmpty())
            assertEquals(listOf<String?>("1", "43", "43"), offsets)
        } finally { platform.terminate() }
    }

    @Test
    fun `polling failure summary does not disclose credentials or request URL`() {
        val token = "12345:private-token"
        val platform = TelegramPlatform(TelegramConfig(token = token))
        val summary = platform.sanitizedFailure(IllegalStateException("Failed https://api.telegram.org/bot$token/getUpdates?offset=123 token=$token"))
        assertFalse(summary.contains(token))
        assertFalse(summary.contains("https://api.telegram.org"))
        assertFalse(summary.contains("offset=123"))
        assertTrue(summary.contains("IllegalStateException"))
    }
}
