package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.tool.mcp.McpToolDef
import kotlinx.serialization.json.JsonObject

interface WorkspaceMcpClientSession {
    val isConnected: Boolean

    suspend fun connect()

    suspend fun disconnect()

    suspend fun listTools(): List<JsonObject>

    fun parseToolDefinition(mcpToolDef: JsonObject): McpToolDef

    suspend fun callTool(name: String, arguments: JsonObject): String
}

fun interface WorkspaceMcpClientFactory {
    fun create(config: WorkspaceMcpServerConfig): WorkspaceMcpClientSession
}
