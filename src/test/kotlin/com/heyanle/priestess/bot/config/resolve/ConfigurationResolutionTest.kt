package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.model.WorkspaceSelectionRuleDocument
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConfigurationResolutionTest {
    @Test
    fun `workspace selector applies explicit rule platform and global precedence`() {
        val catalog = WorkspaceCatalogDocument(
            defaultWorkspaceId = "default",
            entries = listOf(
                WorkspaceCatalogEntryDocument("default", "default-dir"),
                WorkspaceCatalogEntryDocument(
                    "ops",
                    "ops-dir",
                    selectionRules = listOf(WorkspaceSelectionRuleDocument("ops-platform", priority = 10, platformIds = listOf("telegram"))),
                ),
                WorkspaceCatalogEntryDocument("platform", "platform-dir"),
            ),
        )
        val selector = WorkspaceSelector()

        assertEquals("ops", selector.select(catalog, WorkspaceSelectionContext(explicitWorkspaceId = "ops")).entry?.id)
        val rule = selector.select(catalog, WorkspaceSelectionContext(platformId = "telegram"))
        assertEquals("ops", rule.entry?.id)
        assertEquals("ops-platform", rule.ruleId)
        assertEquals(
            "platform",
            selector.select(catalog, WorkspaceSelectionContext(platformId = "other", platformDefaultWorkspaceId = "platform")).entry?.id,
        )
        assertEquals("default", selector.select(catalog, WorkspaceSelectionContext()).entry?.id)
    }

    @Test
    fun `unknown explicit workspace and equal matching rules fail without fallback`() {
        val catalog = WorkspaceCatalogDocument(
            defaultWorkspaceId = "default",
            entries = listOf(
                WorkspaceCatalogEntryDocument("default", "default-dir"),
                WorkspaceCatalogEntryDocument(
                    "one",
                    "one-dir",
                    selectionRules = listOf(WorkspaceSelectionRuleDocument("one-rule", platformIds = listOf("telegram"))),
                ),
                WorkspaceCatalogEntryDocument(
                    "two",
                    "two-dir",
                    selectionRules = listOf(WorkspaceSelectionRuleDocument("two-rule", platformIds = listOf("telegram"))),
                ),
            ),
        )
        val selector = WorkspaceSelector()

        val unknown = selector.select(catalog, WorkspaceSelectionContext(explicitWorkspaceId = "missing"))
        val ambiguous = selector.select(catalog, WorkspaceSelectionContext(platformId = "telegram"))

        assertFalse(unknown.isSuccess)
        assertTrue(unknown.diagnostics.any { it.code == "WORKSPACE_SELECTION_EXPLICIT_UNKNOWN" })
        assertFalse(ambiguous.isSuccess)
        assertTrue(ambiguous.diagnostics.any { it.code == "WORKSPACE_SELECTION_AMBIGUOUS" })
    }

    @Test
    fun `tool policy is runtime availability intersect workspace agent and permission`() {
        val available = listOf(
            ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ),
            ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE),
            ConfigurableToolDescriptor("danger", ToolRiskLevel.HIGH_RISK),
            ConfigurableToolDescriptor("other", ToolRiskLevel.SAFE_READ),
        )
        val resolved = ToolPolicyResolver().resolve(
            available = available,
            workspacePolicy = ToolPolicyDocument(allow = listOf("read", "write", "danger"), deny = listOf("danger")),
            agentPolicy = ToolPolicyDocument(allow = listOf("read", "write")),
            permissionAllowedRiskLevels = setOf(ToolRiskLevel.SAFE_READ),
        )

        assertEquals(setOf("read"), resolved)
    }

    @Test
    fun `default disabled tools require explicit Workspace allow`() {
        val available = listOf(
            ConfigurableToolDescriptor("reply", ToolRiskLevel.SESSION_ACTION, defaultEnabled = true),
            ConfigurableToolDescriptor("delete", ToolRiskLevel.HIGH_RISK, defaultEnabled = false),
        )
        val implicit = ToolPolicyResolver().resolve(available, ToolPolicyDocument(), ToolPolicyDocument())
        val explicit = ToolPolicyResolver().resolve(
            available,
            ToolPolicyDocument(allow = listOf("reply", "delete")),
            ToolPolicyDocument(),
        )

        assertEquals(setOf("reply"), implicit)
        assertEquals(setOf("delete", "reply"), explicit)
    }

    @Test
    fun `provenance enumerates typed leaf fields and fingerprints are deterministic`() {
        val builder = ConfigurationProvenanceBuilder()
        val global = AppConfigDocument()
        val workspace = WorkspaceConfigDocument(
            id = "default",
            name = "Default",
            primaryAgentId = "agent",
            agents = listOf(AgentDefinitionDocument("agent", providerRef = "provider", model = "model")),
        )

        val globalProvenance = builder.global(global, "/config.json", RawConfigRevision("global-revision"))
        val workspaceProvenance = builder.workspace(workspace, "/workspace/config.yaml", RawConfigRevision("workspace-revision"))
        val first = builder.fingerprint("one", "two")
        val second = builder.fingerprint("one", "two")

        assertTrue("runtime.server.port" in globalProvenance)
        assertTrue("workspaces[default].agents[0].providerRef" in workspaceProvenance)
        assertEquals("global-revision", globalProvenance.getValue("runtime.server.port").sourceRevision)
        assertEquals(first, second)
        assertFalse(first.value.isBlank())
    }
}
