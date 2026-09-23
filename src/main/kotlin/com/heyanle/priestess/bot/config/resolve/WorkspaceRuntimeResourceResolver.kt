package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.McpServerDefinitionDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.tool.FunctionTool

data class McpRuntimeConnection(
    val tools: List<FunctionTool> = emptyList(),
    val handle: AutoCloseable? = null,
)

fun interface McpServerConnector {
    fun connect(
        workspaceId: String,
        server: McpServerDefinitionDocument,
        credentials: Map<String, GuardedSecret>,
    ): McpRuntimeConnection

    companion object {
        val Unsupported = McpServerConnector { _, server, _ ->
            error("No MCP connector is configured for server '${server.id}'")
        }
    }
}

data class WorkspaceRuntimeResources(
    val tools: List<FunctionTool>,
    val skillIds: Set<String>,
    val handles: List<AutoCloseable>,
    val diagnostics: List<ConfigurationDiagnostic>,
) {
    val mcpToolIds: Set<String> get() = tools.mapTo(linkedSetOf()) { it.schema.name }
}

class WorkspaceRuntimeResourceResolver(
    private val environment: EnvironmentOverrideSource,
    private val mcpConnector: McpServerConnector = McpServerConnector.Unsupported,
) {
    fun resolve(
        workspace: WorkspaceConfigDocument,
        registeredTools: Collection<ConfigurableToolDescriptor>,
        availableSkillIds: Set<String>,
    ): WorkspaceRuntimeResources {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        val handles = mutableListOf<AutoCloseable>()
        val mcpTools = mutableListOf<FunctionTool>()
        workspace.mcpServers.filter { it.enabled }.forEachIndexed { index, server ->
            val credentialDiagnostics = mutableListOf<ConfigurationDiagnostic>()
            val credentials = linkedMapOf<String, GuardedSecret>()
            server.credentialRefs.forEach { (name, reference) ->
                val resolution = environment.resolveCredential(reference, "mcpServers[$index].credentialRefs.$name")
                resolution.credential?.let { credentials[name] = it }
                credentialDiagnostics += resolution.diagnostics
            }
            val connection = if (credentialDiagnostics.isEmpty()) {
                runCatching { mcpConnector.connect(workspace.id, server, credentials) }
            } else {
                Result.failure(IllegalStateException("MCP credentials could not be resolved"))
            }
            connection.onSuccess { connected ->
                mcpTools += connected.tools
                connected.handle?.let(handles::add)
            }.onFailure { cause ->
                val severity = if (server.required) DiagnosticSeverity.ERROR else DiagnosticSeverity.WARNING
                diagnostics += credentialDiagnostics.map { it.copy(severity = severity) }
                diagnostics += ConfigurationDiagnostic(
                    code = if (server.required) "WORKSPACE_MCP_REQUIRED_FAILED" else "WORKSPACE_MCP_OPTIONAL_FAILED",
                    severity = severity,
                    message = "MCP server '${server.id}' failed: ${cause.message ?: cause::class.simpleName}",
                    source = "workspace:${workspace.id}",
                    path = "mcpServers[$index]",
                )
            }
        }
        val duplicateMcpTools = mcpTools.groupingBy { it.schema.name }.eachCount().filterValues { it > 1 }.keys
        duplicateMcpTools.forEach { id ->
            diagnostics += ConfigurationDiagnostic(
                code = "WORKSPACE_MCP_TOOL_DUPLICATE",
                severity = DiagnosticSeverity.ERROR,
                message = "Multiple MCP servers expose tool '$id'",
                source = "workspace:${workspace.id}",
                path = "mcpServers",
            )
        }
        val registeredIds = registeredTools.mapTo(linkedSetOf()) { it.id }
        mcpTools.filter { it.schema.name in registeredIds }.forEach { tool ->
            diagnostics += ConfigurationDiagnostic(
                code = "WORKSPACE_MCP_TOOL_CONFLICT",
                severity = DiagnosticSeverity.ERROR,
                message = "MCP tool '${tool.schema.name}' conflicts with a registered runtime tool",
                source = "workspace:${workspace.id}",
                path = "mcpServers",
            )
        }
        return WorkspaceRuntimeResources(
            tools = mcpTools.distinctBy { it.schema.name },
            skillIds = workspace.skills.filter { it.enabled && it.id in availableSkillIds }.mapTo(linkedSetOf()) { it.id },
            handles = handles,
            diagnostics = diagnostics,
        )
    }
}
