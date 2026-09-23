package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.CredentialReference
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.ServerRuntimeDocument
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import java.nio.file.Files
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ConfigurationManagementServiceTest {
    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun `raw and effective queries are revisioned and never expose resolved secrets`() {
        val fixture = fixture()

        val activated = fixture.runtime.startup()
        val raw = fixture.management.raw()
        val effective = assertNotNull(fixture.management.effective())

        assertTrue(activated.success, activated.diagnostics.joinToString())
        assertNotNull(raw.revision)
        assertEquals(2, raw.schemaVersion)
        assertEquals(fixture.root.toAbsolutePath().normalize().toString(), raw.normalizedSourcePath)
        assertEquals("SECRET_TOKEN", raw.document?.providers?.single()?.credentialRef?.key)
        assertEquals("***", effective.providers.getValue("provider").credential)
        assertFalse(json.encodeToString(raw).contains("resolved-secret"))
        assertFalse(json.encodeToString(effective).contains("resolved-secret"))
    }

    @Test
    fun `preview is side effect free and stale apply cannot overwrite source`() {
        val fixture = fixture()
        assertTrue(fixture.runtime.startup().success)
        val activeBefore = assertNotNull(fixture.management.effective())
        val changed = fixture.app.copy(
            runtime = fixture.app.runtime.copy(server = ServerRuntimeDocument(port = 29090)),
        )

        val preview = fixture.management.preview(ConfigurationContentRequest(json.encodeToString(changed)))
        val activeAfterPreview = assertNotNull(fixture.management.effective())
        val conflict = fixture.management.apply(
            ConfigurationApplyRequest(
                content = json.encodeToString(changed),
                expectedRevision = RawConfigRevision("stale").value,
            ),
        )

        assertTrue(preview.success, preview.diagnostics.joinToString())
        assertEquals(activeBefore.activeVersion, activeAfterPreview.activeVersion)
        assertEquals(activeBefore.runtime.server.port, activeAfterPreview.runtime.server.port)
        assertFalse(conflict.success)
        assertTrue(conflict.diagnostics.any { it.code == "CONFIG_REVISION_CONFLICT" })
        assertEquals(fixture.app.runtime.server.port, json.decodeFromString<AppConfigDocument>(Files.readString(fixture.root)).runtime.server.port)
    }

    @Test
    fun `workspace preview and revisioned apply share compiler and activation path`() {
        val fixture = fixture()
        assertTrue(fixture.runtime.startup().success)
        val rawBefore = fixture.management.rawWorkspace("ops")
        val activeBefore = assertNotNull(fixture.management.effective())
        val updated = assertNotNull(rawBefore.document).copy(name = "Operations")

        val preview = fixture.management.previewWorkspace(
            "ops",
            ConfigurationContentRequest(json.encodeToString(updated)),
        )
        assertTrue(preview.success, preview.diagnostics.joinToString())
        assertEquals("Ops", fixture.management.effective()?.workspaces?.get("ops")?.name)

        val applied = fixture.management.applyWorkspace(
            "ops",
            ConfigurationApplyRequest(json.encodeToString(updated), rawBefore.revision),
        )

        assertTrue(applied.success, applied.diagnostics.joinToString())
        assertTrue(assertNotNull(applied.activeVersion) > activeBefore.activeVersion)
        assertEquals("Operations", fixture.management.rawWorkspace("ops").document?.name)
        assertEquals("Operations", fixture.management.effective()?.workspaces?.get("ops")?.name)
    }

    private fun fixture(): Fixture {
        val directory = Files.createTempDirectory("configuration-management")
        val workspaceDirectory = Files.createDirectories(directory.resolve("workspaces/ops"))
        val root = directory.resolve("config.json")
        val app = AppConfigDocument(
            providers = listOf(
                ProviderConnectionDocument(
                    id = "provider",
                    type = "fake",
                    credentialRef = CredentialReference(key = "SECRET_TOKEN"),
                ),
            ),
            workspaces = WorkspaceCatalogDocument(
                defaultWorkspaceId = "ops",
                entries = listOf(WorkspaceCatalogEntryDocument("ops", "workspaces/ops")),
            ),
        )
        val workspace = WorkspaceConfigDocument(
            id = "ops",
            name = "Ops",
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
        Files.writeString(root, json.encodeToString(app))
        Files.writeString(workspaceDirectory.resolve("config.yaml"), json.encodeToString(workspace))
        val store = EffectiveConfigStore()
        val runtime = ConfigurationRuntimeService(
            configPath = root,
            compiler = ConfigurationCompiler(
                environment = EnvironmentOverrideSource(mapOf("SECRET_TOKEN" to "resolved-secret")::get),
            ),
            store = store,
            registeredTools = { listOf(ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ)) },
            availableSkills = { emptySet() },
        )
        return Fixture(root, app, runtime, ConfigurationManagementService(runtime))
    }

    private data class Fixture(
        val root: java.nio.file.Path,
        val app: AppConfigDocument,
        val runtime: ConfigurationRuntimeService,
        val management: ConfigurationManagementService,
    )
}
