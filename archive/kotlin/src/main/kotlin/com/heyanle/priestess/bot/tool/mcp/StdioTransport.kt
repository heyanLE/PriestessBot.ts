package com.heyanle.priestess.bot.tool.mcp

import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.BufferedWriter
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Stdio-based MCP transport.
 *
 * Spawns a child process and communicates with it via stdin/stdout
 * using JSON-RPC messages. The child process is auto-restarted on
 * unexpected termination.
 */
class StdioTransport(
    private val config: McpConfig,
) : McpTransport {

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private var process: Process? = null
    private var reader: BufferedReader? = null
    private var writer: BufferedWriter? = null

    private val _isConnected = AtomicBoolean(false)
    override val isConnected: Boolean get() = _isConnected.get()

    private val requestIdCounter = AtomicLong(1)
    private val pendingRequests = mutableMapOf<Long, CompletableDeferred<JsonObject>>()
    private var readJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override suspend fun connect() {
        if (_isConnected.get()) return

        val pb = ProcessBuilder(listOf(config.command) + config.args)
        pb.environment().putAll(config.env)
        pb.redirectErrorStream(true) // Merge stderr into stdout for simpler reading

        process = pb.start()
        reader = BufferedReader(InputStreamReader(process!!.inputStream))
        writer = BufferedWriter(OutputStreamWriter(process!!.outputStream))

        _isConnected.set(true)

        // Start reading responses from stdout
        readJob = scope.launch {
            try {
                var line: String?
                while (currentCoroutineContext().isActive && _isConnected.get()) {
                    line = reader?.readLine() ?: break
                    if (line.isNullOrBlank()) continue
                    handleResponse(line)
                }
            } catch (e: Exception) {
                // Connection lost
            } finally {
                _isConnected.set(false)
            }
        }

        // Monitor process for unexpected termination
        scope.launch {
            try {
                val exitCode = process?.waitFor() ?: return@launch
                _isConnected.set(false)
                if (config.autoReconnect && exitCode != 0) {
                    delay(config.retryDelayMs)
                    connect()
                }
            } catch (_: Exception) {
                _isConnected.set(false)
            }
        }

        // Send initialize request
        sendInitialize()
    }

    override suspend fun send(request: JsonObject): JsonObject {
        if (!_isConnected.get()) {
            throw IllegalStateException("StdioTransport not connected")
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
            writer?.let { w ->
                w.write(requestStr)
                w.newLine()
                w.flush()
            } ?: throw IllegalStateException("Writer is null")

            return withTimeout(config.timeoutMs) {
                deferred.await()
            }
        } finally {
            pendingRequests.remove(requestId)
        }
    }

    override suspend fun sendNotification(notification: JsonObject) {
        if (!_isConnected.get()) return

        val notifWithJsonRpc = buildJsonObject {
            put("jsonrpc", "2.0")
            for ((key, value) in notification) {
                put(key, value)
            }
        }

        val notifStr = json.encodeToString(JsonObject.serializer(), notifWithJsonRpc)
        writer?.let { w ->
            w.write(notifStr)
            w.newLine()
            w.flush()
        }
    }

    override suspend fun disconnect() {
        _isConnected.set(false)
        readJob?.cancel()
        readJob = null

        pendingRequests.values.forEach { it.completeExceptionally(IllegalStateException("Transport disconnected")) }
        pendingRequests.clear()

        try {
            writer?.close()
        } catch (_: Exception) {}
        try {
            reader?.close()
        } catch (_: Exception) {}
        try {
            process?.destroyForcibly()
            process?.waitFor()
        } catch (_: Exception) {}

        writer = null
        reader = null
        process = null
    }

    private suspend fun sendInitialize() {
        val initRequest = buildJsonObject {
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

        try {
            send(initRequest)

            // Send initialized notification
            sendNotification(buildJsonObject {
                put("method", "notifications/initialized")
            })
        } catch (e: Exception) {
            disconnect()
            throw IllegalStateException("MCP initialization failed: ${e.message}", e)
        }
    }

    private fun handleResponse(line: String) {
        try {
            val response = json.decodeFromString(JsonObject.serializer(), line)
            val id = response["id"]?.let {
                when {
                    it.toString().toLongOrNull() != null -> it.toString().toLong()
                    else -> null
                }
            }

            if (id != null) {
                pendingRequests[id]?.complete(response)
            }
            // Notifications (no id) are ignored
        } catch (_: Exception) {
            // Ignore unparseable lines
        }
    }
}
