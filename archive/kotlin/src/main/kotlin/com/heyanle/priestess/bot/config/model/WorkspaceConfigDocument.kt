package com.heyanle.priestess.bot.config.model

import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import kotlinx.serialization.Serializable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonNames

/** Versioned behavior configuration owned by one registered Workspace directory. */
@Serializable
data class WorkspaceConfigDocument(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val id: String,
    val name: String,
    val enabled: Boolean = true,
    val primaryAgentId: String,
    val agents: List<AgentDefinitionDocument>,
    val orchestration: OrchestrationDocument = OrchestrationDocument(),
    val toolPolicy: ToolPolicyDocument = ToolPolicyDocument(),
    val skills: List<SkillDefinitionDocument> = emptyList(),
    val mcpServers: List<McpServerDefinitionDocument> = emptyList(),
    val personas: List<PersonaDefinitionDocument> = emptyList(),
    val memory: MemoryPolicyDocument = MemoryPolicyDocument(),
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION = 2
    }
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class AgentDefinitionDocument(
    val id: String,
    val displayName: String = id,
    val enabled: Boolean = true,
    val instructions: String = "You are a helpful assistant.",
    /** Carried from the v3 projection so validation and compilation see the same Agent type. */
    @JsonNames("preset") val type: AgentType = AgentType.NORMAL,
    val providerRef: String,
    val model: String,
    val generation: GenerationSettingsDocument = GenerationSettingsDocument(),
    val context: ContextSettingsDocument = ContextSettingsDocument(),
    val execution: ExecutionSettingsDocument = ExecutionSettingsDocument(),
    val personaRef: String? = null,
    val toolPolicy: ToolPolicyDocument = ToolPolicyDocument(),
)

@Serializable
data class GenerationSettingsDocument(
    val temperature: Double = 0.7,
    val maxOutputTokens: Int? = null,
)

@Serializable
data class ContextSettingsDocument(
    val compression: CompressionSettingsDocument = CompressionSettingsDocument(),
    val toolResults: ToolResultSettingsDocument = ToolResultSettingsDocument(),
    val personaExampleTokens: Int = 512,
)

@Serializable
data class CompressionSettingsDocument(
    val strategy: String = "token_window",
    val maxRounds: Int = AgentRuntimeDefaults.MAX_ROUNDS,
    val maxTokens: Int = AgentRuntimeDefaults.MAX_CONTEXT_TOKENS,
)

@Serializable
data class ToolResultSettingsDocument(
    val inlineTokens: Int = 2048,
    val previewTokens: Int = 512,
    val ttlSeconds: Long = 1800,
    val maxBytes: Long = 4 * 1024 * 1024,
    val storeMaxBytes: Long = 64 * 1024 * 1024,
)

@Serializable
data class ExecutionSettingsDocument(
    val maxSteps: Int = AgentRuntimeDefaults.MAX_STEPS,
    val toolTimeoutMillis: Long = 30_000,
)

@Serializable
data class ToolPolicyDocument(
    val allow: List<String> = emptyList(),
    val deny: List<String> = emptyList(),
    val allowedRiskLevels: List<ToolRiskLevel> = ToolRiskLevel.entries,
    /** Platform switches are materialized once; Agent maps are sparse overrides (missing means true). */
    val enabled: Map<String, Boolean>? = null,
    /** Agent-only lower bound for callers of a named tool. Platform policy never changes caller roles. */
    val minimumPermissionGroups: Map<String, PermissionGroup> = emptyMap(),
)

@Serializable
data class OrchestrationDocument(
    val enabled: Boolean = false,
    val defaultAgentId: String? = null,
    val routes: List<AgentRouteDocument> = emptyList(),
)

@Serializable
data class AgentRouteDocument(
    val id: String,
    val targetAgentId: String,
    val keywords: List<String> = emptyList(),
    val priority: Int = 0,
    val enabled: Boolean = true,
)

@Serializable
data class SkillDefinitionDocument(
    val id: String,
    val enabled: Boolean = true,
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class McpServerDefinitionDocument(
    val id: String,
    val enabled: Boolean = true,
    val required: Boolean = true,
    val transport: String = "stdio",
    val command: String = "",
    val args: List<String> = emptyList(),
    val url: String = "",
    val credentialRefs: Map<String, CredentialReference> = emptyMap(),
    val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class PersonaDefinitionDocument(
    val id: String,
    val enabled: Boolean = true,
    val agentIds: List<String> = emptyList(),
)

@Serializable
data class MemoryPolicyDocument(
    val enabled: Boolean = true,
    val allowedScopes: List<String> = listOf("GLOBAL", "PLATFORM", "SESSION", "USER", "AGENT"),
    val knowledgeBaseIds: List<String> = emptyList(),
    val maxInjectedMemories: Int = 5,
)
