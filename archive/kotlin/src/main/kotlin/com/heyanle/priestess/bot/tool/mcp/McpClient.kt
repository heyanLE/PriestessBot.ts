package com.heyanle.priestess.bot.tool.mcp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * MCP client that manages the lifecycle of a single MCP server connection.
 *
 * Supports three transport types:
 * - stdio: child process via stdin/stdout
 * - sse: HTTP SSE long-lived connection
 * - streamable_http: HTTP POST request-response
 *
 * Provides tool listing and execution via MCP protocol methods.
 */
class McpClient(
    private val config: McpConfig,
) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val transport: McpTransport = when (config.transport.lowercase()) {
        "sse" -> SseTransport(config)
        "streamable_http", "http" -> StreamableHttpTransport(config)
        else -> StdioTransport(config) // Default to stdio
    }

    /**
     * Whether the client is connected.
     */
    val isConnected: Boolean get() = transport.isConnected

    /**
     * Connect to the MCP server.
     */
    suspend fun connect() {
        transport.connect()
    }

    /**
     * Disconnect from the MCP server.
     */
    suspend fun disconnect() {
        transport.disconnect()
    }

    /**
     * List all tools exposed by the MCP server.
     *
     * @return List of tool definitions as JsonObject (MCP tool format).
     */
    suspend fun listTools(): List<JsonObject> {
        if (!transport.isConnected) {
            throw IllegalStateException("MCP client not connected: ${config.name}")
        }

        val request = buildJsonObject {
            put("method", "tools/list")
        }

        val response = transport.send(request)
        val result = response["result"]?.jsonObject
            ?: throw IllegalStateException("tools/list returned no result")

        return result["tools"]?.jsonArray?.map { it.jsonObject } ?: emptyList()
    }

    /**
     * Call a tool on the MCP server.
     *
     * @param name The tool name.
     * @param arguments The tool arguments as a JsonObject.
     * @return The tool execution result content.
     */
    suspend fun callTool(name: String, arguments: JsonObject): String {
        if (!transport.isConnected) {
            throw IllegalStateException("MCP client not connected: ${config.name}")
        }

        val request = buildJsonObject {
            put("method", "tools/call")
            putJsonObject("params") {
                put("name", name)
                put("arguments", arguments)
            }
        }

        val response = transport.send(request)

        val result = response["result"]?.jsonObject
            ?: throw IllegalStateException("tools/call returned no result")

        val content = result["content"]?.jsonArray
            ?: return ""

        return content.joinToString("\n") { element ->
            val obj = element.jsonObject
            obj["text"]?.jsonPrimitive?.content ?: element.toString()
        }
    }

    /**
     * List all resources exposed by the MCP server.
     */
    suspend fun listResources(): List<JsonObject> {
        if (!transport.isConnected) {
            throw IllegalStateException("MCP client not connected: ${config.name}")
        }

        val request = buildJsonObject {
            put("method", "resources/list")
        }

        val response = transport.send(request)
        val result = response["result"]?.jsonObject
            ?: return emptyList()

        return result["resources"]?.jsonArray?.map { it.jsonObject } ?: emptyList()
    }

    /**
     * Read a resource from the MCP server.
     */
    suspend fun readResource(uri: String): String {
        if (!transport.isConnected) {
            throw IllegalStateException("MCP client not connected: ${config.name}")
        }

        val request = buildJsonObject {
            put("method", "resources/read")
            putJsonObject("params") {
                put("uri", uri)
            }
        }

        val response = transport.send(request)
        val result = response["result"]?.jsonObject
            ?: throw IllegalStateException("resources/read returned no result")

        val contents = result["contents"]?.jsonArray
            ?: return ""

        return contents.joinToString("\n") { element ->
            val obj = element.jsonObject
            obj["text"]?.jsonPrimitive?.content ?: element.toString()
        }
    }

    /**
     * Parse a tool definition from MCP format into a simplified representation.
     */
    fun parseToolDefinition(mcpToolDef: JsonObject): McpToolDef {
        val name = mcpToolDef["name"]?.jsonPrimitive?.content ?: "unknown"
        val description = mcpToolDef["description"]?.jsonPrimitive?.content ?: ""
        val inputSchema = mcpToolDef["inputSchema"]?.jsonObject

        return McpToolDef(
            name = name,
            description = description,
            inputSchema = inputSchema,
        )
    }
}

/**
 * Simplified representation of an MCP tool definition.
 */
data class McpToolDef(
    val name: String,
    val description: String,
    val inputSchema: JsonObject?,
)
