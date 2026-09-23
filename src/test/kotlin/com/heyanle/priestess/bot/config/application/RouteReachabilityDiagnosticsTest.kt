package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.platform.SessionType
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.*

/**
 * Route evaluation is first-match-wins over a bare `*keyword*` glob, so ordering carries meaning: a
 * broader keyword placed before a narrower one that contains it makes the narrower route unreachable.
 * These cases pin both the migration ordering rule and the validation warning that reports a table the
 * operator has already ordered that way.
 */
class RouteReachabilityDiagnosticsTest {
    private val source = ApplicationConfigurationSource()
    private val json = Json { encodeDefaults = true; prettyPrint = true }

    @Test
    fun `a route strictly shadowed by an earlier glob is reported without failing the load`() = inDirectory { root ->
        val document = validDocument().copy(
            ims = listOf(
                im(
                    routes = listOf(
                        route("broad", "*file*"),
                        route("narrow", "*search_files*"),
                    ),
                ),
            ),
        )

        val loaded = source.decode(source.json.encodeToString(document), root.resolve("config.json"))

        assertTrue(loaded.isSuccess, "A shadowed route must warn, not block activation: ${loaded.diagnostics}")
        val warning = loaded.diagnostics.single { it.code == "IM_ROUTE_UNREACHABLE" }
        assertEquals(DiagnosticSeverity.WARNING, warning.severity)
        assertEquals("ims.qq.routes.narrow", warning.path)
        assertTrue(warning.message.contains("broad"), warning.message)
    }

    @Test
    fun `reachable routes are not reported`() = inDirectory { root ->
        // "file" is not contained in "read", and the narrower "search_files" is placed first, so neither
        // route is shadowed and a report here would be a false positive.
        val document = validDocument().copy(
            ims = listOf(
                im(
                    routes = listOf(
                        route("read", "*read*"),
                        route("search", "*search_files*"),
                        route("file", "*file*"),
                    ),
                ),
            ),
        )

        val loaded = source.decode(source.json.encodeToString(document), root.resolve("config.json"))

        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        assertTrue(
            loaded.diagnostics.none { it.code == "IM_ROUTE_UNREACHABLE" },
            "No route here is unreachable, reported: ${loaded.diagnostics.filter { it.code == "IM_ROUTE_UNREACHABLE" }}",
        )
    }

    @Test
    fun `migration orders generated keyword routes by descending specificity`() = inDirectory { root ->
        // "file" occurs inside "search_files", so the narrower keyword must be evaluated first.
        val workspace = workspace(
            orchestration = OrchestrationDocument(
                enabled = true,
                defaultAgentId = "assistant",
                routes = listOf(AgentRouteDocument(id = "files", targetAgentId = "assistant", keywords = listOf("file", "search_files"))),
            ),
        )
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(legacy(root, listOf(workspace))))

        val result = ApplicationConfigurationMigrator().migrateIfNeeded(path)

        assertTrue(result.migrated)
        val migrated = json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
        val generated = migrated.ims.single().routes.filter { it.id.startsWith("files-") }
        assertEquals(
            listOf("files-group-1", "files-private-1", "files-group-0", "files-private-0"),
            generated.map { it.id },
        )
        assertEquals(listOf("*search_files*", "*search_files*", "*file*", "*file*"), generated.map { it.match.textPattern })
    }

    @Test
    fun `migration reports a lost orchestrator delegation role without rewriting its instructions`() = inDirectory { root ->
        val authored = "Route each request to the most suitable Workspace Agent and keep responses concise."
        val workspace = workspace(
            instructions = authored,
            orchestration = OrchestrationDocument(
                enabled = true,
                defaultAgentId = "assistant",
                routes = listOf(AgentRouteDocument(id = "files", targetAgentId = "assistant", keywords = listOf("file"))),
            ),
        )
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(legacy(root, listOf(workspace))))

        val result = ApplicationConfigurationMigrator().migrateIfNeeded(path)

        assertTrue(result.migrated)
        val warning = result.diagnostics.single { it.code == "AGENT_DELEGATION_UNAVAILABLE" }
        assertEquals(DiagnosticSeverity.WARNING, warning.severity)
        assertTrue(warning.message.contains("assistant"), warning.message)
        assertEquals("agents.assistant.instructions", warning.path)
        val migrated = json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
        assertEquals(authored, migrated.agents.single().instructions, "Operator-authored instructions must survive migration")
    }

    @Test
    fun `no delegation warning is reported when the deployment can delegate`() = inDirectory { root ->
        val workspace = workspace(
            orchestration = OrchestrationDocument(
                enabled = true,
                defaultAgentId = "assistant",
                routes = listOf(AgentRouteDocument(id = "files", targetAgentId = "assistant", keywords = listOf("file"))),
            ),
        )
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(legacy(root, listOf(workspace))))

        val result = ApplicationConfigurationMigrator(delegationAvailable = true).migrateIfNeeded(path)

        assertTrue(result.migrated)
        assertTrue(result.diagnostics.isEmpty(), "A delegation-capable deployment must not warn: ${result.diagnostics}")
    }

    @Test
    fun `workspace without orchestration routes does not warn about delegation`() = inDirectory { root ->
        val workspace = workspace()
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(legacy(root, listOf(workspace))))

        val result = ApplicationConfigurationMigrator().migrateIfNeeded(path)

        assertTrue(result.migrated)
        assertTrue(result.diagnostics.isEmpty(), "Nothing delegated in v2, so nothing was lost: ${result.diagnostics}")
    }

    private fun validDocument() = ApplicationConfigurationDocument(
        platformDirectory = "platform",
        llms = listOf(ProviderConnectionDocument("llm", "openai-compatible")),
        agents = listOf(AgentProfileDocument("assistant", llm = AgentLlmDocument("llm", "model"))),
    )

    private fun route(id: String, pattern: String) = ImRouteDocument(
        id,
        match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.PRIVATE), textPattern = pattern),
        action = ImRouteActionDocument(agentId = "assistant"),
    )

    private fun im(routes: List<ImRouteDocument>) = ImConnectionDocument("qq", type = "napcat4_18_6", routes = routes)

    private fun workspace(
        instructions: String = "You are a helpful assistant.",
        orchestration: OrchestrationDocument = OrchestrationDocument(),
    ) = WorkspaceConfigDocument(
        id = "one",
        name = "one",
        primaryAgentId = "assistant",
        agents = listOf(AgentDefinitionDocument("assistant", instructions = instructions, providerRef = "llm", model = "model")),
        orchestration = orchestration,
    )

    private fun writeWorkspace(root: Path, workspace: WorkspaceConfigDocument) {
        Files.createDirectories(root.resolve(workspace.id))
        Files.writeString(root.resolve("${workspace.id}/config.yaml"), json.encodeToString(workspace))
    }

    private fun legacy(root: Path, workspaces: List<WorkspaceConfigDocument>) = AppConfigDocument(
        runtime = RuntimeConfigDocument(database = DatabaseRuntimeDocument(root.resolve("legacy.sqlite").toString())),
        platforms = workspaces.mapIndexed { index, workspace -> PlatformConnectionDocument("im-$index", "napcat4_18_6", defaultWorkspaceId = workspace.id) },
        providers = listOf(ProviderConnectionDocument("llm", "openai-compatible")),
        workspaces = WorkspaceCatalogDocument(workspaces.first().id, workspaces.map { WorkspaceCatalogEntryDocument(it.id, it.id) }),
    )

    private inline fun inDirectory(block: (Path) -> Unit) {
        val root = Files.createTempDirectory("route-reachability-test-")
        try { block(root) } finally { root.toFile().deleteRecursively() }
    }
}
