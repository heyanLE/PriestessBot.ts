package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.tool.FunctionTool
import kotlinx.serialization.Serializable

@Serializable
data class WorkspaceMcpServerConfig(
    val id: String,
    val enabled: Boolean = true,
    val transport: String = "stdio",
    val command: String = "",
    val args: List<String> = emptyList(),
    val url: String = "",
    val env: Map<String, String> = emptyMap(),
)

@Serializable
data class WorkspaceMemoryPolicyConfig(
    val enabled: Boolean = true,
    val allowedScopes: List<String> = listOf("GLOBAL", "PLATFORM", "SESSION", "USER", "AGENT"),
    val knowledgeBaseIds: List<String> = emptyList(),
    val maxInjectedMemories: Int = 5,
)

data class WorkspaceSnapshot(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val version: Long,
    val loadedAt: Long,
    val rootDir: String,
    val agentIds: List<String>,
    val providerName: String,
    val toolNames: List<String>,
    val skillDescriptors: List<WorkspaceSkillDescriptor>,
    val skillSettings: Map<String, Map<String, String>>,
    val mcpServers: List<WorkspaceMcpServerDeclaration>,
    val personaIds: List<String>,
    val memoryPolicy: WorkspaceMemoryPolicyConfig,
    val diagnostics: List<String> = emptyList(),
) {
    val skillNames: List<String> get() = skillDescriptors.map { it.name }
    val mcpServerIds: List<String> get() = mcpServers.map { it.id }
}

data class WorkspaceSkillDescriptor(
    val name: String,
    val description: String = "",
    val enabled: Boolean = true,
    val directoryPath: String,
    val skillMarkdownPath: String,
    val inlineMarkdown: String? = null,
    val settings: Map<String, String> = emptyMap(),
    val requiredPermissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
)

@Serializable
data class WorkspaceMcpServerDeclaration(
    val id: String,
    val enabled: Boolean = true,
    val transport: String = "stdio",
    val command: String = "",
    val args: List<String> = emptyList(),
    val url: String = "",
    val sourcePath: String = "",
)

data class WorkspaceMcpToolResolution(
    val resources: List<WorkspaceMcpResource> = emptyList(),
    val handles: List<WorkspaceMcpClientHandle> = emptyList(),
    val diagnostics: List<String> = emptyList(),
) {
    val toolNames: List<String> get() = resources.map { it.tool.schema.name }
}

data class WorkspaceMcpResource(val tool: FunctionTool, val handle: WorkspaceMcpClientHandle)

fun interface WorkspaceMcpClientHandle { fun close() }

fun interface WorkspaceMcpToolResolver {
    fun resolve(workspaceId: String, servers: List<WorkspaceMcpServerConfig>): WorkspaceMcpToolResolution
}

class WorkspaceMcpResolutionException(
    message: String,
    val handles: List<WorkspaceMcpClientHandle> = emptyList(),
    cause: Throwable? = null,
) : RuntimeException(message, cause)

@Serializable
data class WorkspaceStatus(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val activeSnapshotVersion: Long? = null,
    val loadedAt: Long? = null,
    val lastReload: WorkspaceReloadResult? = null,
    val diagnostics: List<String> = emptyList(),
)

@Serializable
data class WorkspaceReloadPlan(
    val workspaceId: String,
    val oldVersion: Long? = null,
    val newVersion: Long,
    val added: List<String> = emptyList(),
    val removed: List<String> = emptyList(),
    val modified: List<String> = emptyList(),
)

@Serializable
data class WorkspaceReloadResult(
    val workspaceId: String,
    val success: Boolean,
    val status: String,
    val snapshotVersion: Long? = null,
    val timestamp: Long,
    val plan: WorkspaceReloadPlan? = null,
    val diagnostics: List<String> = emptyList(),
    val errorSummary: String? = null,
)
