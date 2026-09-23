package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.conversation.MessageRole
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.persona.PersonaMemoryInjectionContext
import com.heyanle.priestess.bot.persona.PersonaMemoryInjector
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillCase
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.pipeline.PermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionMessageContext
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 预处理阶段，负责准备 AgentContext 并在下游阶段完成后持久化对话历史。
 *
 * 该阶段采用洋葱模型：进入阶段时完成上下文准备，返回的 Flow 在执行、装饰和响应阶段之后保存历史。
 */
class PreProcessStage(
    private val pipelineConfig: PipelineConfig,
    private val conversationCase: ConversationCase,
    private val agentCase: AgentCase,
    private val personaMemoryInjector: PersonaMemoryInjector? = null,
    private val skillCase: SkillCase? = null,
    private val permissionDeniedMessageResolver: PermissionDeniedMessageResolver = PermissionDeniedMessageResolver.Default,
    private val agentSkillCatalog: com.heyanle.priestess.bot.resources.AgentSkillCatalog? = null,
) : Stage {
    private val logger = KotlinLogging.logger {}
    private val json = Json { encodeDefaults = true }

    override val name = "PreProcess"
    override val order = StageOrder.PRE_PROCESS

    override suspend fun process(ctx: PipelineContext): Flow<Unit> {
        if (ctx.isCommandHandled) return flow {}
        val session = ctx.event.session
        val platform = ctx.event.platform
        val prepared = prepareWorkspaceAgent(ctx)
        if (prepared == null) {
            logger.warn {
                "[PIPELINE-101] PreProcess missing prepared workspace for " +
                    "platform=${platform.metadata.name}, session=${session.id}; stopping pipeline"
            }
            ctx.stop()
            return flow {}
        }
        logger.info {
            "[PIPELINE-105] PreProcess using pinned workspace=${prepared.workspaceId}, " +
                "version=${prepared.workspaceVersion}, reason=${prepared.resolutionReason}"
        }

        val conversation = conversationCase.getOrCreate(
            platform = platform.metadata.name,
            sessionId = session.id,
            agentId = ctx.selectedAgentId.orEmpty(),
        )
        logger.info {
            "[PIPELINE-110] PreProcess conversation ready id=${conversation.id}, " +
                "platform=${platform.metadata.name}, session=${session.id}"
        }

        val baseAgent = prepared.agent
        val injection = personaMemoryInjector?.let { injector ->
            injector.inject(
                baseInstructions = baseAgent.instructions,
                context = PersonaMemoryInjectionContext(
                    workspaceId = if (ctx.agentProfile != null) "platform" else prepared.workspaceId,
                    agentName = baseAgent.name,
                    platformId = platform.metadata.name,
                    sessionId = session.id,
                    userId = ctx.senderId,
                    message = ctx.textContent,
                    maxMemories = prepared.maxInjectedMemories,
                    allowedPersonaIds = prepared.allowedPersonaIds,
                    selectedPersonaId = ctx.agentProfile?.personaId,
                    memoryLibraryIds = ctx.agentProfile?.let { profile ->
                        ctx.effectiveRuntimeSnapshot?.application?.memoryLibraries.orEmpty()
                            .filter { it.enabled && it.id in profile.memory.libraryIds }.mapTo(linkedSetOf()) { it.id }
                    },
                    allowedMemoryScopes = ctx.agentProfile?.memory?.allowedScopes?.mapTo(linkedSetOf()) {
                        com.heyanle.priestess.bot.memory.MemoryScope.valueOf(it)
                    },
                    exampleTokenBudget = ctx.agentProfile?.context?.personaExampleTokens ?: 512,
                ),
            )
        }
        val agent = if (injection != null && injection.hasContent) {
            baseAgent.copy(instructions = injection.instructions)
        } else {
            baseAgent
        }
        val injectionMetadata = injection?.metadata.orEmpty().withSnakeCaseInjectionAliases()
        injection?.persona?.let { ctx.shared["injectedPersonaId"] = it.id }
        injection?.memories?.takeIf { it.isNotEmpty() }?.let { memories ->
            ctx.shared["injectedMemoryIds"] = memories.map { it.record.id }
        }
        val messages = mutableListOf<ConversationMessage>()
        var historyCount = 0

        val maxHistoryMessages = ctx.effectiveRuntimeSnapshot
            ?.runtime
            ?.pipeline
            ?.maxHistoryMessages
            ?: pipelineConfig.maxHistoryMessages
        if (maxHistoryMessages > 0) {
            val storedMessages = conversationCase.getRecentMessages(
                conversationId = conversation.id,
                count = maxHistoryMessages,
            )
            historyCount = storedMessages.size
            for (msg in storedMessages) {
                when (msg.role) {
                    MessageRole.USER -> messages.add(ConversationMessage.user(msg.content ?: ""))
                    MessageRole.ASSISTANT -> messages.add(
                        ConversationMessage.assistant(
                            content = msg.content ?: "",
                            toolCalls = msg.toolCalls
                                ?.takeIf { it.isNotBlank() }
                                ?.let {
                                    runCatching {
                                        json.decodeFromString<List<com.heyanle.priestess.bot.provider.model.ToolCall>>(it)
                                    }.getOrNull()
                                },
                        ),
                    )
                    MessageRole.SYSTEM -> Unit
                    MessageRole.TOOL -> {
                        if (msg.toolCallId != null) {
                            messages.add(
                                ConversationMessage.tool(
                                    toolCallId = msg.toolCallId,
                                    name = msg.content ?: "unknown",
                                    content = msg.content ?: "",
                                ),
                            )
                        }
                    }
                }
            }
        }

        ctx.agentContext = AgentContext(
            agent = agent,
            conversationId = conversation.id,
            platform = platform,
            session = session,
            messages = messages,
            metadata = prepared.metadata + mapOf(
                "permissionDeniedMessage" to (injection?.persona?.errorMessages?.permissionDenied?.takeIf { it.isNotBlank() } ?: permissionDeniedMessageResolver.resolve(
                    PermissionMessageContext(prepared.workspaceId, agent.name),
                )),
            ) + injectionMetadata,
            scopedTools = prepared.scopedTools,
            skillState = prepared.skillState,
            permissionGroup = ctx.permissionGroup,
            executionTrace = ctx.executionTrace,
        )

        logger.info {
            "[PIPELINE-119] PreProcess injected agent=${agent.name}, model=${agent.model}, " +
                "selection=${prepared.selectionReason}, route=${prepared.routeId}, " +
                "workspace=${prepared.workspaceId}, history=$historyCount, " +
                "persona=${injection?.persona?.id ?: "none"}, examples=${injection?.exampleDialogs?.size ?: 0}, " +
                "memories=${injection?.memories?.size ?: 0}"
        }

        return flow {
            emit(Unit)

            try {
                conversationCase.storeMessage(
                    conversationId = conversation.id,
                    role = MessageRole.USER,
                    content = ctx.modelUserContent,
                )

                val response = ctx.agentResponse
                if (response is com.heyanle.priestess.bot.agent.AgentResponse.Final) {
                    val agentMessages = ctx.agentContext?.messages.orEmpty()
                    val currentUserIndex = agentMessages.indexOfLast {
                        it.role == "user" && it.content == ctx.modelUserContent
                    }
                    agentMessages
                        .drop((currentUserIndex + 1).coerceAtLeast(0))
                        .filter { message ->
                            message.role == "tool" ||
                                (message.role == "assistant" && !message.toolCalls.isNullOrEmpty())
                        }
                        .forEach { message ->
                            conversationCase.storeMessage(
                                conversationId = conversation.id,
                                role = if (message.role == "tool") MessageRole.TOOL else MessageRole.ASSISTANT,
                                content = message.content,
                                toolCalls = message.toolCalls?.let { json.encodeToString(it) },
                                toolCallId = message.toolCallId,
                            )
                        }
                    conversationCase.storeMessage(
                        conversationId = conversation.id,
                        role = MessageRole.ASSISTANT,
                        content = response.content,
                    )
                }

                conversationCase.updateActivity(conversation.id)
                logger.info {
                    "[PIPELINE-190] PreProcess persisted conversation id=${conversation.id}, " +
                        "response=${ctx.agentResponse?.let { it::class.simpleName }}"
                }
            } catch (e: Exception) {
                logger.error(e) { "[PIPELINE-990] Failed to persist conversation" }
            }
        }
    }

    private fun prepareWorkspaceAgent(ctx: PipelineContext): PreparedWorkspaceAgent? {
        return ctx.effectiveWorkspaceSnapshot?.let { prepareEffectiveWorkspaceAgent(ctx, it) }
    }

    private fun prepareEffectiveWorkspaceAgent(
        ctx: PipelineContext,
        snapshot: EffectiveWorkspaceSnapshot,
    ): PreparedWorkspaceAgent? {
        val orchestration = snapshot.config.orchestration
        val route = orchestration.routes
            .asSequence()
            .filter { orchestration.enabled && it.enabled }
            .filter { candidate -> candidate.keywords.any { ctx.textContent.contains(it, ignoreCase = true) } }
            .sortedWith(compareByDescending<com.heyanle.priestess.bot.config.model.AgentRouteDocument> { it.priority }.thenBy { it.id })
            .firstOrNull()
        val selectedAgentId = ctx.selectedAgentId ?: route?.targetAgentId
            ?: orchestration.defaultAgentId
            ?: snapshot.config.primaryAgentId
        val effectiveAgent = snapshot.agents[selectedAgentId]
            ?: snapshot.agents[snapshot.config.primaryAgentId]
            ?: return null
        val agent = agentCase.createAgent(effectiveAgent)
        val selectionReason = when {
            route != null -> "workspace_route"
            orchestration.defaultAgentId != null && selectedAgentId == orchestration.defaultAgentId -> "workspace_default_agent"
            else -> "primary_agent"
        }
        ctx.shared["subAgentSelectionAgent"] = selectedAgentId
        ctx.shared["subAgentSelectionRoute"] = route?.id
        ctx.shared["subAgentSelectionReason"] = selectionReason
        ctx.configurationTrace = checkNotNull(ctx.configurationTrace).copy(
            agentId = selectedAgentId,
            providerId = effectiveAgent.provider.id,
            model = effectiveAgent.definition.model,
            toolIds = effectiveAgent.toolIds.sorted(),
        )
        val personaIds = snapshot.config.personas
            .filter { it.enabled && (it.agentIds.isEmpty() || selectedAgentId in it.agentIds) }
            .mapTo(linkedSetOf()) { it.id }
        val memory = snapshot.config.memory
        return PreparedWorkspaceAgent(
            agent = agent,
            workspaceId = snapshot.config.id,
            workspaceVersion = snapshot.version.value,
            resolutionReason = ctx.effectiveWorkspaceResolutionReason.orEmpty(),
            selectionReason = selectionReason,
            routeId = route?.id,
            maxInjectedMemories = if (memory.enabled) memory.maxInjectedMemories else 0,
            allowedPersonaIds = personaIds,
            scopedTools = (snapshot.runtimeTools + ctx.event.platform.platformTools()).distinctBy { it.schema.name },
            skillState = if (ctx.agentProfile != null && agentSkillCatalog != null) {
                agentSkillCatalog.stateForAgent(checkNotNull(ctx.effectiveRuntimeSnapshot), selectedAgentId, ctx.permissionGroup)
            } else skillCase?.getEffectiveSkillState(snapshot, ctx.permissionGroup) ?: PipelineSkillState(),
            metadata = buildEffectiveAgentMetadata(ctx, snapshot, effectiveAgent.provider.id),
        )
    }

    private fun Map<String, String>.withSnakeCaseInjectionAliases(): Map<String, String> = this + buildMap {
        this@withSnakeCaseInjectionAliases["injectedPersonaId"]?.let { put("injected_persona_id", it) }
        this@withSnakeCaseInjectionAliases["injectedPersonaName"]?.let { put("injected_persona_name", it) }
        this@withSnakeCaseInjectionAliases["injectedMemoryIds"]?.let { put("injected_memory_ids", it) }
        this@withSnakeCaseInjectionAliases["injectedMemoryReasons"]?.let { put("injected_memory_reasons", it) }
        this@withSnakeCaseInjectionAliases["injectedMemoryCount"]?.let { put("injected_memory_count", it) }
    }

    private fun buildEffectiveAgentMetadata(
        ctx: PipelineContext,
        snapshot: EffectiveWorkspaceSnapshot,
        providerId: String,
    ): Map<String, String> {
        val trace = checkNotNull(ctx.configurationTrace)
        val memory = snapshot.config.memory
        val receivedFiles = ctx.event.chain.components.filterIsInstance<MessageComponent.File>()
        return ctx.event.session.metadata + mapOf(
            "effectiveConfigVersion" to trace.effectiveVersion.toString(),
            "desiredConfigRevision" to trace.desiredRevision,
            "workspaceId" to snapshot.config.id,
            "workspaceRootDir" to java.nio.file.Path.of(snapshot.sourcePath).parent?.toString().orEmpty(),
            "workspaceSnapshotVersion" to snapshot.version.value.toString(),
            "workspaceResolutionReason" to ctx.effectiveWorkspaceResolutionReason.orEmpty(),
            "workspaceSelectionRuleId" to ctx.effectiveWorkspaceRuleId.orEmpty(),
            "providerName" to providerId,
            "workspaceToolNames" to snapshot.availableToolIds.sorted().joinToString(","),
            "workspaceSkillNames" to snapshot.config.skills.filter { it.enabled }.joinToString(",") { it.id },
            "workspaceMcpServerIds" to snapshot.config.mcpServers.filter { it.enabled }.joinToString(",") { it.id },
            "workspaceMemoryEnabled" to memory.enabled.toString(),
            "workspaceMemoryAllowedScopes" to memory.allowedScopes.joinToString(","),
            "workspaceMemoryKnowledgeBaseIds" to memory.knowledgeBaseIds.joinToString(","),
            "workspaceMemoryMaxInjected" to memory.maxInjectedMemories.toString(),
            "permissionGroup" to ctx.permissionGroup.name,
        ) + buildMap {
            ctx.agentProfile?.let { profile ->
                val resolver = com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
                val sourcePath = com.heyanle.priestess.bot.config.source.ProcessConfigurationPath.current().path
                put("agentConfigDirectory", resolver.resolveDirectory(sourcePath, profile.configDirectory).toString())
                put("agentTempDirectory", resolver.resolveDirectory(sourcePath, profile.tempDirectory).toString())
                put("configurationSkillEnabled", profile.skills.configuration.enabled.toString())
                put("configurationSkillPermission", profile.skills.configuration.permissionGroup.name)
                put("temporarySkillEnabled", profile.skills.temporary.enabled.toString())
                put("temporarySkillPermission", profile.skills.temporary.permissionGroup.name)
                put("workspaceRootDir", resolver.resolveDirectory(sourcePath, profile.configDirectory).toString())
                put("memoryLibraryIds", ctx.effectiveRuntimeSnapshot?.application?.memoryLibraries.orEmpty()
                    .filter { it.enabled && it.id in profile.memory.libraryIds }.joinToString(",") { it.id })
                profile.memory.writeLibraryId?.let { put("memoryWriteLibraryId", it) }
                put("imId", ctx.event.platform.metadata.name)
            }
            ctx.event.messageId.takeIf { it.isNotBlank() }?.let { put("messageId", it) }
            if (receivedFiles.isNotEmpty()) {
                put(
                    "receivedFiles",
                    json.encodeToString(
                        receivedFiles.map { file -> mapOf("name" to file.name, "url" to file.url) },
                    ),
                )
            }
        }
    }

    private data class PreparedWorkspaceAgent(
        val agent: Agent,
        val workspaceId: String,
        val workspaceVersion: Long,
        val resolutionReason: String,
        val selectionReason: String,
        val routeId: String?,
        val maxInjectedMemories: Int,
        val allowedPersonaIds: Set<String>?,
        val scopedTools: List<FunctionTool>,
        val skillState: PipelineSkillState,
        val metadata: Map<String, String>,
    )
}
