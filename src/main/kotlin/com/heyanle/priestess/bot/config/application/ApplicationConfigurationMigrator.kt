package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.source.*
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager

/** Migration outcome plus the warnings the operator should read. Authored instructions are never rewritten. */
data class MigrationResult(
    val migrated: Boolean,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

/** One-way development migration. The operator explicitly requested replacement without backups. */
class ApplicationConfigurationMigrator(
    /**
     * Whether the deployment exposes an Agent-to-Agent delegation capability. The runtime exposes none
     * today, so migration reports the loss of a v2 orchestrator role instead of silently accepting it.
     * Passing `true` once a delegation tool exists suppresses that warning.
     */
    private val delegationAvailable: Boolean = false,
) {
    private val source = ApplicationConfigurationSource()

    fun migrateIfNeeded(path: Path): MigrationResult {
        if (!Files.isRegularFile(path)) return MigrationResult(migrated = false)
        val original = Files.readString(path)
        val version = Json.parseToJsonElement(original).jsonObject["schemaVersion"]?.jsonPrimitive?.intOrNull
        if (version == 3) return MigrationResult(migrated = false)
        require(version == 2) { "Only v2 configuration can be migrated automatically" }
        val legacy = checkNotNull(AppConfigDocumentDecoder().decode(original, path.toString()).value) { "Invalid v2 configuration" }
        val base = path.toAbsolutePath().parent
        val loaded = legacy.workspaces.entries.filter { it.enabled }.associate { entry ->
            entry.id to checkNotNull(WorkspaceConfigFileSource().load(entry, base).value) { "Cannot migrate Workspace '${entry.id}'" }
        }
        val used = hashSetOf<String>()
        val aliases = linkedMapOf<Pair<String, String>, String>()
        loaded.forEach { (workspaceId, raw) -> raw.document.agents.forEach { agent ->
            val id = if (used.add(agent.id)) agent.id else "$workspaceId-${agent.id}".also { require(used.add(it)) }
            aliases[workspaceId to agent.id] = id
        } }
        val platformDirectory = base.resolve("platform").normalize()
        val skillLibraries = mutableListOf<SkillLibraryDocument>()
        val mcpServers = mutableListOf<McpServerDefinitionDocument>()
        val agents = loaded.flatMap { (workspaceId, raw) ->
            val workspace = raw.document
            val oldRoot = Path.of(raw.sourcePath).parent
            val skillLibraryId = "legacy-$workspaceId"
            if (Files.isDirectory(oldRoot.resolve("skills"))) {
                skillLibraries += SkillLibraryDocument(skillLibraryId, workspace.name, oldRoot.resolve("skills").toString())
            }
            val mcpIds = workspace.mcpServers.map { server ->
                val id = "$workspaceId-${server.id}"
                mcpServers += server.copy(id = id)
                id
            }
            workspace.agents.map { agent ->
                val id = aliases.getValue(workspaceId to agent.id)
                val personaId = agent.personaRef ?: workspace.personas.firstOrNull {
                    it.enabled && (it.agentIds.isEmpty() || agent.id in it.agentIds)
                }?.id
                AgentProfileDocument(
                    id = id, displayName = agent.displayName, enabled = agent.enabled && workspace.enabled,
                    instructions = agent.instructions,
                    llm = AgentLlmDocument(agent.providerRef, agent.model, agent.generation),
                    configDirectory = oldRoot.toString(), tempDirectory = platformDirectory.resolve("agents/$id/temp").toString(),
                    context = agent.context, execution = agent.execution,
                    skills = AgentSkillsDocument(platformLibraries = if (skillLibraries.any { it.id == skillLibraryId }) listOf(AgentSkillLibraryBinding(skillLibraryId)) else emptyList()),
                    memory = AgentMemoryDocument(
                        libraryIds = if (workspace.memory.enabled) listOf(workspaceId) else emptyList(),
                        writeLibraryId = workspaceId.takeIf { workspace.memory.enabled }, maxInjected = workspace.memory.maxInjectedMemories,
                        allowedScopes = workspace.memory.allowedScopes,
                    ),
                    personaId = personaId, mcpServerIds = mcpIds,
                    toolPolicy = mergePolicy(workspace.toolPolicy, agent.toolPolicy),
                )
            }
        }
        val ims = legacy.platforms.map { connection ->
            val workspaceId = connection.defaultWorkspaceId ?: legacy.workspaces.defaultWorkspaceId
            val workspace = loaded[workspaceId]?.document ?: loaded.values.firstOrNull()?.document
            val primary = workspace?.let { ws -> aliases[ws.id to (ws.orchestration.defaultAgentId ?: ws.primaryAgentId)] }
                ?: agents.firstOrNull { it.enabled }?.id
            val defaults = primary?.let(ImRouter::defaultRoutes).orEmpty()
            val routes = if (workspace?.orchestration?.enabled == true) {
                val custom = workspace.orchestration.routes.filter { it.enabled }
                    .flatMap { route -> route.keywords.mapIndexed { index, keyword -> Triple(route, index, keyword) } }
                    .sortedWith(
                        // Route evaluation is first-match-wins and a `*P*` pattern matches every input
                        // containing `P`, so a broader keyword placed before a narrower one that contains
                        // it makes the narrower route unreachable. Within one legacy priority the more
                        // specific keyword goes first; equal lengths keep their declared order.
                        compareByDescending<Triple<AgentRouteDocument, Int, String>> { it.first.priority }
                            .thenByDescending { it.third.length },
                    )
                    .flatMap { (route, keywordIndex, keyword) ->
                        listOf(SessionType.GROUP, SessionType.PRIVATE).map { sessionType ->
                            ImRouteDocument(
                                id = "${route.id}-${sessionType.name.lowercase()}-$keywordIndex", name = route.id,
                                match = ImRouteMatchDocument(listOf(sessionType), if (sessionType == SessionType.GROUP) ImAttention.MENTION_OR_REPLY else ImAttention.ANY, textPattern = "*$keyword*"),
                                action = ImRouteActionDocument(agentId = aliases[workspace.id to route.targetAgentId]),
                            )
                        }
                    }
                defaults.filter { it.action.type == ImRouteActionType.COMMAND } + custom + defaults.filter { it.action.type == ImRouteActionType.AGENT }
            } else defaults
            ImConnectionDocument(connection.id, connection.id, connection.type, connection.enabled, connection.credentialRefs, connection.settings, legacy.runtime.permission, routes)
        }
        val diagnostics = migrationDiagnostics(loaded, aliases, path)
        val converted = ApplicationConfigurationDocument(
            runtime = legacy.runtime, platformDirectory = platformDirectory.toString(), ims = ims, llms = legacy.providers,
            agents = agents, skillLibraries = skillLibraries,
            memoryLibraries = loaded.map { (id, raw) -> MemoryLibraryDocument(id, raw.document.name, "Migrated memory library") },
            mcpServers = mcpServers,
        )
        val content = source.json.encodeToString(converted)
        val validated = source.decode(content, path)
        require(validated.isSuccess) { validated.diagnostics.joinToString { it.message } }
        Files.createDirectories(platformDirectory)
        migrateResourceDatabase(legacy.runtime.database.path, platformDirectory.resolve("resources.sqlite"), aliases)
        val store = RevisionedConfigFileStore()
        check(store.persist(path, content, store.revisionOf(original), isValidExisting = { false }) is PersistResult.Success) { "Configuration changed during migration" }
        loaded.values.forEach { old ->
            val workspaceFile = Path.of(old.sourcePath).toAbsolutePath().normalize()
            if (workspaceFile != path.toAbsolutePath().normalize()) Files.deleteIfExists(workspaceFile)
            Files.deleteIfExists(workspaceFile.parent.resolve("mcpserver.json"))
        }
        return MigrationResult(migrated = true, diagnostics = diagnostics)
    }

    /**
     * A v2 Workspace that enabled keyword orchestration relied on the runtime to hand a request to a
     * target Agent. The migrated model expresses that as an IM route table, which is faithful, but the
     * fallback Agent itself loses any ability to delegate. Report that loss rather than silently
     * accepting an Agent whose authored role can no longer be honored, and never rewrite its
     * instructions: they belong to the operator.
     */
    private fun migrationDiagnostics(
        loaded: Map<String, RawWorkspaceConfigState>,
        aliases: Map<Pair<String, String>, String>,
        path: Path,
    ): List<ConfigurationDiagnostic> = buildList {
        if (delegationAvailable) return@buildList
        loaded.forEach { (workspaceId, raw) ->
            val workspace = raw.document
            val orchestration = workspace.orchestration
            if (!orchestration.enabled || orchestration.routes.none { it.enabled }) return@forEach
            val fallback = aliases[workspaceId to (orchestration.defaultAgentId ?: workspace.primaryAgentId)] ?: return@forEach
            add(
                ConfigurationDiagnostic(
                    code = "AGENT_DELEGATION_UNAVAILABLE",
                    severity = DiagnosticSeverity.WARNING,
                    message = "Agent '$fallback' received Workspace '$workspaceId' orchestrated traffic, but the migrated model provides no delegation capability, so it cannot forward a request to another Agent. Its instructions are kept unchanged; review them or grant it the specialist tools it needs.",
                    source = path.toString(),
                    path = "agents.$fallback.instructions",
                ),
            )
        }
    }

    private fun mergePolicy(workspace: ToolPolicyDocument, agent: ToolPolicyDocument): ToolPolicyDocument {
        val allow = when {
            workspace.allow.isEmpty() -> agent.allow
            agent.allow.isEmpty() -> workspace.allow
            else -> workspace.allow.intersect(agent.allow.toSet()).toList()
        }.filterNot { it in setOf("early_reply", "send_message", "napcat_reply_message") }
        val explicitEmpty = (workspace.allow.isNotEmpty() || agent.allow.isNotEmpty()) && allow.isEmpty()
        return ToolPolicyDocument(
            allow = allow,
            deny = (workspace.deny + agent.deny).distinct().filterNot { it in setOf("early_reply", "send_message", "napcat_reply_message") },
            allowedRiskLevels = if (explicitEmpty) emptyList() else workspace.allowedRiskLevels.intersect(agent.allowedRiskLevels.toSet()).toList(),
            minimumPermissionGroups = agent.minimumPermissionGroups,
        )
    }

    private fun migrateResourceDatabase(oldPath: String, target: Path, aliases: Map<Pair<String, String>, String>) {
        val original = Path.of(oldPath).toAbsolutePath().normalize()
        if (!Files.isRegularFile(original) || Files.exists(target)) return
        // SQLite's own VACUUM snapshot includes WAL state and is safe while the old store is open.
        DriverManager.getConnection("jdbc:sqlite:$original").use { connection ->
            connection.prepareStatement("VACUUM INTO ?").use { statement -> statement.setString(1, target.toString()); statement.execute() }
        }
        DriverManager.getConnection("jdbc:sqlite:$target").use { connection ->
            val tables = connection.createStatement().use { it.executeQuery("SELECT name FROM sqlite_master WHERE type='table'").use { rows -> buildSet { while (rows.next()) add(rows.getString(1)) } } }
            if ("memory_records" in tables) {
                aliases.forEach { (old, newId) ->
                    connection.prepareStatement("UPDATE memory_records SET agent_name=? WHERE workspace_id=? AND agent_name=? AND scope='AGENT'").use {
                        it.setString(1, newId); it.setString(2, old.first); it.setString(3, old.second); it.executeUpdate()
                    }
                }
                val columns = connection.createStatement().use { it.executeQuery("PRAGMA table_info(memory_records)").use { rows -> buildSet { while (rows.next()) add(rows.getString("name")) } } }
                connection.createStatement().use { statement ->
                    if ("library_id" !in columns) statement.execute("ALTER TABLE memory_records ADD COLUMN library_id VARCHAR(128) NOT NULL DEFAULT 'default'")
                    statement.execute("UPDATE memory_records SET library_id=workspace_id, workspace_id='platform'")
                }
            }
            if ("personas" in tables) connection.createStatement().use { it.execute("UPDATE personas SET workspace_id='platform', agent_names='[]'") }
        }
    }
}
