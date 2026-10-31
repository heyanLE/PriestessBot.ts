package com.heyanle.priestess.bot.tool.mcp

import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Streamable HTTP transport for MCP.
 *
 * Uses HTTP POST request-response for each MCP operation.
 * Each request is a separate HTTP call. Retries on timeout.
 */
class StreamableHttpTransport(
    private val config: McpConfig,
) : McpTransport {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val _isConnected = AtomicBoolean(false)
    override val isConnected: Boolean get() = _isConnected.get()

    private val requestIdCounter = AtomicLong(1)

    private val client = HttpClient(CIO) {
        install(HttpTimeout) {
            requestTimeoutMillis = config.timeoutMs
            connectTimeoutMillis = 10_000
        }
    }

    private var baseUrl: String = ""
    private var sessionId: String? = null

    override suspend fun connect() {
        if (_isConnected.get()) return

        baseUrl = config.url.trimEnd('/')

        try {
            val initResponse = sendInitialize()
            sessionId = initResponse["sessionId"]?.toString()?.removeSurrounding("\"")
            _isConnected.set(true)
        } catch (e: Exception) {
            _isConnected.set(false)
            throw IllegalStateException("Streamable HTTP connection failed: ${e.message}", e)
        }
    }

    override suspend fun send(request: JsonObject): JsonObject {
        if (!_isConnected.get()) {
            throw IllegalStateException("Streamable HTTP transport not connected")
        }

        val requestId = requestIdCounter.getAndIncrement()
        val requestWithId = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", requestId)
            for ((key, value) in request) {
                if (key != "jsonrpc" && key != "id") {
                    put(key, value)
                }
            }
        }

        val requestStr = json.encodeToString(JsonObject.serializer(), requestWithId)

        val url = if (sessionId != null) {
            "$baseUrl/messages?sessionId=$sessionId"
        } else {
            "$baseUrl/messages"
        }

        var lastException: Exception? = null
        for (attempt in 1..config.maxRetries) {
            try {
                val response: HttpResponse = client.post(url) {
                    contentType(ContentType.Application.Json)
                    setBody(requestStr)
                }

                if (!response.status.isSuccess()) {
                    throw IllegalStateException("HTTP POST failed with status ${response.status.value}")
                }

                val responseBody = response.bodyAsText()
                val responseJson = json.decodeFromString(JsonObject.serializer(), responseBody)

                responseJson["sessionId"]?.let {
                    sessionId = it.toString().removeSurrounding("\"")
                }

                return responseJson
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                lastException = e
                if (attempt < config.maxRetries) {
                    delay(config.retryDelayMs * attempt)
                }
            }
        }

        throw IllegalStateException(
            "Request failed after ${config.maxRetries} attempts: ${lastException?.message}",
            lastException
        )
    }

    override suspend fun sendNotification(notification: JsonObject) {
        if (!_isConnected.get()) return

        try {
            val notifStr = json.encodeToString(JsonObject.serializer(), notification)

            val url = if (sessionId != null) {
                "$baseUrl/messages?sessionId=$sessionId"
            } else {
                "$baseUrl/messages"
            }

            client.post(url) {
                contentType(ContentType.Application.Json)
                setBody(notifStr)
            }
        } catch (_: Exception) {
            // Notifications are fire-and-forget
        }
    }

    override suspend fun disconnect() {
        _isConnected.set(false)
        sessionId = null
        client.close()
    }

    private suspend fun sendInitialize(): JsonObject {
        val initRequest = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", 0)
            put("method", "initialize")
            put("params", buildJsonObject {
                put("protocolVersion", "2024-11-05")
                put("capabilities", buildJsonObject {})
                put("clientInfo", buildJsonObject {
                    put("name", "PriestessBot")
                    put("version", "1.0.0")
                })
            })
        }

        val requestStr = json.encodeToString(JsonObject.serializer(), initRequest)

        val response: HttpResponse = client.post("$baseUrl/messages") {
            contentType(ContentType.Application.Json)
            setBody(requestStr)
        }

        if (!response.status.isSuccess()) {
            throw IllegalStateException("Initialize failed: ${response.status.value}")
        }

        val responseBody = response.bodyAsText()
        val responseJson = json.decodeFromString(JsonObject.serializer(), responseBody)

        val initializedNotif = buildJsonObject {
            put("jsonrpc", "2.0")
            put("method", "notifications/initialized")
        }
        val notifStr = json.encodeToString(JsonObject.serializer(), initializedNotif)
        client.post("$baseUrl/messages") {
            contentType(ContentType.Application.Json)
            setBody(notifStr)
        }

        return responseJson
    }
}
