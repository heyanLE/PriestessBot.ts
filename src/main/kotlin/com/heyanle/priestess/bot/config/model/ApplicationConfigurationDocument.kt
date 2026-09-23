package com.heyanle.priestess.bot.config.model

import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.Serializable

/** The sole public configuration model: connections, independent Agents and shared resources. */
@Serializable
data class ApplicationConfigurationDocument(
    val schemaVersion: Int = 3,
    val runtime: RuntimeConfigDocument = RuntimeConfigDocument(),
    val platformDirectory: String = "data/platform",
    val ims: List<ImConnectionDocument> = emptyList(),
    val llms: List<ProviderConnectionDocument> = emptyList(),
    val agents: List<AgentProfileDocument> = emptyList(),
    val skillLibraries: List<SkillLibraryDocument> = emptyList(),
    val memoryLibraries: List<MemoryLibraryDocument> = emptyList(),
    val mcpServers: List<McpServerDefinitionDocument> = emptyList(),
    val toolPolicy: ToolPolicyDocument = ToolPolicyDocument(),
)

@Serializable
data class ImConnectionDocument(
    val id: String,
    val name: String = id,
    val type: String,
    val enabled: Boolean = true,
    val credentialRefs: Map<String, CredentialReference> = emptyMap(),
    val settings: Map<String, String> = emptyMap(),
    val permission: PermissionRuntimeDocument = PermissionRuntimeDocument(),
    val routes: List<ImRouteDocument> = emptyList(),
)

@Serializable
data class ImRouteDocument(
    val id: String,
    val name: String = id,
    val enabled: Boolean = true,
    val match: ImRouteMatchDocument = ImRouteMatchDocument(),
    val action: ImRouteActionDocument = ImRouteActionDocument(),
)

@Serializable
data class ImRouteMatchDocument(
    val sessionTypes: List<SessionType> = SessionType.entries,
    val attention: ImAttention = ImAttention.ANY,
    val attentionTarget: ImAttentionTarget = ImAttentionTarget.BOT,
    val stripMentions: Boolean = true,
    val textMode: ImTextMatchMode = ImTextMatchMode.GLOB,
    val textPattern: String = "*",
)

@Serializable enum class ImAttention { ANY, MENTION, REPLY, MENTION_OR_REPLY, NONE }
@Serializable enum class ImAttentionTarget { BOT, ANY }
@Serializable enum class ImTextMatchMode { GLOB, PREFIX, EXACT }
@Serializable enum class ImRouteActionType { AGENT, COMMAND }

@Serializable
data class ImRouteActionDocument(
    val type: ImRouteActionType = ImRouteActionType.AGENT,
    val agentId: String? = null,
    val commandPrefix: String = "#",
)

@Serializable
data class AgentProfileDocument(
    val id: String,
    val displayName: String = id,
    val enabled: Boolean = true,
    val instructions: String = "You are a helpful assistant.",
    /** How this Agent operates. Defaults to the simple chat preset; see [AgentPreset]. */
    val preset: AgentPreset = AgentPreset.NORMAL,
    val llm: AgentLlmDocument,
    val configDirectory: String = "agents/$id/config",
    val tempDirectory: String = "agents/$id/temp",
    val context: ContextSettingsDocument = ContextSettingsDocument(),
    val execution: ExecutionSettingsDocument = ExecutionSettingsDocument(),
    val skills: AgentSkillsDocument = AgentSkillsDocument(),
    val memory: AgentMemoryDocument = AgentMemoryDocument(),
    val personaId: String? = null,
    val mcpServerIds: List<String> = emptyList(),
    val toolPolicy: ToolPolicyDocument = ToolPolicyDocument(),
)

@Serializable
data class AgentLlmDocument(
    val providerRef: String,
    val model: String,
    val generation: GenerationSettingsDocument = GenerationSettingsDocument(),
)

@Serializable
data class AgentSkillsDocument(
    val platformLibraries: List<AgentSkillLibraryBinding> = emptyList(),
    val configuration: AgentLocalSkillDocument = AgentLocalSkillDocument(),
    val temporary: AgentLocalSkillDocument = AgentLocalSkillDocument(),
)

@Serializable
data class AgentSkillLibraryBinding(
    val libraryId: String,
    val enabled: Boolean = true,
    val permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
)

@Serializable
data class AgentLocalSkillDocument(
    val enabled: Boolean = true,
    val permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
)

@Serializable
data class AgentMemoryDocument(
    val libraryIds: List<String> = emptyList(),
    val writeLibraryId: String? = null,
    val maxInjected: Int = 5,
    val allowedScopes: List<String> = listOf("GLOBAL", "PLATFORM", "SESSION", "USER", "AGENT"),
)

@Serializable
data class SkillLibraryDocument(
    val id: String,
    val name: String = id,
    val directory: String = "skills/$id",
    val enabled: Boolean = true,
)

@Serializable
data class MemoryLibraryDocument(
    val id: String,
    val name: String = id,
    val description: String = "",
    val enabled: Boolean = true,
)
