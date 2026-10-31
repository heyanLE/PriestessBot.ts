package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.tool.mcp.McpClient
import com.heyanle.priestess.bot.tool.mcp.McpConfig
import com.heyanle.priestess.bot.tool.mcp.McpToolDef
import kotlinx.serialization.json.JsonObject

class RealWorkspaceMcpClientSession(
    private val client: McpClient,
) : WorkspaceMcpClientSession {
    override val isConnected: Boolean
        get() = client.isConnected

    override suspend fun connect() {
        client.connect()
    }

    override suspend fun disconnect() {
        client.disconnect()
    }

    override suspend fun listTools(): List<JsonObject> = client.listTools()

    override fun parseToolDefinition(mcpToolDef: JsonObject): McpToolDef = client.parseToolDefinition(mcpToolDef)

    override suspend fun callTool(name: String, arguments: JsonObject): String = client.callTool(name, arguments)
}

class RealWorkspaceMcpClientFactory : WorkspaceMcpClientFactory {
    override fun create(config: WorkspaceMcpServerConfig): WorkspaceMcpClientSession {
        return RealWorkspaceMcpClientSession(
            McpClient(
                McpConfig(
                    name = config.id,
                    transport = config.transport,
                    command = config.command,
                    args = config.args,
                    env = config.env,
                    url = config.url,
                ),
            ),
        )
    }
}
