package com.heyanle.priestess.bot.tool.mcp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Transport abstraction for MCP communication.
 *
 * Each transport implementation handles a specific MCP protocol transport:
 * - StdioTransport: child process via stdin/stdout
 * - SseTransport: HTTP SSE long-lived connection
 * - StreamableHttpTransport: HTTP POST request-response
 */
interface McpTransport {
    /**
     * Whether this transport is currently connected.
     */
    val isConnected: Boolean

    /**
     * Establish the connection.
     */
    suspend fun connect()

    /**
     * Send a JSON-RPC request and return the response.
     *
     * @param request The JSON-RPC request as a JsonObject.
     * @return The JSON-RPC response as a JsonObject.
     */
    suspend fun send(request: JsonObject): JsonObject

    /**
     * Send a JSON-RPC notification (no response expected).
     *
     * @param notification The JSON-RPC notification as a JsonObject.
     */
    suspend fun sendNotification(notification: JsonObject)

    /**
     * Disconnect and clean up resources.
     */
    suspend fun disconnect()
}

/**
 * MCP configuration data class.
 *
 * Supports three transport types with their respective connection parameters.
 */
@Serializable
data class McpConfig(
    /** Unique name for this MCP server connection. */
    val name: String = "",

    /** Transport type: "stdio", "sse", or "streamable_http". */
    val transport: String = "stdio",

    /** Whether this MCP server is enabled. */
    val enabled: Boolean = true,

    // ── Stdio transport params ──
    /** Command to spawn the child process (stdio transport). */
    val command: String = "",

    /** Arguments for the child process (stdio transport). */
    val args: List<String> = emptyList(),

    /** Environment variables for the child process (stdio transport). */
    val env: Map<String, String> = emptyMap(),

    // ── SSE / Streamable HTTP transport params ──
    /** Base URL for the MCP server (SSE/HTTP transport). */
    val url: String = "",

    /** Request timeout in milliseconds. */
    val timeoutMs: Long = 30_000,

    /** Maximum retry attempts on connection failure. */
    val maxRetries: Int = 5,

    /** Initial retry delay in milliseconds (for exponential backoff). */
    val retryDelayMs: Long = 1_000,

    /** Maximum retry delay in milliseconds. */
    val maxRetryDelayMs: Long = 30_000,

    /** Auto-reconnect on disconnection. */
    val autoReconnect: Boolean = true,
)
