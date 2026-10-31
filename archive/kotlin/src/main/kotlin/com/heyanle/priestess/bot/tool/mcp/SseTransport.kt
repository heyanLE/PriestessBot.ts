package com.heyanle.priestess.bot.tool.mcp

import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * SSE (Server-Sent Events) based MCP transport.
 *
 * Establishes an HTTP GET connection to receive SSE events.
 * Uses exponential backoff for reconnection on disconnect.
 */
class SseTransport(
    private val config: McpConfig,
) : McpTransport {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val _isConnected = AtomicBoolean(false)
    override val isConnected: Boolean get() = _isConnected.get()

    private val requestIdCounter = AtomicLong(1)
    private val pendingRequests = mutableMapOf<Long, CompletableDeferred<JsonObject>>()

    private val client = HttpClient(CIO) {
        install(HttpTimeout) {
            requestTimeoutMillis = config.timeoutMs
            connectTimeoutMillis = 10_000
        }
    }

    private var sseJob: Job? = null
    private var reconnectJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var retryCount = 0
    private var messageEndpoint: String = ""

    override suspend fun connect() {
        if (_isConnected.get()) return

        val baseUrl = config.url.trimEnd('/')

        try {
            // Send initialize via HTTP POST
            sendInitialize(baseUrl)

            // Extract message endpoint
            messageEndpoint = "$baseUrl/messages"

            _isConnected.set(true)
            retryCount = 0

            // Start SSE listening
            val sseEndpoint = "$baseUrl/sse"
            sseJob = scope.launch {
                listenSSE(sseEndpoint)
            }
        } catch (e: Exception) {
            _isConnected.set(false)
            if (config.autoReconnect) {
                scheduleReconnect()
            }
            throw IllegalStateException("SSE connection failed: ${e.message}", e)
        }
    }

    override suspend fun send(request: JsonObject): JsonObject {
        if (!_isConnected.get()) {
            throw IllegalStateException("SSE transport not connected")
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

        val deferred = CompletableDeferred<JsonObject>()
        pendingRequests[requestId] = deferred

        try {
            val requestStr = json.encodeToString(JsonObject.serializer(), requestWithId)

            val response: HttpResponse = client.post(messageEndpoint) {
                contentType(ContentType.Application.Json)
                setBody(requestStr)
            }

            if (!response.status.isSuccess()) {
                throw IllegalStateException("HTTP POST failed with status ${response.status.value}")
            }

            val responseBody = response.bodyAsText()
            val responseJson = json.decodeFromString(JsonObject.serializer(), responseBody)

            return responseJson
        } finally {
            pendingRequests.remove(requestId)
        }
    }

    override suspend fun sendNotification(notification: JsonObject) {
        if (!_isConnected.get()) return

        try {
            val notifStr = json.encodeToString(JsonObject.serializer(), notification)
            client.post(messageEndpoint) {
                contentType(ContentType.Application.Json)
                setBody(notifStr)
            }
        } catch (_: Exception) {
            // Notifications are fire-and-forget
        }
    }

    override suspend fun disconnect() {
        _isConnected.set(false)
        sseJob?.cancel()
        sseJob = null
        reconnectJob?.cancel()
        reconnectJob = null

        pendingRequests.values.forEach { it.completeExceptionally(IllegalStateException("Transport disconnected")) }
        pendingRequests.clear()

        client.close()
    }

    private suspend fun sendInitialize(baseUrl: String) {
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

        // Send initialized notification
        val initializedNotif = buildJsonObject {
            put("jsonrpc", "2.0")
            put("method", "notifications/initialized")
        }
        val notifStr = json.encodeToString(JsonObject.serializer(), initializedNotif)
        client.post("$baseUrl/messages") {
            contentType(ContentType.Application.Json)
            setBody(notifStr)
        }
    }

    private suspend fun listenSSE(endpoint: String) {
        try {
            client.get(endpoint).let { response ->
                if (!response.status.isSuccess()) {
                    _isConnected.set(false)
                    scheduleReconnect()
                    return@let
                }

                val channel: ByteReadChannel = response.bodyAsChannel()
                while (currentCoroutineContext().isActive && _isConnected.get()) {
                    val line = try {
                        channel.readUTF8Line()
                    } catch (_: Exception) {
                        break
                    } ?: break
                    if (line.startsWith("data: ")) {
                        val data = line.removePrefix("data: ").trim()
                        if (data.isNotEmpty() && data != "[DONE]") {
                            handleSSEData(data)
                        }
                    }
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            // SSE connection lost
        } finally {
            _isConnected.set(false)
            if (config.autoReconnect && currentCoroutineContext().isActive) {
                scheduleReconnect()
            }
        }
    }

    private fun handleSSEData(data: String) {
        try {
            val response = json.decodeFromString(JsonObject.serializer(), data)
            val id = response["id"]?.let {
                when {
                    it.toString().toLongOrNull() != null -> it.toString().toLong()
                    else -> null
                }
            }

            if (id != null) {
                pendingRequests[id]?.complete(response)
            }
        } catch (_: Exception) {
            // Ignore unparseable SSE data
        }
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delay = min(
                config.retryDelayMs * (1L shl retryCount.coerceAtMost(10)),
                config.maxRetryDelayMs
            )
            retryCount++
            delay(delay)
            try {
                connect()
            } catch (_: Exception) {
                if (retryCount < config.maxRetries) {
                    scheduleReconnect()
                }
            }
        }
    }
}
