package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.CredentialReference
import com.heyanle.priestess.bot.config.model.McpServerDefinitionDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.RawConfigState
import com.heyanle.priestess.bot.config.model.RawWorkspaceConfigState
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ConfigurationCompilerTest {
    private val tools = listOf(
        ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ),
        ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE),
    )

    @Test
    fun `compiler applies environment resolves explicit references and builds effective Agent tool set`() {
        val raw = validRaw().let { state ->
            state.copy(document = state.document.copy(runtime = state.document.runtime.copy(server = state.document.runtime.server.copy(apiCredentialRef = CredentialReference(key = "SERVER_TOKEN")))))
        }
        val compiler = ConfigurationCompiler(
            environment = EnvironmentOverrideSource(
                mapOf(
                    "PROVIDER_KEY" to "actual-secret",
                    "SERVER_TOKEN" to "dashboard-secret",
                    "PRIESTESS_SERVER_PORT" to "28080",
                )::get,
            ),
        )

        val result = compiler.compile(raw, tools, availableSkillIds = emptySet())

        assertTrue(result.isSuccess, result.diagnostics.joinToString())
        val desired = assertNotNull(result.desired)
        assertEquals(28_080, desired.runtime.server.port)
        assertEquals("***", desired.providers.getValue("provider").credential.toString())
        assertEquals("***", desired.serverApiCredential.toString())
        assertEquals(setOf("read"), desired.workspaces.getValue("default").agents.getValue("agent").toolIds)
        assertEquals(
            "environment:PRIESTESS_SERVER_PORT",
            desired.provenance.getValue("runtime.server.port").sourceLocation,
        )
    }

    @Test
    fun `missing provider is a compilation error and never falls back`() {
        val raw = validRaw().let { state ->
            state.copy(
                workspaces = state.workspaces.mapValues { (_, workspace) ->
                    workspace.copy(
                        document = workspace.document.copy(
                            agents = workspace.document.agents.map { it.copy(providerRef = "missing") },
                        ),
                    )
                },
            )
        }
        val result = ConfigurationCompiler(
            environment = EnvironmentOverrideSource(mapOf("PROVIDER_KEY" to "key")::get),
        ).compile(raw, tools, emptySet())

        assertFalse(result.isSuccess)
        assertTrue(result.diagnostics.any { it.code == "WORKSPACE_AGENT_PROVIDER_MISSING" })
        assertEquals(null, result.desired)
    }

    @Test
    fun `required MCP failure rejects candidate while optional failure is diagnostic only`() {
        fun raw(required: Boolean) = validRaw().let { state ->
            state.copy(
                workspaces = state.workspaces.mapValues { (_, workspace) ->
                    workspace.copy(
                        document = workspace.document.copy(
                            mcpServers = listOf(
                                McpServerDefinitionDocument(
                                    id = "mcp",
                                    required = required,
                                    command = "mcp-server",
                                ),
                            ),
                        ),
                    )
                },
            )
        }
        val compiler = ConfigurationCompiler(
            environment = EnvironmentOverrideSource(mapOf("PROVIDER_KEY" to "key")::get),
            mcpConnector = McpServerConnector { _, _, _ -> error("offline") },
        )

        val required = compiler.compile(raw(true), tools, emptySet())
        val optional = compiler.compile(raw(false), tools, emptySet())

        assertFalse(required.isSuccess)
        assertTrue(required.diagnostics.any { it.code == "WORKSPACE_MCP_REQUIRED_FAILED" })
        assertTrue(optional.isSuccess, optional.diagnostics.joinToString())
        assertTrue(optional.diagnostics.any { it.code == "WORKSPACE_MCP_OPTIONAL_FAILED" })
    }

    private fun validRaw(): RawConfigState {
        val app = AppConfigDocument(
            providers = listOf(
                ProviderConnectionDocument(
                    id = "provider",
                    type = "openai-compatible",
                    credentialRef = CredentialReference(key = "PROVIDER_KEY"),
                ),
            ),
            workspaces = WorkspaceCatalogDocument(
                defaultWorkspaceId = "default",
                entries = listOf(WorkspaceCatalogEntryDocument("default", "workspace")),
            ),
        )
        val workspace = WorkspaceConfigDocument(
            id = "default",
            name = "Default",
            primaryAgentId = "agent",
            agents = listOf(
                AgentDefinitionDocument(
                    id = "agent",
                    providerRef = "provider",
                    model = "model",
                    toolPolicy = ToolPolicyDocument(allow = listOf("read")),
                ),
            ),
            toolPolicy = ToolPolicyDocument(allow = listOf("read", "write")),
        )
        return RawConfigState(
            document = app,
            sourcePath = "/config.json",
            revision = RawConfigRevision("app-revision"),
            workspaces = mapOf(
                "default" to RawWorkspaceConfigState(
                    document = workspace,
                    sourcePath = "/workspace/config.yaml",
                    revision = RawConfigRevision("workspace-revision"),
                    fingerprint = SourceFingerprint("workspace-fingerprint"),
                ),
            ),
        )
    }
}
