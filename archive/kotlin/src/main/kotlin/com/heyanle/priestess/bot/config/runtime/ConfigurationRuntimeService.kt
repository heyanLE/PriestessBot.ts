package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.ActivationPlan
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.RawConfigState
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompilationResult
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.resolve.ConfigurationProvenanceBuilder
import com.heyanle.priestess.bot.config.source.AppConfigDocumentDecoder
import com.heyanle.priestess.bot.config.source.AppConfigFileSource
import com.heyanle.priestess.bot.config.source.ConfigurationSourceResult
import com.heyanle.priestess.bot.config.source.PersistResult
import com.heyanle.priestess.bot.config.source.RevisionedConfigFileStore
import com.heyanle.priestess.bot.config.source.StableConfigFileWatcher
import com.heyanle.priestess.bot.config.source.WorkspaceConfigFileSource
import com.heyanle.priestess.bot.config.source.WorkspaceConfigDocumentDecoder
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.fileSize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable
data class ConfigurationOperationResult(
    val success: Boolean,
    val desiredRevision: String? = null,
    val activeVersion: Long? = null,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
    val activationPlan: ActivationPlan = ActivationPlan(),
    val pendingRestartPaths: List<String> = emptyList(),
)

/** One orchestration path for startup, preview, apply, reload, restore, and watched reload. */
class ConfigurationRuntimeService(
    private val configPath: Path,
    private val compiler: ConfigurationCompiler,
    private val store: EffectiveConfigStore,
    private val activation: ConfigActivationCoordinator = ConfigActivationCoordinator(store),
    private val appSource: AppConfigFileSource = AppConfigFileSource(),
    private val workspaceSource: WorkspaceConfigFileSource = WorkspaceConfigFileSource(),
    private val decoder: AppConfigDocumentDecoder = AppConfigDocumentDecoder(),
    private val fileStore: RevisionedConfigFileStore = RevisionedConfigFileStore(),
    private val workspaceDecoder: WorkspaceConfigDocumentDecoder = WorkspaceConfigDocumentDecoder(),
    private val provenanceBuilder: ConfigurationProvenanceBuilder = ConfigurationProvenanceBuilder(),
    private val registeredTools: () -> Collection<ConfigurableToolDescriptor>,
    private val availableSkills: () -> Set<String>,
    private val applicationSource: com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource? = null,
) {
    private val watcherScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var configuredWatcher: Job? = null

    fun sourcePath(): Path = configPath.toAbsolutePath().normalize()

    fun currentSnapshot(): com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot? = store.current()

    /** Read-only source inspection used by management APIs; it never activates or rewrites files. */
    fun inspectRaw(): ConfigurationSourceResult<RawConfigState> {
        applicationSource?.let { return it.load(sourcePath()) }
        val global = appSource.load(configPath)
        val raw = global.value ?: return ConfigurationSourceResult(diagnostics = global.diagnostics)
        val diagnostics = global.diagnostics.toMutableList()
        val base = sourcePath().parent ?: Path.of("").toAbsolutePath().normalize()
        val workspaces = linkedMapOf<String, com.heyanle.priestess.bot.config.model.RawWorkspaceConfigState>()
        raw.document.workspaces.entries.filter { it.enabled }.forEach { entry ->
            val loaded = workspaceSource.load(entry, base)
            diagnostics += loaded.diagnostics
            loaded.value?.let { workspaces[entry.id] = it }
        }
        val value = raw.copy(workspaces = workspaces)
            .takeUnless { diagnostics.any { diagnostic -> diagnostic.severity == DiagnosticSeverity.ERROR } }
        return ConfigurationSourceResult(value = value, diagnostics = diagnostics)
    }

    fun startup(): ConfigurationOperationResult {
        currentSnapshot()?.let { active ->
            return ConfigurationOperationResult(
                success = true,
                desiredRevision = active.desiredRevision.value,
                activeVersion = active.version.value,
                diagnostics = active.diagnostics,
                pendingRestartPaths = active.pendingRestart.map { it.path },
            )
        }
        val migration = if (applicationSource != null) {
            com.heyanle.priestess.bot.config.application.ApplicationConfigurationMigrator().migrateIfNeeded(sourcePath())
        } else {
            com.heyanle.priestess.bot.config.application.MigrationResult(migrated = false)
        }
        val result = reloadFromDisk()
        // Migration warnings describe the operator's authored Agents; surface them beside activation
        // diagnostics instead of discarding them with the migrator's return value.
        return result.copy(diagnostics = result.diagnostics + migration.diagnostics)
    }

    @Synchronized
    fun reloadFromDisk(): ConfigurationOperationResult {
        val raw = loadRawFromDisk() ?: return lastLoadFailure
        if (raw.application != null) {
            val candidate = prepareApplication(raw)
            val desired = candidate.compilation.desired ?: return candidate.compilation.toOperation()
            candidate.normalizedContent?.let { content ->
                if (fileStore.persist(sourcePath(), content, raw.revision, isValidExisting = { false }) is PersistResult.Conflict) {
                    closeCandidate(desired)
                    return revisionConflict()
                }
            }
            return activate(desired)
        }
        return compileAndActivate(raw)
    }

    fun reloadWorkspace(@Suppress("UNUSED_PARAMETER") workspaceId: String): ConfigurationOperationResult {
        return reloadFromDisk()
    }

    fun preview(content: String): ConfigurationOperationResult {
        if (applicationSource != null) return previewApplication(content)
        val raw = candidateRaw(content) ?: return lastLoadFailure
        val compilation = compiler.compile(raw, registeredTools(), availableSkills())
        val desired = compilation.desired
        val plan = desired?.let { ConfigurationDiffClassifier().classify(store.current(), it) } ?: compilation.activationPlan
        desired?.workspaces?.values?.flatMap { it.resourceHandles }?.forEach { runCatching { it.close() } }
        return compilation.toOperation(plan = plan, activateResult = null)
    }

    fun previewWorkspace(workspaceId: String, content: String): ConfigurationOperationResult {
        if (applicationSource != null) return legacyWorkspaceAuthoringDisabled()
        val raw = candidateWorkspaceRaw(workspaceId, content) ?: return lastLoadFailure
        val compilation = compiler.compile(raw, registeredTools(), availableSkills())
        val desired = compilation.desired
        val plan = desired?.let { ConfigurationDiffClassifier().classify(store.current(), it) } ?: compilation.activationPlan
        desired?.workspaces?.values?.flatMap { it.resourceHandles }?.forEach { runCatching { it.close() } }
        return compilation.toOperation(plan = plan, activateResult = null)
    }

    fun apply(content: String, expectedRevision: com.heyanle.priestess.bot.config.model.RawConfigRevision?): ConfigurationOperationResult {
        if (applicationSource != null) return applyApplication(content, expectedRevision)
        val raw = candidateRaw(content) ?: return lastLoadFailure
        val compilation = compiler.compile(raw, registeredTools(), availableSkills())
        val desired = compilation.desired
        if (!compilation.isSuccess || desired == null) return compilation.toOperation()
        val persisted = fileStore.persist(configPath, content, expectedRevision) { existing ->
            decoder.decode(existing, configPath.toString()).isSuccess
        }
        if (persisted is PersistResult.Conflict) {
            desired.workspaces.values.flatMap { it.resourceHandles }.forEach { runCatching { it.close() } }
            return ConfigurationOperationResult(
                success = false,
                diagnostics = listOf(
                    ConfigurationDiagnostic(
                        "CONFIG_REVISION_CONFLICT",
                        DiagnosticSeverity.ERROR,
                        "Configuration source changed since it was read",
                        configPath.toString(),
                    ),
                ),
            )
        }
        return activate(desired)
    }

    fun applyWorkspace(
        workspaceId: String,
        content: String,
        expectedRevision: com.heyanle.priestess.bot.config.model.RawConfigRevision?,
    ): ConfigurationOperationResult {
        if (applicationSource != null) return legacyWorkspaceAuthoringDisabled()
        val raw = candidateWorkspaceRaw(workspaceId, content) ?: return lastLoadFailure
        val compilation = compiler.compile(raw, registeredTools(), availableSkills())
        val desired = compilation.desired
        if (!compilation.isSuccess || desired == null) return compilation.toOperation()
        val path = workspaceConfigPath(raw.document, workspaceId) ?: return lastLoadFailure
        val persisted = fileStore.persist(path, content, expectedRevision) { existing ->
            workspaceDecoder.decodeWorkspace(existing, path.toString()).isSuccess
        }
        if (persisted is PersistResult.Conflict) {
            desired.workspaces.values.flatMap { it.resourceHandles }.forEach { runCatching { it.close() } }
            return ConfigurationOperationResult(
                success = false,
                diagnostics = listOf(
                    ConfigurationDiagnostic(
                        "CONFIG_REVISION_CONFLICT",
                        DiagnosticSeverity.ERROR,
                        "Workspace configuration source changed since it was read",
                        path.toString(),
                    ),
                ),
            )
        }
        return activate(desired)
    }

    fun restore(backupPath: Path, expectedRevision: com.heyanle.priestess.bot.config.model.RawConfigRevision?): ConfigurationOperationResult {
        if (!Files.isRegularFile(backupPath)) {
            return ConfigurationOperationResult(
                false,
                diagnostics = listOf(ConfigurationDiagnostic("CONFIG_BACKUP_MISSING", DiagnosticSeverity.ERROR, "Backup file does not exist", backupPath.toString())),
            )
        }
        return apply(Files.readString(backupPath), expectedRevision)
    }

    fun listBackups(): List<ConfigurationBackupView> {
        val root = sourcePath().parent
            ?.resolve("backups")
            ?.resolve(sourcePath().fileName.toString())
            ?: return emptyList()
        if (!Files.isDirectory(root)) return emptyList()
        return Files.list(root).use { paths ->
            paths.filter(Files::isRegularFile)
                .map { path ->
                    ConfigurationBackupView(
                        id = path.fileName.toString(),
                        createdAtEpochMillis = Files.getLastModifiedTime(path).toMillis(),
                        sizeBytes = path.fileSize(),
                    )
                }
                .sorted(compareByDescending<ConfigurationBackupView> { it.createdAtEpochMillis })
                .toList()
        }
    }

    fun restoreBackup(id: String, expectedRevision: com.heyanle.priestess.bot.config.model.RawConfigRevision?): ConfigurationOperationResult {
        if (id.isBlank() || id != Path.of(id).fileName.toString()) {
            return ConfigurationOperationResult(
                false,
                diagnostics = listOf(ConfigurationDiagnostic("CONFIG_BACKUP_ID_INVALID", DiagnosticSeverity.ERROR, "Invalid backup id", sourcePath().toString())),
            )
        }
        val backup = sourcePath().parent.resolve("backups").resolve(sourcePath().fileName.toString()).resolve(id).normalize()
        return restore(backup, expectedRevision)
    }

    fun startWatcher(scope: CoroutineScope, pollIntervalMillis: Long, stabilityWindowMillis: Long): Job {
        val watcher = StableConfigFileWatcher(configPath, stabilityWindowMillis)
        return scope.launch {
            watcher.watch(pollIntervalMillis) { stable ->
                if (fileStore.revision(configPath) == stable.revision) reloadFromDisk()
            }
        }
    }

    fun startConfiguredWatcher() {
        if (configuredWatcher != null) return
        configuredWatcher = watcherScope.launch(start = CoroutineStart.UNDISPATCHED) {
            store.snapshots.filterNotNull().collectLatest { snapshot ->
                val reload = snapshot.runtime.reload
                if (!reload.enabled) return@collectLatest
                StableConfigFileWatcher(configPath, reload.stabilityWindowMillis).watch(reload.intervalMillis) { stable ->
                    if (fileStore.revision(configPath) == stable.revision) reloadFromDisk()
                }
            }
        }
    }

    fun stop() {
        configuredWatcher?.cancel()
        configuredWatcher = null
        watcherScope.cancel()
    }

    fun bootstrap(): ConfigurationOperationResult {
        val result = appSource.bootstrap(configPath)
        if (!result.isSuccess) return ConfigurationOperationResult(false, diagnostics = result.diagnostics)
        return reloadFromDisk()
    }

    fun state(): ConfigRuntimeState = activation.state()

    private var lastLoadFailure = ConfigurationOperationResult(false)

    private fun loadRawFromDisk(): RawConfigState? {
        val inspected = inspectRaw()
        val raw = inspected.value
        if (raw == null) {
            lastLoadFailure = ConfigurationOperationResult(false, diagnostics = inspected.diagnostics)
            return null
        }
        return raw
    }

    private fun candidateRaw(content: String): RawConfigState? {
        val decoded = decoder.decode(content, configPath.toString())
        val document = decoded.value
        if (document == null) {
            lastLoadFailure = ConfigurationOperationResult(false, diagnostics = decoded.diagnostics)
            return null
        }
        return attachWorkspaces(
            RawConfigState(
                document = document,
                sourcePath = configPath.toAbsolutePath().normalize().toString(),
                revision = fileStore.revisionOf(content),
            ),
        )
    }

    private fun candidateWorkspaceRaw(workspaceId: String, content: String): RawConfigState? {
        val inspected = inspectRaw()
        val raw = inspected.value
        if (raw == null) {
            lastLoadFailure = ConfigurationOperationResult(false, diagnostics = inspected.diagnostics)
            return null
        }
        val path = workspaceConfigPath(raw.document, workspaceId)
        if (path == null) {
            lastLoadFailure = ConfigurationOperationResult(
                false,
                diagnostics = listOf(
                    ConfigurationDiagnostic(
                        "WORKSPACE_NOT_FOUND",
                        DiagnosticSeverity.ERROR,
                        "Workspace '$workspaceId' is not registered and enabled",
                        raw.sourcePath,
                        "workspaces.entries[$workspaceId]",
                    ),
                ),
            )
            return null
        }
        val decoded = workspaceDecoder.decodeWorkspace(content, path.toString())
        var document = decoded.value
        if (document == null) {
            lastLoadFailure = ConfigurationOperationResult(false, diagnostics = decoded.diagnostics)
            return null
        }
        val root = path.parent
        val mcpPath = root.resolve("mcpserver.json")
        val mcpText = if (Files.isRegularFile(mcpPath)) Files.readString(mcpPath) else ""
        if (mcpText.isNotBlank()) {
            val mcp = workspaceDecoder.decodeMcpServers(mcpText, mcpPath.toString())
            val mcpDocument = mcp.value
            if (mcpDocument == null) {
                lastLoadFailure = ConfigurationOperationResult(false, diagnostics = decoded.diagnostics + mcp.diagnostics)
                return null
            }
            if (document.mcpServers.isNotEmpty() && mcpDocument.mcpServers.isNotEmpty()) {
                lastLoadFailure = ConfigurationOperationResult(
                    false,
                    diagnostics = listOf(
                        ConfigurationDiagnostic(
                            "WORKSPACE_MCP_MULTIPLE_AUTHORITIES",
                            DiagnosticSeverity.ERROR,
                            "Declare MCP servers in mcpserver.json or config.yaml, not both",
                            path.toString(),
                            "mcpServers",
                        ),
                    ),
                )
                return null
            }
            if (mcpDocument.mcpServers.isNotEmpty()) document = document.copy(mcpServers = mcpDocument.mcpServers)
        }
        val fingerprint = provenanceBuilder.fingerprint(content, mcpText)
        val workspace = com.heyanle.priestess.bot.config.model.RawWorkspaceConfigState(
            document = document,
            sourcePath = path.toString(),
            revision = fileStore.revisionOf(content),
            fingerprint = fingerprint,
        )
        return raw.copy(workspaces = raw.workspaces + (workspaceId to workspace))
    }

    private fun workspaceConfigPath(
        document: com.heyanle.priestess.bot.config.model.AppConfigDocument,
        workspaceId: String,
    ): Path? {
        val entry = document.workspaces.entries.firstOrNull { it.enabled && it.id == workspaceId } ?: return null
        val base = sourcePath().parent ?: Path.of("").toAbsolutePath().normalize()
        val rootCandidate = Path.of(entry.directory)
        val root = (if (rootCandidate.isAbsolute) rootCandidate else base.resolve(rootCandidate))
            .toAbsolutePath()
            .normalize()
        return root.resolve("config.yaml").normalize()
    }

    private fun attachWorkspaces(raw: RawConfigState): RawConfigState? {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        val base = configPath.toAbsolutePath().normalize().parent ?: Path.of("").toAbsolutePath().normalize()
        val workspaces = linkedMapOf<String, com.heyanle.priestess.bot.config.model.RawWorkspaceConfigState>()
        raw.document.workspaces.entries.filter { it.enabled }.forEach { entry ->
            val loaded = workspaceSource.load(entry, base)
            diagnostics += loaded.diagnostics
            loaded.value?.let { workspaces[entry.id] = it }
        }
        if (diagnostics.any { it.severity == DiagnosticSeverity.ERROR }) {
            lastLoadFailure = ConfigurationOperationResult(false, diagnostics = diagnostics)
            return null
        }
        return raw.copy(workspaces = workspaces)
    }

    private fun compileAndActivate(raw: RawConfigState): ConfigurationOperationResult {
        val compilation = compiler.compile(raw, registeredTools(), availableSkills())
        val desired = compilation.desired ?: return compilation.toOperation()
        return activate(desired)
    }

    private fun activate(desired: com.heyanle.priestess.bot.config.model.DesiredConfig): ConfigurationOperationResult {
        desired.application?.let { app ->
            val resolver = checkNotNull(applicationSource)
            val platformRoot = resolver.resolveDirectory(sourcePath(), app.platformDirectory)
            Files.createDirectories(platformRoot)
            app.agents.filter { it.enabled }.forEach {
                Files.createDirectories(resolver.resolveDirectory(sourcePath(), it.configDirectory).resolve("skills"))
                Files.createDirectories(resolver.resolveDirectory(sourcePath(), it.tempDirectory).resolve("skills"))
            }
            app.skillLibraries.filter { it.enabled }.forEach {
                val root = Path.of(it.directory).let { directory -> if (directory.isAbsolute) directory else platformRoot.resolve(directory) }
                Files.createDirectories(root)
            }
        }
        val result = activation.activate(desired)
        return ConfigurationOperationResult(
            success = result.success,
            desiredRevision = result.desiredRevision.value,
            activeVersion = result.activeVersion,
            activationPlan = result.plan,
            pendingRestartPaths = result.pendingRestart.map { it.path },
        )
    }

    private fun ConfigurationCompilationResult.toOperation(
        plan: ActivationPlan = activationPlan,
        activateResult: ConfigActivationResult? = null,
    ): ConfigurationOperationResult = ConfigurationOperationResult(
        success = isSuccess,
        desiredRevision = desired?.rawRevision?.value,
        activeVersion = activateResult?.activeVersion,
        diagnostics = diagnostics,
        activationPlan = plan,
        pendingRestartPaths = activateResult?.pendingRestart?.map { it.path }.orEmpty(),
    )

    fun previewApplication(content: String): ConfigurationOperationResult {
        val source = applicationSource ?: com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
        val decoded = source.decode(content, sourcePath())
        val raw = decoded.value ?: return ConfigurationOperationResult(false, diagnostics = decoded.diagnostics)
        val compilation = prepareApplication(raw).compilation
        val plan = compilation.desired?.let { ConfigurationDiffClassifier().classify(store.current(), it) } ?: compilation.activationPlan
        compilation.desired?.workspaces?.values?.flatMap { it.resourceHandles }?.forEach { runCatching { it.close() } }
        return compilation.toOperation(plan = plan)
    }

    private fun legacyWorkspaceAuthoringDisabled() = ConfigurationOperationResult(
        false,
        diagnostics = listOf(ConfigurationDiagnostic("V3_AGENT_AUTHORING_REQUIRED", DiagnosticSeverity.ERROR,
            "Workspace authoring is retired; edit Agents through /api/config/v3", sourcePath().toString())),
    )

    @Synchronized
    fun applyApplication(content: String, expectedRevision: com.heyanle.priestess.bot.config.model.RawConfigRevision?): ConfigurationOperationResult {
        val source = applicationSource ?: com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
        val decoded = source.decode(content, sourcePath())
        val raw = decoded.value ?: return ConfigurationOperationResult(false, diagnostics = decoded.diagnostics)
        val candidate = prepareApplication(raw)
        val compilation = candidate.compilation
        val desired = compilation.desired ?: return compilation.toOperation()
        val saved = fileStore.persist(sourcePath(), candidate.normalizedContent ?: content, expectedRevision, isValidExisting = { false })
        if (saved is PersistResult.Conflict) {
            desired.workspaces.values.flatMap { it.resourceHandles }.forEach { runCatching { it.close() } }
            return ConfigurationOperationResult(false, diagnostics = listOf(ConfigurationDiagnostic(
                "CONFIG_REVISION_CONFLICT", DiagnosticSeverity.ERROR, "Configuration changed since it was read", sourcePath().toString(),
            )))
        }
        return activate(desired)
    }

    private data class ApplicationCandidate(
        val compilation: ConfigurationCompilationResult,
        val normalizedContent: String? = null,
    )

    /** Resolve dynamic MCP descriptors before converting old policies; only changed authoring is recompiled. */
    private fun prepareApplication(raw: RawConfigState): ApplicationCandidate {
        val tools = registeredTools().toList()
        val skills = availableSkills()
        val first = compiler.compile(raw, tools, skills)
        val desired = first.desired ?: return ApplicationCandidate(first)
        val document = checkNotNull(raw.application)
        val dynamicTools = desired.workspaces.values.flatMap { workspace ->
            workspace.runtimeTools.map { ConfigurableToolDescriptor(it.schema.name, it.schema.riskLevel, it.schema.defaultEnabled) }
        }
        val normalized = com.heyanle.priestess.bot.config.application.ApplicationToolPolicyInitializer()
            .normalize(document, tools + dynamicTools)
        if (normalized == document) return ApplicationCandidate(first)
        closeCandidate(desired)
        val source = applicationSource ?: com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
        val content = source.json.encodeToString(normalized)
        val decoded = source.decode(content, sourcePath())
        val normalizedRaw = decoded.value ?: return ApplicationCandidate(ConfigurationCompilationResult(diagnostics = decoded.diagnostics))
        return ApplicationCandidate(compiler.compile(normalizedRaw, tools, skills), content)
    }

    private fun closeCandidate(desired: com.heyanle.priestess.bot.config.model.DesiredConfig) {
        val live = store.current()?.workspaces?.values.orEmpty().flatMap { it.resourceHandles }
        desired.workspaces.values.flatMap { it.resourceHandles }.distinct()
            .filter { candidate -> live.none { it === candidate } }
            .forEach { runCatching { it.close() } }
    }

    private fun revisionConflict() = ConfigurationOperationResult(false, diagnostics = listOf(ConfigurationDiagnostic(
        "CONFIG_REVISION_CONFLICT", DiagnosticSeverity.ERROR, "Configuration changed since it was read", sourcePath().toString(),
    )))
}

@Serializable
data class ConfigurationBackupView(
    val id: String,
    val createdAtEpochMillis: Long,
    val sizeBytes: Long,
)
