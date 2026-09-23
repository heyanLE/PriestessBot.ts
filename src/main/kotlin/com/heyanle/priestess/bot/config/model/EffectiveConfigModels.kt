package com.heyanle.priestess.bot.config.model

import kotlinx.serialization.Serializable

/** Persisted authoring state. Resolved environment values have no field in this type. */
data class RawConfigState(
    val document: AppConfigDocument,
    val sourcePath: String,
    val revision: RawConfigRevision,
    val workspaces: Map<String, RawWorkspaceConfigState> = emptyMap(),
    val application: ApplicationConfigurationDocument? = null,
)

data class RawWorkspaceConfigState(
    val document: WorkspaceConfigDocument,
    val sourcePath: String,
    val revision: RawConfigRevision,
    val fingerprint: SourceFingerprint,
    val configurationDirectory: String? = null,
)

/** Validated desired state after typed deployment overrides, before activation planning. */
data class DesiredConfig(
    val document: AppConfigDocument,
    val rawRevision: RawConfigRevision,
    val sourceFingerprint: SourceFingerprint,
    val runtime: EffectiveRuntimeView,
    val serverApiCredential: GuardedSecret? = null,
    val platforms: Map<String, EffectivePlatformConnection>,
    val providers: Map<String, EffectiveProviderConnection>,
    val workspaces: Map<String, EffectiveWorkspaceSnapshot>,
    val provenance: Map<String, FieldProvenance>,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
    val application: ApplicationConfigurationDocument? = null,
)

data class EffectiveRuntimeSnapshot(
    val version: EffectiveConfigVersion,
    val desiredRevision: RawConfigRevision,
    val sourceFingerprint: SourceFingerprint,
    val loadedAtEpochMillis: Long,
    val runtime: EffectiveRuntimeView,
    val serverApiCredential: GuardedSecret? = null,
    val platforms: Map<String, EffectivePlatformConnection>,
    val providers: Map<String, EffectiveProviderConnection>,
    /** Catalog is pinned with the snapshot so message routing never rereads authoring files. */
    val workspaceCatalog: WorkspaceCatalogDocument,
    val workspaces: Map<String, EffectiveWorkspaceSnapshot>,
    val provenance: Map<String, FieldProvenance>,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
    val pendingRestart: List<PendingRestart> = emptyList(),
    val application: ApplicationConfigurationDocument? = null,
)

@Serializable
data class EffectiveRuntimeView(
    val server: ServerRuntimeDocument,
    val database: DatabaseRuntimeDocument,
    val plugins: PluginRuntimeDocument,
    val reload: ReloadRuntimeDocument,
    val pipeline: PipelineRuntimeDocument,
    val command: CommandRuntimeDocument,
    val permission: PermissionRuntimeDocument,
)

data class EffectivePlatformConnection(
    val id: String,
    val type: String,
    val enabled: Boolean,
    val defaultWorkspaceId: String?,
    val credentials: Map<String, GuardedSecret>,
    val settings: Map<String, String>,
)

data class EffectiveProviderConnection(
    val id: String,
    val type: String,
    val enabled: Boolean,
    val endpoint: String,
    val credential: GuardedSecret?,
    val credentialReference: CredentialReference?,
    val settings: Map<String, String>,
)

data class EffectiveWorkspaceSnapshot(
    val version: EffectiveConfigVersion,
    val fingerprint: SourceFingerprint,
    val sourcePath: String,
    val config: WorkspaceConfigDocument,
    val agents: Map<String, EffectiveAgent>,
    val availableToolIds: Set<String>,
    val runtimeTools: List<com.heyanle.priestess.bot.tool.FunctionTool> = emptyList(),
    val resourceHandles: List<AutoCloseable> = emptyList(),
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
    val configurationDirectory: String? = null,
)

data class EffectiveAgent(
    val definition: AgentDefinitionDocument,
    val provider: EffectiveProviderConnection,
    val toolIds: Set<String>,
)

/**
 * Runtime-only secret. It intentionally has no kotlinx-serialization annotation.
 * API models must opt into [redacted] rather than serializing runtime config directly.
 */
class GuardedSecret private constructor(
    private val secretValue: String,
) {
    internal fun reveal(): String = secretValue

    fun redacted(): String = REDACTED_VALUE

    override fun toString(): String = REDACTED_VALUE

    override fun equals(other: Any?): Boolean = other is GuardedSecret && secretValue == other.secretValue

    override fun hashCode(): Int = secretValue.hashCode()

    companion object {
        const val REDACTED_VALUE = "***"

        fun of(value: String): GuardedSecret = GuardedSecret(value)
    }
}

/** Explicit API-safe projection for provider state. */
@Serializable
data class RedactedEffectiveProviderView(
    val id: String,
    val type: String,
    val enabled: Boolean,
    val endpoint: String,
    val credential: String? = null,
    val credentialSource: CredentialReference? = null,
    val settings: Map<String, String> = emptyMap(),
)

fun EffectiveProviderConnection.redacted(): RedactedEffectiveProviderView {
    return RedactedEffectiveProviderView(
        id = id,
        type = type,
        enabled = enabled,
        endpoint = endpoint,
        credential = credential?.redacted(),
        credentialSource = credentialReference,
        settings = settings,
    )
}
