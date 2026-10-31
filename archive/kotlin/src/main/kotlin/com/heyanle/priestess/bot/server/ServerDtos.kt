package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.knowledge.KnowledgeBase
import com.heyanle.priestess.bot.knowledge.KnowledgeChunk
import com.heyanle.priestess.bot.memory.MemoryRecord
import com.heyanle.priestess.bot.memory.MemoryScope
import com.heyanle.priestess.bot.memory.MemorySearchResult
import com.heyanle.priestess.bot.memory.MemoryType
import com.heyanle.priestess.bot.persona.Persona
import com.heyanle.priestess.bot.plugin.PluginDescriptor
import com.heyanle.priestess.bot.plugin.PluginExtensionMetadata
import com.heyanle.priestess.bot.provider.LLMKind
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSource
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.workspace.WorkspaceMemoryPolicyConfig
import com.heyanle.priestess.bot.workspace.WorkspaceReloadPlan
import com.heyanle.priestess.bot.workspace.WorkspaceReloadResult
import kotlinx.serialization.Serializable

/**
 * 健康检查响应，描述整体状态、组件状态和诊断信息。
 */
@Serializable
data class HealthResponse(
    val status: String,
    val components: Map<String, String>,
    val timestamp: Long = System.currentTimeMillis(),
    val uptimeMillis: Long = 0,
    val diagnostics: Map<String, String> = emptyMap(),
)

/**
 * 平台状态 DTO，供仪表盘展示平台配置和运行状态。
 */
@Serializable
data class PlatformStatusDto(
    val name: String,
    val type: String,
    val enabled: Boolean,
    val running: Boolean,
    val host: String,
    val port: Int,
    val wsPort: Int,
)

@Serializable
data class WeixinQrLoginDto(
    val sessionId: String,
    val platformId: String,
    val status: String,
    val qrImageDataUrl: String? = null,
    val qrRevision: Int = 1,
    val expiresAtEpochMillis: Long,
    val pollAfterMillis: Long = 1_000,
    val message: String = "",
    val accountId: String? = null,
    val platformRunning: Boolean = false,
)

/**
 * 模型提供者 DTO，供仪表盘展示提供者能力。
 */
@Serializable
data class ProviderDto(
    val name: String,
    val displayName: String,
    val kind: LLMKind,
    val supportToolCalling: Boolean,
    val supportVision: Boolean,
    val supportStreaming: Boolean,
)

/**
 * 工具 DTO，供仪表盘展示工具参数、来源和启用状态。
 */
@Serializable
data class ToolDto(
    val name: String,
    val description: String,
    val parameters: ToolParameters,
    val source: ToolSource = ToolSource.BUILTIN,
    val owner: String? = null,
    val riskLevel: ToolRiskLevel = ToolRiskLevel.SAFE_READ,
    val requiredCapabilities: List<String> = emptyList(),
    val defaultEnabled: Boolean = true,
    val effectiveEnabled: Boolean = true,
    val auditLog: Boolean = false,
    val requiredPermissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    val statusReason: String? = null,
)

/**
 * 会话 DTO，供仪表盘展示平台会话摘要。
 */
@Serializable
data class ConversationDto(
    val id: String,
    val platform: String,
    val sessionId: String,
    val createdAt: Long,
    val updatedAt: Long,
)

/**
 * 消息 DTO，供仪表盘展示历史消息和工具调用元数据。
 */
@Serializable
data class MessageDto(
    val id: String,
    val conversationId: String,
    val role: String,
    val content: String?,
    val toolCalls: String?,
    val toolCallId: String?,
    val createdAt: Long,
)

/**
 * 插件列表响应，包含插件描述和扩展元数据。
 */
@Serializable
data class PluginListResponse(
    val plugins: List<PluginDescriptor>,
    val extensions: List<PluginExtensionMetadata>,
)

/**
 * 日志事件 DTO，供仪表盘实时日志流使用。
 */
@Serializable
data class LogEventDto(
    val level: String,
    val message: String,
    val timestamp: Long = System.currentTimeMillis(),
)

/**
 * 仪表盘智能体聊天请求。
 */
@Serializable
data class AgentChatRequest(
    val message: String,
    val conversationId: String? = null,
    val workspaceId: String = "default",
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val agentId: String? = null,
)

/**
 * 仪表盘智能体聊天过程事件。
 */
@Serializable
data class AgentChatEventDto(
    val type: String,
    val message: String,
    val toolName: String? = null,
    val success: Boolean? = null,
    val errorCode: String? = null,
    val policyDenialCode: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
)

/**
 * 仪表盘智能体聊天响应。
 */
@Serializable
data class AgentChatResponse(
    val status: String,
    val content: String,
    val events: List<AgentChatEventDto>,
    val providerName: String,
    val model: String,
    val conversationId: String,
    val injectionTrace: AgentChatInjectionTraceDto = AgentChatInjectionTraceDto(),
    val selectedAgentName: String? = null,
    val selectedRouteName: String? = null,
    val selectionReason: String? = null,
    val runtimeVersion: Long? = null,
    val workspaceVersion: Long? = null,
    val toolIds: List<String> = emptyList(),
)

/**
 * 人设和记忆注入追踪 DTO。
 */
@Serializable
data class AgentChatInjectionTraceDto(
    val workspaceId: String = "default",
    val personaId: String? = null,
    val personaName: String? = null,
    val memoryCount: Int = 0,
    val memories: List<AgentChatInjectedMemoryDto> = emptyList(),
    val metadata: Map<String, String> = emptyMap(),
)

/**
 * 已注入记忆 DTO，供前端展示注入来源。
 */
@Serializable
data class AgentChatInjectedMemoryDto(
    val id: String,
    val type: MemoryType,
    val score: Double,
    val matchReason: String,
    val contentPreview: String,
)

/**
 * 创建知识库请求。
 */
@Serializable
data class CreateKnowledgeBaseRequest(
    val name: String,
    val description: String = "",
)

/**
 * 添加知识文档请求。
 */
@Serializable
data class AddKnowledgeDocumentRequest(
    val documentName: String,
    val content: String,
)

/**
 * 知识检索请求。
 */
@Serializable
data class KnowledgeSearchRequest(
    val query: String,
    val knowledgeBaseId: String? = null,
    val limit: Int = 5,
)

/**
 * 知识检索结果 DTO。
 */
@Serializable
data class KnowledgeSearchResultDto(
    val chunk: KnowledgeChunk,
    val score: Double,
)

/**
 * 知识库列表响应。
 */
@Serializable
data class KnowledgeBaseListResponse(
    val bases: List<KnowledgeBase>,
)

/**
 * 子智能体测试请求。
 */
@Serializable
data class SubAgentTestRequest(
    val message: String,
    val conversationId: String? = null,
    val workspaceId: String = "default",
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
)

/**
 * 子智能体测试响应。
 */
@Serializable
data class SubAgentTestResponse(
    val status: String,
    val content: String,
    val selectedAgentName: String,
    val selectedRouteName: String? = null,
    val selectionReason: String,
    val events: List<AgentChatEventDto>,
    val conversationId: String,
    val providerName: String? = null,
    val model: String? = null,
    val runtimeVersion: Long? = null,
    val workspaceVersion: Long? = null,
    val toolIds: List<String> = emptyList(),
)

/**
 * 工作区列表响应。
 */
@Serializable
data class WorkspaceListResponse(
    val workspaces: List<WorkspaceStatusDto>,
)

/**
 * 工作区状态 DTO。
 */
@Serializable
data class WorkspaceStatusDto(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val activeSnapshotVersion: Long? = null,
    val loadedAt: Long? = null,
    val lastReload: WorkspaceReloadResult? = null,
    val diagnostics: List<String> = emptyList(),
)

/**
 * 工作区详情 DTO。
 */
@Serializable
data class WorkspaceDetailDto(
    val status: WorkspaceStatusDto,
    val providerName: String,
    val agents: List<String>,
    val tools: List<String>,
    val skills: List<String>,
    val skillSettings: Map<String, Map<String, String>> = emptyMap(),
    val mcpServers: List<String>,
    val mcpServerDetails: List<WorkspaceMcpServerSummaryDto> = emptyList(),
    val personas: List<String>,
    val memory: WorkspaceMemoryPolicyConfig,
    val reloadPlan: WorkspaceReloadPlan? = null,
)

/**
 * 工作区 MCP 服务摘要 DTO。
 */
@Serializable
data class WorkspaceMcpServerSummaryDto(
    val id: String,
    val transport: String,
    val command: String = "",
    val args: List<String> = emptyList(),
    val url: String = "",
)

/**
 * 工作区资源列表响应。
 */
@Serializable
data class WorkspaceResourceListResponse(
    val workspaceId: String,
    val resources: List<String>,
)

/**
 * 人设列表响应。
 */
@Serializable
data class PersonaListResponse(
    val personas: List<Persona>,
)

/**
 * 人设创建或更新 DTO。
 */
@Serializable
data class PersonaUpsertDto(
    val id: String? = null,
    val workspaceId: String = "default",
    val name: String,
    val description: String = "",
    val tone: String = "",
    val boundaries: List<String> = emptyList(),
    val systemPromptTemplate: String = "",
    val exampleDialogs: List<com.heyanle.priestess.bot.persona.PersonaExampleDialog> = emptyList(),
    val enabled: Boolean = true,
    val agentNames: List<String> = emptyList(),
    val errorMessages: com.heyanle.priestess.bot.persona.PersonaErrorMessages = com.heyanle.priestess.bot.persona.PersonaErrorMessages(),
)

/**
 * 人设解析请求。
 */
@Serializable
data class PersonaResolveRequest(
    val workspaceId: String = "default",
    val agentName: String,
)

/**
 * 人设解析响应。
 */
@Serializable
data class PersonaResolveResponse(
    val persona: Persona?,
)

/**
 * 记忆列表响应。
 */
@Serializable
data class MemoryListResponse(
    val memories: List<MemoryRecord>,
)

/**
 * 记忆保存请求。
 */
@Serializable
data class MemorySaveRequest(
    val content: String,
    val type: MemoryType = MemoryType.FACT,
    val scope: MemoryScope = MemoryScope.GLOBAL,
    val workspaceId: String = "default",
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val agentName: String? = null,
    val tags: List<String> = emptyList(),
    val confidence: Double = 1.0,
    val expiresAt: Long? = null,
)

/**
 * 记忆检索请求。
 */
@Serializable
data class MemorySearchRequest(
    val query: String,
    val workspaceId: String = "default",
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val agentName: String? = null,
    val scope: MemoryScope? = null,
    val type: MemoryType? = null,
    val limit: Int = 10,
)

/**
 * 记忆检索响应。
 */
@Serializable
data class MemorySearchResponse(
    val results: List<MemorySearchResult>,
)

/**
 * 删除操作响应。
 */
@Serializable
data class DeleteResponse(
    val deleted: Boolean,
)

/**
 * 过期记忆清理响应。
 */
@Serializable
data class ExpireMemoryResponse(
    val expired: Int,
)

// ─── Working Directory ───

/**
 * 工作目录 Agent DTO。
 */
@Serializable
data class WorkingDirectoryAgentDto(
    val name: String,
    val filePath: String,
)

/**
 * 工作目录技能 DTO。
 */
@Serializable
data class WorkingDirectorySkillDto(
    val name: String,
    val directoryPath: String,
    val markdownPath: String,
    val metadataPath: String? = null,
    val enabled: Boolean = true,
    val settings: Map<String, String> = emptyMap(),
)

/**
 * 工作目录摘要响应。
 */
@Serializable
data class WorkingDirectorySummaryResponse(
    val configuredPath: String,
    val effectivePath: String,
    val pathSource: String = "config",
    val valid: Boolean,
    val exists: Boolean,
    val manifestPath: String? = null,
    val manifestFound: Boolean = false,
    val agents: List<WorkingDirectoryAgentDto> = emptyList(),
    val skills: List<WorkingDirectorySkillDto> = emptyList(),
    val diagnostics: List<String> = emptyList(),
    val unsupportedFields: List<String> = emptyList(),
    val lastLoadedAt: Long = 0,
)
