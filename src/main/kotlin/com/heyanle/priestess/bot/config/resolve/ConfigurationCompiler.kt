package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.ActivationPlan
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.ConfigurationSourceKind
import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.EffectiveAgent
import com.heyanle.priestess.bot.config.model.EffectiveConfigVersion
import com.heyanle.priestess.bot.config.model.EffectivePlatformConnection
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeView
import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.config.model.FieldProvenance
import com.heyanle.priestess.bot.config.model.RawConfigState
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.config.validation.ConfigurationValidator
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class ConfigurationCompilationResult(
    val desired: DesiredConfig? = null,
    val activationPlan: ActivationPlan = ActivationPlan(),
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
) {
    val isSuccess: Boolean
        get() = desired != null && diagnostics.none { it.severity == DiagnosticSeverity.ERROR }
}

/** Compiles typed authoring sources into one validated desired runtime candidate. */
class ConfigurationCompiler(
    private val environment: EnvironmentOverrideSource = EnvironmentOverrideSource(),
    private val validator: ConfigurationValidator = ConfigurationValidator(),
    private val provenanceBuilder: ConfigurationProvenanceBuilder = ConfigurationProvenanceBuilder(),
    private val toolPolicyResolver: ToolPolicyResolver = ToolPolicyResolver(),
    private val mcpConnector: McpServerConnector = McpServerConnector.Unsupported,
    private val json: Json = Json { encodeDefaults = true },
) {
    fun compile(
        raw: RawConfigState,
        registeredTools: Collection<ConfigurableToolDescriptor>,
        availableSkillIds: Set<String>,
    ): ConfigurationCompilationResult {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        raw.application?.let { diagnostics += com.heyanle.priestess.bot.config.application.ApplicationResourceValidator.validate(it, raw.sourcePath) }
        diagnostics += validator.validateGlobal(raw.document, raw.sourcePath).filterNot {
            raw.application != null && raw.document.workspaces.entries.isEmpty() && it.code == "CONFIG_DEFAULT_WORKSPACE_MISSING"
        }
        val environmentResult = environment.read()
        diagnostics += environmentResult.diagnostics
        val runtime = applyEnvironment(raw.document.runtime, environmentResult.overrides)
        val provenance = provenanceBuilder.global(raw.document, raw.sourcePath, raw.revision).toMutableMap()
        addEnvironmentProvenance(provenance, environmentResult.overrides)
        val serverCredential = raw.document.runtime.server.apiCredentialRef?.let { reference ->
            environment.resolveCredential(reference, "runtime.server.apiCredentialRef").also { resolution ->
                diagnostics += resolution.diagnostics
                provenance["runtime.server.apiCredentialRef"] = FieldProvenance(
                    ConfigurationSourceKind.ENVIRONMENT,
                    "environment:${reference.key}",
                    sourcePath = "runtime.server.apiCredentialRef",
                    redacted = true,
                )
            }.credential
        }

        val platforms = linkedMapOf<String, EffectivePlatformConnection>()
        raw.document.platforms.filter { it.enabled }.forEachIndexed { index, platform ->
            val credentials = linkedMapOf<String, com.heyanle.priestess.bot.config.model.GuardedSecret>()
            platform.credentialRefs.forEach { (name, reference) ->
                val resolution = environment.resolveCredential(reference, "platforms[$index].credentialRefs.$name")
                diagnostics += resolution.diagnostics
                resolution.credential?.let { credentials[name] = it }
                provenance["platforms[$index].credentialRefs.$name"] = FieldProvenance(
                    ConfigurationSourceKind.ENVIRONMENT,
                    "environment:${reference.key}",
                    sourcePath = "platforms[$index].credentialRefs.$name",
                    redacted = true,
                )
            }
            platforms[platform.id] = EffectivePlatformConnection(
                platform.id,
                platform.type,
                platform.enabled,
                platform.defaultWorkspaceId,
                credentials,
                platform.settings,
            )
        }

        val providers = linkedMapOf<String, EffectiveProviderConnection>()
        raw.document.providers.filter { it.enabled }.forEachIndexed { index, provider ->
            val resolution = provider.credentialRef?.let { reference ->
                environment.resolveCredential(reference, "providers[$index].credentialRef").also { result ->
                    diagnostics += result.diagnostics
                    provenance["providers[$index].credentialRef"] = FieldProvenance(
                        ConfigurationSourceKind.ENVIRONMENT,
                        "environment:${reference.key}",
                        sourcePath = "providers[$index].credentialRef",
                        redacted = true,
                    )
                }
            }
            providers[provider.id] = EffectiveProviderConnection(
                provider.id,
                provider.type,
                provider.enabled,
                provider.endpoint,
                resolution?.credential,
                provider.credentialRef,
                provider.settings,
            )
        }

        val workspaces = linkedMapOf<String, EffectiveWorkspaceSnapshot>()
        val resourceResolver = WorkspaceRuntimeResourceResolver(environment, mcpConnector)
        raw.document.workspaces.entries.filter { it.enabled }.forEach { entry ->
            val workspaceRaw = raw.workspaces[entry.id]
            if (workspaceRaw == null) {
                diagnostics += ConfigurationDiagnostic(
                    "CONFIG_WORKSPACE_SOURCE_MISSING",
                    DiagnosticSeverity.ERROR,
                    "Workspace '${entry.id}' has no loaded source document",
                    raw.sourcePath,
                    "workspaces.entries[${entry.id}]",
                )
                return@forEach
            }
            val resources = resourceResolver.resolve(workspaceRaw.document, registeredTools, availableSkillIds)
            diagnostics += resources.diagnostics
            val mcpToolDescriptors = resources.tools.map { ConfigurableToolDescriptor(it.schema.name, it.schema.riskLevel, it.schema.defaultEnabled) }
            val allTools = registeredTools + mcpToolDescriptors
            val workspaceDiagnostics = validator.validateWorkspace(
                document = workspaceRaw.document,
                catalogEntry = entry,
                providers = providers.keys,
                availableToolIds = registeredTools.mapTo(linkedSetOf()) { it.id },
                availableSkillIds = availableSkillIds,
                mcpToolIds = resources.mcpToolIds,
                source = workspaceRaw.sourcePath,
            )
            diagnostics += workspaceDiagnostics
            provenance += provenanceBuilder.workspace(
                workspaceRaw.document,
                workspaceRaw.sourcePath,
                workspaceRaw.revision,
            )
            if ((workspaceDiagnostics + resources.diagnostics).any { it.severity == DiagnosticSeverity.ERROR }) {
                resources.handles.forEach { runCatching { it.close() } }
                return@forEach
            }
            val agents = workspaceRaw.document.agents.filter { it.enabled }.associate { agent ->
                val provider = providers.getValue(agent.providerRef)
                val toolIds = if (raw.application != null) toolPolicyResolver.resolveApplication(
                    available = allTools,
                    platformPolicy = workspaceRaw.document.toolPolicy,
                    agentPolicy = agent.toolPolicy,
                ) else toolPolicyResolver.resolve(
                    available = allTools,
                    workspacePolicy = workspaceRaw.document.toolPolicy,
                    agentPolicy = agent.toolPolicy,
                )
                agent.id to EffectiveAgent(agent, provider, toolIds)
            }
            workspaces[entry.id] = EffectiveWorkspaceSnapshot(
                version = EffectiveConfigVersion(0),
                fingerprint = workspaceRaw.fingerprint,
                sourcePath = workspaceRaw.sourcePath,
                config = workspaceRaw.document,
                agents = agents,
                availableToolIds = allTools.mapTo(sortedSetOf()) { it.id },
                runtimeTools = resources.tools,
                resourceHandles = resources.handles,
                diagnostics = resources.diagnostics,
                configurationDirectory = workspaceRaw.configurationDirectory,
            )
        }

        if (diagnostics.any { it.severity == DiagnosticSeverity.ERROR }) {
            workspaces.values.flatMap { it.resourceHandles }.forEach { runCatching { it.close() } }
            return ConfigurationCompilationResult(diagnostics = diagnostics)
        }
        val fingerprintSources = buildList {
            add(json.encodeToString(raw.document))
            raw.workspaces.toSortedMap().values.forEach { add(json.encodeToString(it.document)) }
            raw.application?.let { add(json.encodeToString(it)) }
        }
        val sourceFingerprint = provenanceBuilder.fingerprint(*fingerprintSources.toTypedArray())
        provenance[FINGERPRINT_PROVENANCE_KEY] = FieldProvenance(
            ConfigurationSourceKind.GLOBAL_DOCUMENT,
            sourceFingerprint.value,
        )
        val desired = DesiredConfig(
            document = raw.document,
            rawRevision = raw.revision,
            sourceFingerprint = sourceFingerprint,
            runtime = runtime,
            serverApiCredential = serverCredential,
            platforms = platforms,
            providers = providers,
            workspaces = workspaces,
            provenance = provenance,
            diagnostics = diagnostics,
            application = raw.application?.let {
                com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource().resolveDirectories(it, java.nio.file.Path.of(raw.sourcePath))
            },
        )
        return ConfigurationCompilationResult(
            desired = desired,
            diagnostics = diagnostics,
            activationPlan = ActivationPlan(),
        )
    }

    private fun applyEnvironment(
        source: com.heyanle.priestess.bot.config.model.RuntimeConfigDocument,
        overrides: com.heyanle.priestess.bot.config.source.EnvironmentOverrides,
    ): EffectiveRuntimeView {
        return EffectiveRuntimeView(
            server = source.server.copy(
                enabled = overrides.serverEnabled ?: source.server.enabled,
                host = overrides.serverHost ?: source.server.host,
                port = overrides.serverPort ?: source.server.port,
                corsEnabled = overrides.serverCorsEnabled ?: source.server.corsEnabled,
            ),
            database = source.database.copy(path = overrides.databasePath ?: source.database.path),
            plugins = source.plugins.copy(
                enabled = overrides.pluginsEnabled ?: source.plugins.enabled,
                directory = overrides.pluginsDirectory ?: source.plugins.directory,
                autoDiscover = overrides.pluginsAutoDiscover ?: source.plugins.autoDiscover,
            ),
            reload = source.reload.copy(
                enabled = overrides.reloadEnabled ?: source.reload.enabled,
                intervalMillis = overrides.reloadIntervalMillis ?: source.reload.intervalMillis,
            ),
            pipeline = source.pipeline,
            command = source.command,
            permission = source.permission,
        )
    }

    private fun addEnvironmentProvenance(
        provenance: MutableMap<String, FieldProvenance>,
        overrides: com.heyanle.priestess.bot.config.source.EnvironmentOverrides,
    ) {
        listOf(
            Triple("runtime.server.enabled", "PRIESTESS_SERVER_ENABLED", overrides.serverEnabled),
            Triple("runtime.server.host", "PRIESTESS_SERVER_HOST", overrides.serverHost),
            Triple("runtime.server.port", "PRIESTESS_SERVER_PORT", overrides.serverPort),
            Triple("runtime.server.corsEnabled", "PRIESTESS_SERVER_CORS_ENABLED", overrides.serverCorsEnabled),
            Triple("runtime.reload.enabled", "PRIESTESS_CONFIG_WATCH_ENABLED", overrides.reloadEnabled),
            Triple("runtime.reload.intervalMillis", "PRIESTESS_CONFIG_WATCH_INTERVAL_MILLIS", overrides.reloadIntervalMillis),
            Triple("runtime.database.path", "PRIESTESS_DATABASE_PATH", overrides.databasePath),
            Triple("runtime.plugins.enabled", "PRIESTESS_PLUGINS_ENABLED", overrides.pluginsEnabled),
            Triple("runtime.plugins.directory", "PRIESTESS_PLUGINS_DIRECTORY", overrides.pluginsDirectory),
            Triple("runtime.plugins.autoDiscover", "PRIESTESS_PLUGINS_AUTO_DISCOVER", overrides.pluginsAutoDiscover),
        ).filter { it.third != null }.forEach { (path, variable, _) ->
            provenance[path] = FieldProvenance(
                ConfigurationSourceKind.ENVIRONMENT,
                "environment:$variable",
                sourcePath = path,
            )
        }
    }

    companion object {
        private const val FINGERPRINT_PROVENANCE_KEY = "@sourceFingerprint"
    }
}
