package com.heyanle.priestess.bot.workspace

import kotlinx.coroutines.runBlocking

class RealWorkspaceMcpToolResolver(
    private val factory: WorkspaceMcpClientFactory = RealWorkspaceMcpClientFactory(),
) : WorkspaceMcpToolResolver {
    override fun resolve(workspaceId: String, servers: List<WorkspaceMcpServerConfig>): WorkspaceMcpToolResolution {
        if (servers.isEmpty()) return WorkspaceMcpToolResolution()

        val resources = mutableListOf<WorkspaceMcpResource>()
        val handles = mutableListOf<WorkspaceMcpClientHandle>()
        val diagnostics = mutableListOf<String>()

        try {
            for (server in servers) {
                val session = factory.create(server)
                val handle = WorkspaceMcpClientHandle {
                    runBlocking { session.disconnect() }
                }
                handles += handle
                val exposedTools = runBlocking {
                    session.connect()
                    session.listTools().map { toolJson ->
                        val toolDef = session.parseToolDefinition(toolJson)
                        WorkspaceMcpToolAdapter(server.id, session, toolDef)
                    }
                }
                if (exposedTools.isEmpty()) {
                    diagnostics += "MCP server '${server.id}' exposed no tools"
                }
                exposedTools.forEach { tool ->
                    resources += WorkspaceMcpResource(tool = tool, handle = handle)
                }
            }
        } catch (cause: Exception) {
            throw WorkspaceMcpResolutionException(
                message = "Workspace '$workspaceId' MCP client initialization failed: ${cause.message ?: cause::class.simpleName}",
                handles = handles,
                cause = cause,
            )
        }

        return WorkspaceMcpToolResolution(
            resources = resources,
            handles = handles,
            diagnostics = diagnostics,
        )
    }
}
