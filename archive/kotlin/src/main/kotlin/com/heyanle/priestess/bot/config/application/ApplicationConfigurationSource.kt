package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.resolve.ConfigurationProvenanceBuilder
import com.heyanle.priestess.bot.config.source.ConfigurationSourceResult
import com.heyanle.priestess.bot.config.source.StrictJsonPreflight
import com.heyanle.priestess.bot.config.source.RevisionedConfigFileStore
import com.heyanle.priestess.bot.memory.MemoryScope
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path

/** V3 authoring is normalized into existing immutable compilation units, never legacy files. */
class ApplicationConfigurationSource {
    val json = Json { ignoreUnknownKeys = false; encodeDefaults = true; prettyPrint = true }
    private val fingerprints = ConfigurationProvenanceBuilder()

    fun load(path: Path): ConfigurationSourceResult<RawConfigState> = try {
        decode(Files.readString(path), path)
    } catch (error: Exception) {
        failure("CONFIG_FILE_READ_FAILED", error.message ?: "Unable to read application configuration", path)
    }

    fun decode(content: String, path: Path): ConfigurationSourceResult<RawConfigState> = try {
        StrictJsonPreflight.requireNoDuplicateKeys(content, path.toString())
        val document = json.decodeFromString<ApplicationConfigurationDocument>(content)
        val diagnostics = validate(document, path)
        // Only errors block projection. A warning describes something the operator should read while the
        // configuration stays usable, so it must travel with the value instead of discarding it.
        if (diagnostics.any { it.severity == DiagnosticSeverity.ERROR }) {
            ConfigurationSourceResult(diagnostics = diagnostics)
        } else {
            ConfigurationSourceResult(value = project(document, path, content), diagnostics = diagnostics)
        }
    } catch (error: Exception) {
        failure("APPLICATION_CONFIG_INVALID", error.message ?: "Invalid application configuration", path)
    }

    fun resolveDirectory(path: Path, value: String): Path {
        val candidate = Path.of(value)
        val absolute = (if (candidate.isAbsolute) candidate else path.toAbsolutePath().parent.resolve(candidate)).normalize()
        var existing = absolute
        val remaining = java.util.ArrayDeque<Path>()
        while (!Files.exists(existing)) {
            remaining.addFirst(existing.fileName)
            existing = existing.parent ?: return absolute
        }
        var canonical = existing.toRealPath()
        remaining.forEach { canonical = canonical.resolve(it) }
        return canonical
    }

    /** Resolve trusted configured roots once per generation; descendants still reject symlinks. */
    fun resolveDirectories(document: ApplicationConfigurationDocument, sourcePath: Path): ApplicationConfigurationDocument {
        val platformRoot = resolveDirectory(sourcePath, document.platformDirectory)
        return document.copy(
            platformDirectory = platformRoot.toString(),
            agents = document.agents.map { it.copy(
                configDirectory = resolveDirectory(sourcePath, it.configDirectory).toString(),
                tempDirectory = resolveDirectory(sourcePath, it.tempDirectory).toString(),
            ) },
            skillLibraries = document.skillLibraries.map { it.copy(
                directory = resolveDirectory(platformRoot.resolve("catalog.json"), it.directory).toString(),
            ) },
        )
    }

    private fun validate(document: ApplicationConfigurationDocument, path: Path): List<ConfigurationDiagnostic> = buildList {
        fun invalid(field: String, message: String) {
            add(ConfigurationDiagnostic("APPLICATION_CONFIG_INVALID", DiagnosticSeverity.ERROR, message, path.toString(), field))
        }
        fun warn(code: String, field: String, message: String) {
            add(ConfigurationDiagnostic(code, DiagnosticSeverity.WARNING, message, path.toString(), field))
        }
        fun ids(field: String, values: List<String>) {
            values.filterNot { it.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")) }.forEach {
                invalid(field, "Invalid identifier '$it': use letters, digits, '.', '_' or '-'")
            }
            values.groupingBy { it }.eachCount().filterValues { it > 1 }.keys.forEach { invalid(field, "Duplicate identifier '$it'") }
        }
        fun directory(field: String, value: String, parent: Path = path.toAbsolutePath().parent) {
            if (value.isBlank()) return
            var existing: Path? = Path.of(value).let { if (it.isAbsolute) it else parent.resolve(it) }.normalize()
            while (existing != null && !Files.exists(existing)) existing = existing.parent
            if (existing != null && !Files.isDirectory(existing)) invalid(field, "Directory path has a non-directory ancestor: $existing")
        }
        if (document.schemaVersion != 3) invalid("schemaVersion", "Only schemaVersion 3 is accepted; migrate legacy sources first")
        if (document.platformDirectory.isBlank()) invalid("platformDirectory", "Platform directory is required")
        directory("platformDirectory", document.platformDirectory)
        ids("ims", document.ims.map { it.id }); ids("llms", document.llms.map { it.id })
        ids("agents", document.agents.map { it.id }); ids("skillLibraries", document.skillLibraries.map { it.id })
        ids("memoryLibraries", document.memoryLibraries.map { it.id }); ids("mcpServers", document.mcpServers.map { it.id })
        val agents = document.agents.filter { it.enabled }.mapTo(hashSetOf()) { it.id }
        val llms = document.llms.filter { it.enabled }.mapTo(hashSetOf()) { it.id }
        document.llms.forEach { llm ->
            val protocol = com.heyanle.priestess.bot.config.model.WireProtocol.resolve(llm.type, llm.protocol)
            val supported = com.heyanle.priestess.bot.config.model.WireProtocol.supportedFor(llm.type)
            if (llm.protocol != null && protocol == null) {
                invalid("llms.${llm.id}.protocol", "Unknown protocol '${llm.protocol}'")
            } else if (protocol != null && supported != null && protocol !in supported) {
                invalid("llms.${llm.id}.protocol", "Protocol '${protocol.name}' is unsupported for '${llm.type}'")
            }
        }
        val skills = document.skillLibraries.mapTo(hashSetOf()) { it.id }
        val memories = document.memoryLibraries.mapTo(hashSetOf()) { it.id }
        val mcps = document.mcpServers.mapTo(hashSetOf()) { it.id }
        document.skillLibraries.forEach {
            if (it.directory.isBlank()) invalid("skillLibraries.${it.id}.directory", "Skill library directory is required")
            else directory("skillLibraries.${it.id}.directory", it.directory, resolveDirectory(path, document.platformDirectory))
        }
        document.ims.forEach { im ->
            if (im.id == "dashboard") invalid("ims.${im.id}.id", "The dashboard identifier is reserved")
            if (im.type !in setOf("napcat4_18_6", "telegram", "weixin")) invalid("ims.${im.id}.type", "Unsupported IM type '${im.type}'")
            val group = im.groupContext
            if (group.maxBufferedMessages !in 1..1_000) invalid("ims.${im.id}.groupContext.maxBufferedMessages", "Group buffer must retain 1-1000 messages")
            if (group.maxInjectedTokens !in 256..8_192) invalid("ims.${im.id}.groupContext.maxInjectedTokens", "Group injection budget must be 256-8192 tokens")
            if (group.maxArchiveMessages !in 1..10_000) invalid("ims.${im.id}.groupContext.maxArchiveMessages", "Group archive must retain 1-10000 messages")
            ids("ims.${im.id}.routes", im.routes.map { it.id })
            im.routes.forEach { route ->
                val field = "ims.${im.id}.routes.${route.id}"
                if (route.match.sessionTypes.isEmpty()) invalid("$field.match.sessionTypes", "Choose at least one session type")
                if (route.match.textPattern.length > 4096) invalid("$field.match.textPattern", "Route pattern is too long")
                if (route.match.textMode == ImTextMatchMode.PREFIX && route.match.textPattern.isEmpty()) invalid("$field.match.textPattern", "A prefix cannot be empty")
                if (route.action.type == ImRouteActionType.AGENT && im.enabled && route.enabled && route.action.agentId !in agents) invalid("$field.action.agentId", "Route must target an enabled Agent")
                if (route.action.type == ImRouteActionType.AGENT && im.enabled && route.enabled) {
                    val target = document.agents.firstOrNull { it.enabled && it.id == route.action.agentId }
                    if (target != null) {
                        val mode = route.action.toolInjectionMode ?: ToolInjectionMode.MULTI
                        if (mode !in com.heyanle.priestess.bot.agent.type.AgentTypeRegistry.of(target.type).toolInjectionModes) {
                            invalid("$field.action.toolInjectionMode", "Route '${route.id}' targets Agent '${target.id}' type '${target.type}', which does not support '$mode'")
                        }
                    }
                }
                if (route.action.type == ImRouteActionType.COMMAND && route.action.commandPrefix.isBlank()) invalid("$field.action.commandPrefix", "Built-in commands require a nonblank prefix")
                if (route.action.type == ImRouteActionType.COMMAND && route.action.toolInjectionMode != null) invalid("$field.action.toolInjectionMode", "Command routes cannot inject Agent tools")
            }
            reportUnreachableRoutes(im) { field, message -> warn("IM_ROUTE_UNREACHABLE", field, message) }
        }
        document.agents.forEach { agent ->
            val field = "agents.${agent.id}"
            val type = com.heyanle.priestess.bot.agent.type.AgentTypeRegistry.of(agent.type)
            val selectedLlm = document.llms.firstOrNull { it.id == agent.llm.providerRef }
            val selectedProtocol = selectedLlm?.let { WireProtocol.resolve(it.type, it.protocol) }
            if (agent.enabled && !type.available) invalid("$field.type", "Agent type '${agent.type}' is not available in this runtime")
            if (selectedProtocol != null && selectedProtocol !in type.llmProtocols) {
                invalid("$field.llm.providerRef", "Agent '${agent.id}' type '${agent.type}' does not support '${selectedProtocol.name}'")
            }
            if (type.engine == AgentEngine.CODEX && selectedProtocol == null) {
                invalid("$field.llm.providerRef", "Agent '${agent.id}' type CODEX requires OPENAI_RESPONSES")
            }
            if (agent.enabled && type.engine == AgentEngine.CODEX && selectedLlm?.credentialRef == null) {
                invalid("$field.llm.providerRef", "Agent '${agent.id}' type CODEX requires a credential reference")
            }
            if (agent.enabled && type.engine == AgentEngine.CODEX) {
                if (agent.context.compression != CompressionSettingsDocument()) warn(
                    "CODEX_COMPRESSION_INERT", "$field.context.compression",
                    "CODEX manages its own context; Agent compression settings do not apply",
                )
                if (agent.context.toolResults != ToolResultSettingsDocument()) warn(
                    "CODEX_TOOL_RESULTS_INERT", "$field.context.toolResults",
                    "CODEX uses native tool results; internal tool-result cache settings do not apply",
                )
                if (agent.execution.maxSteps != AgentRuntimeDefaults.MAX_STEPS) warn(
                    "CODEX_MAX_STEPS_INERT", "$field.execution.maxSteps",
                    "CODEX does not use the internal Agent maximum-step setting",
                )
                if (agent.llm.generation != GenerationSettingsDocument()) warn(
                    "CODEX_GENERATION_INERT", "$field.llm.generation",
                    "CODEX currently does not apply Agent Temperature or maximum-output settings",
                )
            }
            if (agent.context.personaExampleTokens !in 0..4096) invalid("$field.context.personaExampleTokens", "Persona example token budget must be between 0 and 4096")
            if (agent.enabled && agent.llm.providerRef !in llms) invalid("$field.llm.providerRef", "Agent must reference an enabled LLM connection")
            if (agent.enabled && agent.llm.model.isBlank()) invalid("$field.llm.model", "Model is required")
            if (agent.configDirectory.isBlank() || agent.tempDirectory.isBlank()) invalid(field, "Agent configuration and temporary directories are required")
            else if (resolveDirectory(path, agent.configDirectory) == resolveDirectory(path, agent.tempDirectory)) invalid(field, "Configuration and temporary directories must be different")
            directory("$field.configDirectory", agent.configDirectory)
            directory("$field.tempDirectory", agent.tempDirectory)
            agent.skills.platformLibraries.forEach { if (it.libraryId !in skills) invalid("$field.skills", "Unknown skill library '${it.libraryId}'") }
            if (agent.skills.platformLibraries.map { it.libraryId }.distinct().size != agent.skills.platformLibraries.size) invalid("$field.skills", "Duplicate skill library binding")
            agent.memory.libraryIds.forEach { if (it !in memories) invalid("$field.memory", "Unknown memory library '$it'") }
            agent.memory.writeLibraryId?.let { if (it !in agent.memory.libraryIds) invalid("$field.memory.writeLibraryId", "Write library must be selected for this Agent") }
            if (agent.memory.maxInjected !in 0..50) invalid("$field.memory.maxInjected", "Memory injection count must be between 0 and 50")
            agent.memory.allowedScopes.forEach { if (it !in MemoryScope.entries.map(MemoryScope::name)) invalid("$field.memory.allowedScopes", "Unknown memory scope '$it'") }
            agent.mcpServerIds.forEach { if (it !in mcps) invalid("$field.mcpServerIds", "Unknown MCP server '$it'") }
            if (agent.personaId != null && agent.personaId.isBlank()) invalid("$field.personaId", "Use null when no persona is selected")
        }
    }

    /**
     * Reports enabled routes that can never match because an earlier enabled route already consumes every
     * input they accept.
     *
     * Route evaluation is first-match-wins, so unreachability is a correctness problem rather than a style
     * one: a `*P*` glob matches every input containing `P`, so a later `*Q*` route where `Q` contains `P`
     * never runs. The check is deliberately conservative - the earlier route must be at least as permissive
     * in session types, attention, mention handling and match mode, and its pattern must provably cover the
     * later one - so a report is never a false positive. It is a warning, not an error: the route table
     * stays loadable so the operator can reorder or narrow it.
     */
    private fun reportUnreachableRoutes(
        im: ImConnectionDocument,
        warn: (field: String, message: String) -> Unit,
    ) {
        val enabled = im.routes.filter { it.enabled }
        enabled.forEachIndexed { index, later ->
            val shadow = enabled.take(index).firstOrNull { earlier -> shadowsRoute(earlier.match, later.match) }
                ?: return@forEachIndexed
            warn(
                "ims.${im.id}.routes.${later.id}",
                "Route '${later.id}' can never match: earlier route '${shadow.id}' with pattern '${shadow.match.textPattern}' already matches every input it accepts. Reorder or narrow the earlier route.",
            )
        }
    }

    private fun shadowsRoute(earlier: ImRouteMatchDocument, later: ImRouteMatchDocument): Boolean {
        if (!earlier.sessionTypes.containsAll(later.sessionTypes)) return false
        if (earlier.attention != later.attention || earlier.attentionTarget != later.attentionTarget) return false
        if (earlier.stripMentions != later.stripMentions) return false
        if (earlier.textMode != later.textMode) return false
        if (earlier.textPattern == later.textPattern) return true
        return when (earlier.textMode) {
            ImTextMatchMode.GLOB -> {
                val earlierCore = globCore(earlier.textPattern)
                val laterCore = globCore(later.textPattern)
                earlierCore != null && laterCore != null && laterCore.contains(earlierCore)
            }
            ImTextMatchMode.PREFIX -> later.textPattern.startsWith(earlier.textPattern)
            // Identical exact patterns are handled above; different exact patterns never overlap.
            ImTextMatchMode.EXACT -> false
        }
    }

    /** Returns the literal core of a `*core*` glob, or null when the pattern is any other shape. */
    private fun globCore(pattern: String): String? {
        if (pattern.length < 2 || !pattern.startsWith("*") || !pattern.endsWith("*")) return null
        val core = pattern.substring(1, pattern.length - 1)
        return core.takeIf { it.isNotEmpty() && '*' !in it && '?' !in it }
    }

    private fun project(document: ApplicationConfigurationDocument, path: Path, content: String): RawConfigState {
        val enabled = document.agents.filter { it.enabled }
        val catalog = WorkspaceCatalogDocument(
            defaultWorkspaceId = enabled.firstOrNull()?.id ?: "unconfigured",
            entries = enabled.map { WorkspaceCatalogEntryDocument(it.id, resolveDirectory(path, it.configDirectory).toString()) },
        )
        val projection = AppConfigDocument(
            runtime = document.runtime,
            platforms = document.ims.map { PlatformConnectionDocument(it.id, it.type, it.enabled, credentialRefs = it.credentialRefs, settings = it.settings) },
            providers = document.llms,
            workspaces = catalog,
        )
        val units = enabled.associate { profile ->
            val agent = AgentDefinitionDocument(
                id = profile.id, displayName = profile.displayName, instructions = profile.instructions,
                type = profile.type,
                providerRef = profile.llm.providerRef, model = profile.llm.model, generation = profile.llm.generation,
                context = profile.context, execution = profile.execution, personaRef = profile.personaId, toolPolicy = profile.toolPolicy,
            )
            val unit = WorkspaceConfigDocument(
                id = profile.id, name = profile.displayName, primaryAgentId = profile.id, agents = listOf(agent),
                toolPolicy = document.toolPolicy,
                mcpServers = document.mcpServers.filter { it.enabled && it.id in profile.mcpServerIds },
                personas = profile.personaId?.let { listOf(PersonaDefinitionDocument(it, agentIds = listOf(profile.id))) }.orEmpty(),
                memory = MemoryPolicyDocument(
                    enabled = profile.memory.libraryIds.isNotEmpty(), allowedScopes = profile.memory.allowedScopes,
                    maxInjectedMemories = profile.memory.maxInjected,
                ),
            )
            profile.id to RawWorkspaceConfigState(
                unit, path.toAbsolutePath().normalize().toString(),
                RevisionedConfigFileStore().revisionOf(content),
                fingerprints.fingerprint(json.encodeToString(profile), json.encodeToString(document.skillLibraries), json.encodeToString(document.memoryLibraries)),
                configurationDirectory = resolveDirectory(path, profile.configDirectory).toString(),
            )
        }
        return RawConfigState(projection, path.toAbsolutePath().normalize().toString(), RevisionedConfigFileStore().revisionOf(content), units, document)
    }

    private fun failure(code: String, message: String, path: Path) = ConfigurationSourceResult<RawConfigState>(
        diagnostics = listOf(ConfigurationDiagnostic(code, DiagnosticSeverity.ERROR, message, path.toString())),
    )
}
