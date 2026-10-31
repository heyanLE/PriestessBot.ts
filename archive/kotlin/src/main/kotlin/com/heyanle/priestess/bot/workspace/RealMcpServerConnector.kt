package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.McpServerDefinitionDocument
import com.heyanle.priestess.bot.config.resolve.McpRuntimeConnection
import com.heyanle.priestess.bot.config.resolve.McpServerConnector

/** Bridges the v2 compiler to the executable MCP client implementation. */
class RealMcpServerConnector(
    private val resolver: WorkspaceMcpToolResolver = RealWorkspaceMcpToolResolver(),
) : McpServerConnector {
    override fun connect(
        workspaceId: String,
        server: McpServerDefinitionDocument,
        credentials: Map<String, GuardedSecret>,
    ): McpRuntimeConnection {
        val resolution = resolver.resolve(
            workspaceId,
            listOf(
                WorkspaceMcpServerConfig(
                    id = server.id,
                    enabled = server.enabled,
                    transport = server.transport,
                    command = server.command,
                    args = server.args,
                    url = server.url,
                    env = credentials.mapValues { (_, value) -> value.reveal() },
                ),
            ),
        )
        val handles = resolution.handles.distinct()
        val handle = handles.takeIf { it.isNotEmpty() }?.let { active ->
            AutoCloseable { active.forEach { current -> runCatching { current.close() } } }
        }
        return McpRuntimeConnection(
            tools = resolution.resources.map { it.tool },
            handle = handle,
        )
    }
}
