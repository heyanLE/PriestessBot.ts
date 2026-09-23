package com.heyanle.priestess.bot.config.model

import kotlinx.serialization.Serializable

/**
 * Versioned, persisted application configuration.
 *
 * This document owns process-level infrastructure and connection definitions only.
 * Agent behavior is deliberately absent and belongs to [WorkspaceConfigDocument].
 */
@Serializable
data class AppConfigDocument(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val runtime: RuntimeConfigDocument = RuntimeConfigDocument(),
    val platforms: List<PlatformConnectionDocument> = emptyList(),
    val providers: List<ProviderConnectionDocument> = emptyList(),
    val workspaces: WorkspaceCatalogDocument = WorkspaceCatalogDocument(),
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION = 2
    }
}

@Serializable
data class RuntimeConfigDocument(
    val server: ServerRuntimeDocument = ServerRuntimeDocument(),
    val database: DatabaseRuntimeDocument = DatabaseRuntimeDocument(),
    val plugins: PluginRuntimeDocument = PluginRuntimeDocument(),
    val reload: ReloadRuntimeDocument = ReloadRuntimeDocument(),
    val pipeline: PipelineRuntimeDocument = PipelineRuntimeDocument(),
    val command: CommandRuntimeDocument = CommandRuntimeDocument(),
    val permission: PermissionRuntimeDocument = PermissionRuntimeDocument(),
)

@Serializable
data class ServerRuntimeDocument(
    val enabled: Boolean = false,
    val host: String = "0.0.0.0",
    val port: Int = 8080,
    val corsEnabled: Boolean = true,
    val apiCredentialRef: CredentialReference? = null,
)

@Serializable
data class DatabaseRuntimeDocument(
    val path: String = "data/priestess.db",
)

@Serializable
data class PluginRuntimeDocument(
    val enabled: Boolean = true,
    val directory: String = "plugins",
    val autoDiscover: Boolean = true,
)

@Serializable
data class ReloadRuntimeDocument(
    val enabled: Boolean = false,
    val intervalMillis: Long = 2_000,
    val stabilityWindowMillis: Long = 500,
)

@Serializable
data class PipelineRuntimeDocument(
    val wakingPrefix: String = "/",
    val whitelistEnabled: Boolean = false,
    val whitelistUsers: List<String> = emptyList(),
    val whitelistGroups: List<String> = emptyList(),
    val rateLimitEnabled: Boolean = true,
    val rateLimitPerMinute: Int = 20,
    val maxHistoryMessages: Int = 50,
)

@Serializable
data class CommandRuntimeDocument(
    val prefix: String = "/",
)

@Serializable
data class PermissionRuntimeDocument(
    val superAdminIds: List<String> = emptyList(),
    val adminIds: List<String> = emptyList(),
)

@Serializable
data class PlatformConnectionDocument(
    val id: String,
    val type: String,
    val enabled: Boolean = true,
    val defaultWorkspaceId: String? = null,
    val credentialRefs: Map<String, CredentialReference> = emptyMap(),
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class ProviderConnectionDocument(
    val id: String,
    val type: String,
    val enabled: Boolean = true,
    val endpoint: String = "",
    val credentialRef: CredentialReference? = null,
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class CredentialReference(
    val source: CredentialSource = CredentialSource.ENVIRONMENT,
    val key: String,
)

@Serializable
enum class CredentialSource {
    ENVIRONMENT,
}

@Serializable
data class WorkspaceCatalogDocument(
    val defaultWorkspaceId: String = "default",
    val entries: List<WorkspaceCatalogEntryDocument> = emptyList(),
)

@Serializable
data class WorkspaceCatalogEntryDocument(
    val id: String,
    val directory: String,
    val enabled: Boolean = true,
    val selectionRules: List<WorkspaceSelectionRuleDocument> = emptyList(),
)

@Serializable
data class WorkspaceSelectionRuleDocument(
    val id: String,
    val priority: Int = 0,
    val platformIds: List<String> = emptyList(),
    val sessionIds: List<String> = emptyList(),
    val userIds: List<String> = emptyList(),
    val groupIds: List<String> = emptyList(),
)
