package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.McpServerDefinitionDocument
import com.heyanle.priestess.bot.config.model.SkillDefinitionDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.testkit.FakeTool
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkspaceRuntimeResourceResolverTest {
    @Test
    fun `resolver collects available skills MCP tools and resource handle`() {
        var closed = false
        val resolver = WorkspaceRuntimeResourceResolver(
            environment = EnvironmentOverrideSource { null },
            mcpConnector = McpServerConnector { _, _, _ ->
                McpRuntimeConnection(
                    tools = listOf(FakeTool("mcp.read")),
                    handle = AutoCloseable { closed = true },
                )
            },
        )
        val resources = resolver.resolve(
            workspace = workspace(McpServerDefinitionDocument("mcp", command = "server")),
            registeredTools = listOf(ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ)),
            availableSkillIds = setOf("known"),
        )

        assertEquals(setOf("mcp.read"), resources.mcpToolIds)
        assertEquals(setOf("known"), resources.skillIds)
        assertTrue(resources.diagnostics.isEmpty())
        resources.handles.single().close()
        assertTrue(closed)
    }

    @Test
    fun `optional MCP failure is warning and contributes no tools`() {
        val resolver = WorkspaceRuntimeResourceResolver(
            environment = EnvironmentOverrideSource { null },
            mcpConnector = McpServerConnector { _, _, _ -> error("offline") },
        )

        val resources = resolver.resolve(
            workspace = workspace(McpServerDefinitionDocument("mcp", required = false, command = "server")),
            registeredTools = emptyList(),
            availableSkillIds = setOf("known"),
        )

        assertTrue(resources.tools.isEmpty())
        assertTrue(resources.diagnostics.any { it.code == "WORKSPACE_MCP_OPTIONAL_FAILED" })
        assertFalse(resources.diagnostics.any { it.severity == com.heyanle.priestess.bot.config.model.DiagnosticSeverity.ERROR })
    }

    private fun workspace(server: McpServerDefinitionDocument) = WorkspaceConfigDocument(
        id = "default",
        name = "Default",
        primaryAgentId = "agent",
        agents = listOf(AgentDefinitionDocument("agent", providerRef = "provider", model = "model")),
        skills = listOf(SkillDefinitionDocument("known"), SkillDefinitionDocument("missing")),
        mcpServers = listOf(server),
    )
}
