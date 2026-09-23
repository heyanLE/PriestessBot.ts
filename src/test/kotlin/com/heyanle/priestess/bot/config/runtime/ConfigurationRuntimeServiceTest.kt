package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.PipelineRuntimeDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.RuntimeConfigDocument
import com.heyanle.priestess.bot.config.model.ServerRuntimeDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.config.source.RevisionedConfigFileStore
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.workspace.WorkspaceController
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ConfigurationRuntimeServiceTest {
    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun `startup reload preview apply and revision conflict use one compiler and activation path`() {
        val fixture = fixture()
        val initial = fixture.service.startup()

        assertTrue(initial.success, initial.diagnostics.joinToString())
        assertEquals(1, initial.activeVersion)
        assertEquals(8080, fixture.store.requireCurrent().runtime.server.port)

        val candidate = fixture.app.copy(
            runtime = fixture.app.runtime.copy(
                server = fixture.app.runtime.server.copy(port = 9090),
                pipeline = fixture.app.runtime.pipeline.copy(wakingPrefix = "!"),
            ),
        )
        val content = json.encodeToString(candidate)
        val beforePreview = fixture.store.requireCurrent().version
        val preview = fixture.service.preview(content)
        assertTrue(preview.success, preview.diagnostics.joinToString())
        assertEquals(beforePreview, fixture.store.requireCurrent().version)
        assertTrue("runtime.server" in preview.activationPlan.restartRequiredPaths)
        assertTrue("runtime.pipeline" in preview.activationPlan.livePaths)

        val expected = RevisionedConfigFileStore().revision(fixture.configPath)
        val applied = fixture.service.apply(content, expected)
        assertTrue(applied.success, applied.diagnostics.joinToString())
        assertEquals(2, applied.activeVersion)
        assertEquals(listOf("runtime.server"), applied.pendingRestartPaths)
        assertEquals(8080, fixture.store.requireCurrent().runtime.server.port)
        assertEquals("!", fixture.store.requireCurrent().runtime.pipeline.wakingPrefix)
        assertEquals(content, fixture.configPath.readText())

        val conflict = fixture.service.apply(json.encodeToString(fixture.app), expected)
        assertFalse(conflict.success)
        assertTrue(conflict.diagnostics.any { it.code == "CONFIG_REVISION_CONFLICT" })
        assertEquals(2, fixture.store.requireCurrent().version.value)
    }

    @Test
    fun `invalid global and Workspace reloads preserve last known good snapshot and source content`() {
        val fixture = fixture()
        assertTrue(fixture.service.startup().success)
        val active = fixture.store.requireCurrent()

        Files.writeString(fixture.configPath, "{ malformed")
        val malformed = fixture.service.reloadFromDisk()

        assertFalse(malformed.success)
        assertEquals("{ malformed", fixture.configPath.readText())
        assertEquals(active.version, fixture.store.requireCurrent().version)
        assertEquals(active.sourceFingerprint, fixture.store.requireCurrent().sourceFingerprint)

        Files.writeString(fixture.configPath, json.encodeToString(fixture.app))
        Files.writeString(fixture.workspaceDir.resolve("config.yaml"), workspaceYaml(provider = "missing-provider"))
        val invalidWorkspace = fixture.service.reloadWorkspace("default")

        assertFalse(invalidWorkspace.success)
        assertTrue(invalidWorkspace.diagnostics.any { it.code == "WORKSPACE_AGENT_PROVIDER_MISSING" })
        assertEquals(active.version, fixture.store.requireCurrent().version)
    }

    @Test
    fun `Workspace controller exposes catalog snapshots and reloads only through compiler`() {
        val fixture = fixture()
        assertTrue(fixture.service.startup().success)
        val controller = WorkspaceController(
            effectiveStore = fixture.store,
            configurationRuntime = fixture.service,
        )

        val before = assertNotNull(controller.get("default"))
        assertEquals(fixture.workspaceDir.toAbsolutePath().normalize().toString(), before.rootDir)
        assertEquals(listOf("agent"), before.agentIds)

        Files.writeString(fixture.workspaceDir.resolve("config.yaml"), workspaceYaml().replace("name: Default", "name: Reloaded"))
        val reloaded = controller.reload("default")

        assertTrue(reloaded.success, reloaded.diagnostics.joinToString())
        assertEquals("Reloaded", controller.get("default")?.name)
        assertTrue(checkNotNull(reloaded.snapshotVersion) > before.version)
    }

    @Test
    fun `backup restore and watched stable reload use the common activation path`() = runBlocking {
        val fixture = fixture()
        assertTrue(fixture.service.startup().success)
        val firstRevision = RevisionedConfigFileStore().revision(fixture.configPath)
        val changed = fixture.app.copy(runtime = fixture.app.runtime.copy(pipeline = PipelineRuntimeDocument(wakingPrefix = "!")))
        assertTrue(fixture.service.apply(json.encodeToString(changed), firstRevision).success)
        val backup = Files.list(fixture.configPath.parent.resolve("backups").resolve("config.json")).use { it.findFirst().orElseThrow() }

        val restored = fixture.service.restore(backup, RevisionedConfigFileStore().revision(fixture.configPath))
        assertTrue(restored.success, restored.diagnostics.joinToString())
        assertEquals("/", fixture.store.requireCurrent().runtime.pipeline.wakingPrefix)
        val listed = fixture.service.listBackups()
        assertTrue(listed.any { it.id == backup.fileName.toString() })
        val restoredById = fixture.service.restoreBackup(
            backup.fileName.toString(),
            RevisionedConfigFileStore().revision(fixture.configPath),
        )
        assertTrue(restoredById.success, restoredById.diagnostics.joinToString())

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val job = fixture.service.startWatcher(scope, pollIntervalMillis = 50, stabilityWindowMillis = 50)
        val watched = fixture.app.copy(runtime = fixture.app.runtime.copy(pipeline = PipelineRuntimeDocument(wakingPrefix = "#")))
        Files.writeString(fixture.configPath, json.encodeToString(watched))
        repeat(20) {
            if (fixture.store.requireCurrent().runtime.pipeline.wakingPrefix == "#") return@repeat
            delay(50)
        }
        job.cancel()
        scope.cancel()

        assertEquals("#", fixture.store.requireCurrent().runtime.pipeline.wakingPrefix)
        assertTrue(fixture.store.requireCurrent().version.value >= 4)
    }

    @Test
    fun `configured watcher follows the active v2 reload policy`() = runBlocking {
        val fixture = fixture()
        val watchedSource = fixture.app.copy(
            runtime = fixture.app.runtime.copy(
                reload = fixture.app.runtime.reload.copy(enabled = true, intervalMillis = 250, stabilityWindowMillis = 50),
            ),
        )
        Files.writeString(fixture.configPath, json.encodeToString(watchedSource))
        assertTrue(fixture.service.startup().success)
        fixture.service.startConfiguredWatcher()
        delay(100)

        Files.writeString(
            fixture.configPath,
            json.encodeToString(watchedSource.copy(runtime = watchedSource.runtime.copy(pipeline = PipelineRuntimeDocument(wakingPrefix = "#")))),
        )
        repeat(120) {
            if (fixture.store.requireCurrent().runtime.pipeline.wakingPrefix == "#") return@repeat
            delay(25)
        }

        assertEquals("#", fixture.store.requireCurrent().runtime.pipeline.wakingPrefix)
        fixture.service.stop()
    }

    private fun fixture(): Fixture {
        val root = Files.createTempDirectory("configuration-runtime-service")
        val workspace = root.resolve("workspace")
        Files.createDirectories(workspace)
        Files.writeString(workspace.resolve("config.yaml"), workspaceYaml())
        val app = AppConfigDocument(
            runtime = RuntimeConfigDocument(
                server = ServerRuntimeDocument(enabled = true, host = "127.0.0.1", port = 8080),
            ),
            providers = listOf(ProviderConnectionDocument("provider", "test")),
            workspaces = WorkspaceCatalogDocument(
                defaultWorkspaceId = "default",
                entries = listOf(WorkspaceCatalogEntryDocument("default", "workspace")),
            ),
        )
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(app))
        val store = EffectiveConfigStore()
        val service = ConfigurationRuntimeService(
            configPath = path,
            compiler = ConfigurationCompiler(environment = EnvironmentOverrideSource { null }),
            store = store,
            registeredTools = { emptyList() },
            availableSkills = { emptySet() },
        )
        return Fixture(path, workspace, app, store, service)
    }

    private fun workspaceYaml(provider: String = "provider") = """
        schemaVersion: 2
        id: default
        name: Default
        primaryAgentId: agent
        agents:
          - id: agent
            providerRef: $provider
            model: model
    """.trimIndent()

    private data class Fixture(
        val configPath: Path,
        val workspaceDir: Path,
        val app: AppConfigDocument,
        val store: EffectiveConfigStore,
        val service: ConfigurationRuntimeService,
    )
}
