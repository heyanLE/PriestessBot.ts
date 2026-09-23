package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeView
import com.heyanle.priestess.bot.config.model.FieldProvenance
import com.heyanle.priestess.bot.config.model.PendingRestart
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.RedactedEffectiveProviderView
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.config.model.redacted
import com.heyanle.priestess.bot.config.runtime.ConfigurationOperationResult
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.ConfigurationBackupView
import kotlinx.serialization.Serializable

/** Dashboard-facing, serialization-safe projection over the configuration runtime. */
class ConfigurationManagementService(
    private val runtime: ConfigurationRuntimeService,
) {
    fun raw(): RawGlobalConfigurationResponse {
        val inspected = runtime.inspectRaw()
        val raw = inspected.value
        return RawGlobalConfigurationResponse(
            document = raw?.document,
            normalizedSourcePath = raw?.sourcePath ?: runtime.sourcePath().toString(),
            revision = raw?.revision?.value,
            schemaVersion = raw?.document?.schemaVersion,
            workspaceSources = raw?.workspaces.orEmpty().mapValues { (_, workspace) ->
                RawWorkspaceSourceSummary(
                    id = workspace.document.id,
                    normalizedSourcePath = workspace.sourcePath,
                    revision = workspace.revision.value,
                    fingerprint = workspace.fingerprint.value,
                    schemaVersion = workspace.document.schemaVersion,
                )
            },
            diagnostics = inspected.diagnostics,
        )
    }

    fun rawWorkspace(id: String): RawWorkspaceConfigurationResponse {
        val inspected = runtime.inspectRaw()
        val workspace = inspected.value?.workspaces?.get(id)
        val diagnostics = if (workspace == null && inspected.diagnostics.none { it.path.contains(id) }) {
            inspected.diagnostics + ConfigurationDiagnostic(
                code = "WORKSPACE_NOT_FOUND",
                severity = com.heyanle.priestess.bot.config.model.DiagnosticSeverity.ERROR,
                message = "Workspace '$id' is not registered or could not be loaded",
                source = runtime.sourcePath().toString(),
                path = "workspaces.entries[$id]",
            )
        } else {
            inspected.diagnostics
        }
        return RawWorkspaceConfigurationResponse(
            id = id,
            document = workspace?.document,
            normalizedSourcePath = workspace?.sourcePath,
            revision = workspace?.revision?.value,
            fingerprint = workspace?.fingerprint?.value,
            schemaVersion = workspace?.document?.schemaVersion,
            diagnostics = diagnostics,
        )
    }

    fun effective(): EffectiveConfigurationResponse? {
        val snapshot = runtime.currentSnapshot() ?: return null
        return EffectiveConfigurationResponse(
            activeVersion = snapshot.version.value,
            desiredRevision = snapshot.desiredRevision.value,
            sourceFingerprint = snapshot.sourceFingerprint.value,
            loadedAtEpochMillis = snapshot.loadedAtEpochMillis,
            runtime = snapshot.runtime,
            platforms = snapshot.platforms.mapValues { (_, platform) ->
                RedactedEffectivePlatformView(
                    id = platform.id,
                    type = platform.type,
                    enabled = platform.enabled,
                    defaultWorkspaceId = platform.defaultWorkspaceId,
                    credentialNames = platform.credentials.keys.sorted(),
                    settings = platform.settings,
                )
            },
            providers = snapshot.providers.mapValues { (_, provider) -> provider.redacted() },
            workspaces = snapshot.workspaces.mapValues { (_, workspace) ->
                EffectiveWorkspaceStatusView(
                    id = workspace.config.id,
                    name = workspace.config.name,
                    version = workspace.version.value,
                    fingerprint = workspace.fingerprint.value,
                    agentIds = workspace.agents.keys.sorted(),
                    availableToolIds = workspace.availableToolIds.sorted(),
                    diagnostics = workspace.diagnostics,
                )
            },
            provenance = snapshot.provenance,
            diagnostics = snapshot.diagnostics,
            pendingRestart = snapshot.pendingRestart,
        )
    }

    fun preview(request: ConfigurationContentRequest): ConfigurationOperationResult = runtime.preview(request.content)

    fun previewWorkspace(id: String, request: ConfigurationContentRequest): ConfigurationOperationResult =
        runtime.previewWorkspace(id, request.content)

    fun apply(request: ConfigurationApplyRequest): ConfigurationOperationResult = runtime.apply(
        request.content,
        request.expectedRevision?.let(::RawConfigRevision),
    )

    fun applyWorkspace(id: String, request: ConfigurationApplyRequest): ConfigurationOperationResult = runtime.applyWorkspace(
        id,
        request.content,
        request.expectedRevision?.let(::RawConfigRevision),
    )

    fun reload(): ConfigurationOperationResult = runtime.reloadFromDisk()

    fun backups(): List<ConfigurationBackupView> = runtime.listBackups()

    fun restoreBackup(id: String): ConfigurationOperationResult {
        val revision = runtime.inspectRaw().value?.revision
        return runtime.restoreBackup(id, revision)
    }
}

@Serializable
data class RawGlobalConfigurationResponse(
    val document: AppConfigDocument? = null,
    val normalizedSourcePath: String,
    val revision: String? = null,
    val schemaVersion: Int? = null,
    val workspaceSources: Map<String, RawWorkspaceSourceSummary> = emptyMap(),
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

@Serializable
data class RawWorkspaceSourceSummary(
    val id: String,
    val normalizedSourcePath: String,
    val revision: String,
    val fingerprint: String,
    val schemaVersion: Int,
)

@Serializable
data class RawWorkspaceConfigurationResponse(
    val id: String,
    val document: WorkspaceConfigDocument? = null,
    val normalizedSourcePath: String? = null,
    val revision: String? = null,
    val fingerprint: String? = null,
    val schemaVersion: Int? = null,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

@Serializable
data class RedactedEffectivePlatformView(
    val id: String,
    val type: String,
    val enabled: Boolean,
    val defaultWorkspaceId: String? = null,
    val credentialNames: List<String> = emptyList(),
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class EffectiveWorkspaceStatusView(
    val id: String,
    val name: String,
    val version: Long,
    val fingerprint: String,
    val agentIds: List<String>,
    val availableToolIds: List<String>,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

@Serializable
data class EffectiveConfigurationResponse(
    val activeVersion: Long,
    val desiredRevision: String,
    val sourceFingerprint: String,
    val loadedAtEpochMillis: Long,
    val runtime: EffectiveRuntimeView,
    val platforms: Map<String, RedactedEffectivePlatformView>,
    val providers: Map<String, RedactedEffectiveProviderView>,
    val workspaces: Map<String, EffectiveWorkspaceStatusView>,
    val provenance: Map<String, FieldProvenance>,
    val diagnostics: List<ConfigurationDiagnostic>,
    val pendingRestart: List<PendingRestart>,
)

@Serializable
data class ConfigurationContentRequest(val content: String)

@Serializable
data class ConfigurationApplyRequest(
    val content: String,
    val expectedRevision: String? = null,
)
