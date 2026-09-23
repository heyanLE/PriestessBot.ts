package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ToolPolicyResolver
import com.heyanle.priestess.bot.config.source.McpServerFileDocument
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.*

class ApplicationConfigurationMigratorTest {
    private val json = Json { encodeDefaults = true; prettyPrint = true }

    @Test
    fun `v2 replaces authoring once without backups and removes legacy config authorities`() = inDirectory { root ->
        val workspace = workspace("one").copy(personas = listOf(PersonaDefinitionDocument("persona-one")))
        writeWorkspace(root, workspace)
        val skills = Files.createDirectories(root.resolve("one/skills"))
        Files.writeString(skills.resolve("keep.txt"), "skill content must survive")
        Files.writeString(root.resolve("one/mcpserver.json"), json.encodeToString(McpServerFileDocument(mcpServers = listOf(
            McpServerDefinitionDocument("local", enabled = false, command = "unused"),
        ))))
        val original = legacy(root, listOf(workspace))
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(original))

        assertTrue(ApplicationConfigurationMigrator().migrateIfNeeded(path).migrated)
        val content = Files.readString(path)
        val migrated = json.decodeFromString<ApplicationConfigurationDocument>(content)
        assertEquals(3, migrated.schemaVersion)
        assertEquals(original.providers, migrated.llms)
        assertEquals(original.runtime.permission, migrated.ims.single().permission)
        assertEquals("assistant", migrated.agents.single().id)
        assertEquals("persona-one", migrated.agents.single().personaId)
        assertEquals(listOf("one"), migrated.agents.single().memory.libraryIds)
        assertEquals("one", migrated.agents.single().memory.writeLibraryId)
        assertEquals(listOf("group-command", "group-agent", "private-command", "private-agent"), migrated.ims.single().routes.map { it.id })
        assertFalse(Files.exists(root.resolve("backups")))
        assertFalse(Files.exists(root.resolve("one/config.yaml")), "Legacy authoring must not remain editable")
        assertFalse(Files.exists(root.resolve("one/mcpserver.json")), "Legacy MCP authoring must not remain editable")
        assertEquals("skill content must survive", Files.readString(skills.resolve("keep.txt")))
        assertFalse(ApplicationConfigurationMigrator().migrateIfNeeded(path).migrated)
        assertEquals(content, Files.readString(path))
        assertTrue(ApplicationConfigurationSource().load(path).isSuccess)
    }

    @Test
    fun `resource snapshot preserves contents and remaps namespaced Agent memory ownership`() = inDirectory { root ->
        val one = workspace("one").copy(personas = listOf(PersonaDefinitionDocument("persona-one")))
        val two = workspace("two").copy(personas = listOf(PersonaDefinitionDocument("persona-two")))
        writeWorkspace(root, one)
        writeWorkspace(root, two)
        val oldDb = root.resolve("legacy.sqlite")
        DriverManager.getConnection("jdbc:sqlite:$oldDb").use { connection ->
            connection.createStatement().use { statement ->
                statement.execute("PRAGMA journal_mode=WAL")
                statement.execute("CREATE TABLE memory_records (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, scope TEXT NOT NULL, agent_name TEXT, content TEXT NOT NULL)")
                statement.execute("INSERT INTO memory_records VALUES ('first','one','GLOBAL',NULL,'中文记忆一')")
                statement.execute("INSERT INTO memory_records VALUES ('second','two','AGENT','assistant','中文记忆二')")
                statement.execute("CREATE TABLE personas (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_names TEXT NOT NULL, system_prompt_template TEXT NOT NULL)")
                statement.execute("INSERT INTO personas VALUES ('persona-one','one','[\"assistant\"]','人格一内容')")
                statement.execute("INSERT INTO personas VALUES ('persona-two','two','[\"assistant\"]','人格二内容')")
            }
            val path = root.resolve("config.json")
            Files.writeString(path, json.encodeToString(legacy(root, listOf(one, two))))
            assertTrue(ApplicationConfigurationMigrator().migrateIfNeeded(path).migrated)
            val migrated = json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
            assertEquals(listOf("assistant", "two-assistant"), migrated.agents.map { it.id })
            assertEquals(setOf("one", "two"), migrated.memoryLibraries.map { it.id }.toSet())
            assertEquals("two-assistant", migrated.ims[1].routes.first { it.action.type == ImRouteActionType.AGENT }.action.agentId)
            val target = root.resolve("platform/resources.sqlite")
            assertTrue(Files.isRegularFile(target))
            DriverManager.getConnection("jdbc:sqlite:$target").use { copied ->
                copied.createStatement().use { statement ->
                    statement.executeQuery("SELECT workspace_id, library_id, agent_name, content FROM memory_records WHERE id='second'").use { rows ->
                        assertTrue(rows.next())
                        assertEquals("platform", rows.getString("workspace_id"))
                        assertEquals("two", rows.getString("library_id"))
                        assertEquals("two-assistant", rows.getString("agent_name"))
                        assertEquals("中文记忆二", rows.getString("content"))
                    }
                    statement.executeQuery("SELECT workspace_id, agent_names, system_prompt_template FROM personas WHERE id='persona-two'").use { rows ->
                        assertTrue(rows.next())
                        assertEquals("platform", rows.getString("workspace_id"))
                        assertEquals("[]", rows.getString("agent_names"))
                        assertEquals("人格二内容", rows.getString("system_prompt_template"))
                    }
                }
            }
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT workspace_id, agent_name FROM memory_records WHERE id='second'").use { rows ->
                    assertTrue(rows.next())
                    assertEquals("two", rows.getString("workspace_id"))
                    assertEquals("assistant", rows.getString("agent_name"))
                }
            }
        }
    }

    @Test
    fun `migration does not widen explicitly disjoint tool policies into default tools`() = inDirectory { root ->
        val workspace = workspace("one").copy(
            toolPolicy = ToolPolicyDocument(allow = listOf("read")),
            agents = listOf(workspace("one").agents.single().copy(toolPolicy = ToolPolicyDocument(allow = listOf("write")))),
        )
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(legacy(root, listOf(workspace))))
        assertTrue(ApplicationConfigurationMigrator().migrateIfNeeded(path).migrated)
        val migrated = json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
        val selected = ToolPolicyResolver().resolveApplication(
            listOf(ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ), ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE)),
            migrated.toolPolicy, migrated.agents.single().toolPolicy,
        )
        assertTrue(selected.isEmpty(), "The original v2 policy permitted no tools")
    }

    @Test
    fun `disabled unused legacy workspace with missing source does not block migration`() = inDirectory { root ->
        val workspace = workspace("one")
        writeWorkspace(root, workspace)
        val document = legacy(root, listOf(workspace)).let { original -> original.copy(workspaces = original.workspaces.copy(
            entries = original.workspaces.entries + WorkspaceCatalogEntryDocument("disabled", "missing", enabled = false),
        )) }
        val path = root.resolve("config.json")
        Files.writeString(path, json.encodeToString(document))
        assertTrue(ApplicationConfigurationMigrator().migrateIfNeeded(path).migrated)
        val migrated = json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
        assertEquals(listOf("assistant"), migrated.agents.filter { it.enabled }.map { it.id })
    }

    @Test
    fun `invalid converted configuration leaves v2 authoring and resources untouched`() = inDirectory { root ->
        val workspace = workspace("one").copy(agents = listOf(workspace("one").agents.single().copy(model = "")))
        writeWorkspace(root, workspace)
        val path = root.resolve("config.json")
        val original = json.encodeToString(legacy(root, listOf(workspace)))
        Files.writeString(path, original)
        assertFailsWith<IllegalArgumentException> { ApplicationConfigurationMigrator().migrateIfNeeded(path) }
        assertEquals(original, Files.readString(path))
        assertTrue(Files.isRegularFile(root.resolve("one/config.yaml")))
        assertFalse(Files.exists(root.resolve("platform/resources.sqlite")))
        assertFalse(Files.exists(root.resolve("backups")))
    }

    private fun workspace(id: String) = WorkspaceConfigDocument(id = id, name = id, primaryAgentId = "assistant",
        agents = listOf(AgentDefinitionDocument("assistant", providerRef = "llm", model = "model")))

    private fun writeWorkspace(root: Path, workspace: WorkspaceConfigDocument) {
        Files.createDirectories(root.resolve(workspace.id))
        Files.writeString(root.resolve("${workspace.id}/config.yaml"), json.encodeToString(workspace))
    }

    private fun legacy(root: Path, workspaces: List<WorkspaceConfigDocument>) = AppConfigDocument(
        runtime = RuntimeConfigDocument(database = DatabaseRuntimeDocument(root.resolve("legacy.sqlite").toString()),
            permission = PermissionRuntimeDocument(superAdminIds = listOf("admin"), adminIds = listOf("operator"))),
        platforms = workspaces.mapIndexed { index, workspace -> PlatformConnectionDocument("im-$index", "napcat4_18_6", defaultWorkspaceId = workspace.id) },
        providers = listOf(ProviderConnectionDocument("llm", "openai-compatible")),
        workspaces = WorkspaceCatalogDocument(workspaces.first().id, workspaces.map { WorkspaceCatalogEntryDocument(it.id, it.id) }),
    )

    private inline fun inDirectory(block: (Path) -> Unit) {
        val root = Files.createTempDirectory("application-migration-test-")
        try { block(root) } finally { root.toFile().deleteRecursively() }
    }
}
