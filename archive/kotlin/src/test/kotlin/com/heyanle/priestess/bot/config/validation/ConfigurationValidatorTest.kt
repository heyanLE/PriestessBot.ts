package com.heyanle.priestess.bot.config.validation

import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.AgentRouteDocument
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.GenerationSettingsDocument
import com.heyanle.priestess.bot.config.model.OrchestrationDocument
import com.heyanle.priestess.bot.config.model.PlatformConnectionDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.model.ContextSettingsDocument
import com.heyanle.priestess.bot.config.model.ToolResultSettingsDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConfigurationValidatorTest {
    private val validator = ConfigurationValidator()

    @Test
    fun `global validation reports duplicates unsafe paths invalid ranges and missing references`() {
        val document = AppConfigDocument(
            platforms = listOf(
                PlatformConnectionDocument("platform", "telegram", defaultWorkspaceId = "missing"),
                PlatformConnectionDocument("platform", "telegram"),
            ),
            providers = listOf(
                ProviderConnectionDocument("provider", "openai"),
                ProviderConnectionDocument("provider", "openai"),
            ),
            workspaces = WorkspaceCatalogDocument(
                defaultWorkspaceId = "missing",
                entries = listOf(WorkspaceCatalogEntryDocument("default", "../outside")),
            ),
            runtime = com.heyanle.priestess.bot.config.model.RuntimeConfigDocument(
                server = com.heyanle.priestess.bot.config.model.ServerRuntimeDocument(port = 70_000),
                reload = com.heyanle.priestess.bot.config.model.ReloadRuntimeDocument(intervalMillis = 100),
            ),
        )

        val codes = validator.validateGlobal(document, "app.json").map { it.code }.toSet()

        assertTrue("CONFIG_PLATFORM_ID_DUPLICATE" in codes)
        assertTrue("CONFIG_PROVIDER_ID_DUPLICATE" in codes)
        assertTrue("CONFIG_DEFAULT_WORKSPACE_MISSING" in codes)
        assertTrue("CONFIG_WORKSPACE_DIRECTORY_UNSAFE" in codes)
        assertTrue("CONFIG_SERVER_PORT_INVALID" in codes)
        assertTrue("CONFIG_PLATFORM_WORKSPACE_MISSING" in codes)
    }

    @Test
    fun `workspace validation reports every unresolved behavior reference`() {
        val entry = WorkspaceCatalogEntryDocument("default", "workspace")
        val workspace = WorkspaceConfigDocument(
            id = "default",
            name = "Default",
            primaryAgentId = "missing-primary",
            agents = listOf(
                AgentDefinitionDocument(
                    id = "agent",
                    providerRef = "missing-provider",
                    model = "",
                    generation = GenerationSettingsDocument(temperature = 4.0),
                    context = ContextSettingsDocument(
                        toolResults = ToolResultSettingsDocument(
                            inlineTokens = 0,
                            previewTokens = 2,
                            ttlSeconds = 0,
                            maxBytes = 10,
                            storeMaxBytes = 5,
                        ),
                    ),
                    personaRef = "missing-persona",
                    toolPolicy = ToolPolicyDocument(allow = listOf("unknown", "same"), deny = listOf("same")),
                ),
            ),
            orchestration = OrchestrationDocument(
                enabled = true,
                defaultAgentId = "missing-default",
                routes = listOf(AgentRouteDocument("route", "missing-route-agent")),
            ),
            toolPolicy = ToolPolicyDocument(allow = listOf("unknown")),
        )

        val codes = validator.validateWorkspace(
            document = workspace,
            catalogEntry = entry,
            providers = emptySet(),
            availableToolIds = setOf("same"),
            availableSkillIds = emptySet(),
            source = "config.yaml",
        ).map { it.code }.toSet()

        assertTrue("WORKSPACE_PRIMARY_AGENT_MISSING" in codes)
        assertTrue("WORKSPACE_DEFAULT_AGENT_MISSING" in codes)
        assertTrue("WORKSPACE_ROUTE_AGENT_MISSING" in codes)
        assertTrue("WORKSPACE_AGENT_PROVIDER_MISSING" in codes)
        assertTrue("WORKSPACE_AGENT_MODEL_BLANK" in codes)
        assertTrue("WORKSPACE_AGENT_PERSONA_MISSING" in codes)
        assertTrue("WORKSPACE_TOOL_RESULT_INLINE_TOKENS_INVALID" in codes)
        assertTrue("WORKSPACE_TOOL_RESULT_PREVIEW_TOKENS_INVALID" in codes)
        assertTrue("WORKSPACE_TOOL_RESULT_TTL_INVALID" in codes)
        assertTrue("WORKSPACE_TOOL_RESULT_STORE_BYTES_INVALID" in codes)
        assertTrue("WORKSPACE_TOOL_UNKNOWN" in codes)
        assertTrue("WORKSPACE_TOOL_POLICY_CONTRADICTORY" in codes)
        assertFalse(codes.isEmpty())
    }

    @Test
    fun `valid cross-document configuration produces no diagnostics`() {
        val entry = WorkspaceCatalogEntryDocument("default", "workspace")
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
            toolPolicy = ToolPolicyDocument(allow = listOf("read")),
        )

        val diagnostics = validator.validateWorkspace(
            workspace,
            entry,
            providers = setOf("provider"),
            availableToolIds = setOf("read"),
            availableSkillIds = emptySet(),
            source = "config.yaml",
        )

        assertTrue(diagnostics.isEmpty(), diagnostics.joinToString())
    }
}
