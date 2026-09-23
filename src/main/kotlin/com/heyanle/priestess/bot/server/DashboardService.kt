package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.knowledge.KnowledgeCase
import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryFilter
import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.memory.MemorySearchQuery
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.persona.PersonaCase
import com.heyanle.priestess.bot.persona.PersonaUpsertRequest
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.plugin.PluginCase
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.PlatformCase
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinQrLoginService
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinQrLoginView
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolListingFilters
import com.heyanle.priestess.bot.workspace.WorkspaceCase
import com.heyanle.priestess.bot.workspace.WorkspaceMemoryPolicyConfig
import com.heyanle.priestess.bot.workspace.WorkspaceSnapshot
import com.heyanle.priestess.bot.workspace.WorkspaceStatus
import java.util.UUID
import kotlinx.coroutines.Job

/**
 * 仪表盘应用服务，负责把 HTTP 路由请求转换为各业务模块的门面调用。
 */
class DashboardService(
    private val platformCase: PlatformCase,
    private val providerCase: ProviderCase,
    private val toolCase: ToolCase,
    private val conversationCase: ConversationCase,
    private val pluginCase: PluginCase,
    private val agentCase: AgentCase,
    private val knowledgeCase: KnowledgeCase,
    private val observabilityCase: ObservabilityCase,
    private val healthProvider: RuntimeHealthProvider,
    private val workspaceCase: WorkspaceCase,
    private val personaCase: PersonaCase? = null,
    private val memoryCase: MemoryCase? = null,
    private val configurationManagement: ConfigurationManagementService? = null,
    private val pipelineCase: PipelineCase,
    private val weixinQrLoginService: WeixinQrLoginService? = null,
    val applicationManagement: ApplicationManagementService? = null,
    val agentSkillCatalog: com.heyanle.priestess.bot.resources.AgentSkillCatalog? = null,
    val executionTraces: com.heyanle.priestess.bot.observability.trace.ExecutionTraceController? = null,
) {
    fun health(): HealthResponse = healthProvider.snapshot()

    fun metrics(): String = observabilityCase.renderPrometheus()

    fun rawV2Configuration(): RawGlobalConfigurationResponse = requireConfigurationManagement().raw()

    fun rawV2Workspace(id: String): RawWorkspaceConfigurationResponse = requireConfigurationManagement().rawWorkspace(id)

    fun effectiveV2Configuration(): EffectiveConfigurationResponse? = requireConfigurationManagement().effective()

    fun previewV2Configuration(request: ConfigurationContentRequest) = requireConfigurationManagement().preview(request)

    fun previewV2Workspace(id: String, request: ConfigurationContentRequest) =
        requireConfigurationManagement().previewWorkspace(id, request)

    fun applyV2Configuration(request: ConfigurationApplyRequest) = requireConfigurationManagement().apply(request)

    fun applyV2Workspace(id: String, request: ConfigurationApplyRequest) =
        requireConfigurationManagement().applyWorkspace(id, request)

    fun reloadV2Configuration() = requireConfigurationManagement().reload()
    fun configBackups() = requireConfigurationManagement().backups()
    fun restoreConfigBackup(id: String) = requireConfigurationManagement().restoreBackup(id)

    private fun requireConfigurationManagement(): ConfigurationManagementService = checkNotNull(configurationManagement) {
        "The v2 configuration runtime is not installed"
    }

    fun workingDirectorySummary(): WorkingDirectorySummaryResponse {
        val defaultId = rawV2Configuration().document?.workspaces?.defaultWorkspaceId
            ?: throw IllegalStateException("Global Workspace catalog is unavailable")
        val configuredPath = workspaceCase.get(defaultId)?.rootDir.orEmpty()
        val effectivePath = configuredPath.ifBlank { "." }
        val dir = java.io.File(effectivePath)
        val exists = dir.exists() && dir.isDirectory

        val agents = mutableListOf<WorkingDirectoryAgentDto>()
        val skills = mutableListOf<WorkingDirectorySkillDto>()
        val diagnostics = mutableListOf<String>()

        if (exists) {
            val agentsDir = java.io.File(dir, "agents")
            if (agentsDir.exists() && agentsDir.isDirectory) {
                agentsDir.listFiles()?.filter { it.isFile && it.extension == "md" }?.forEach { file ->
                    agents.add(WorkingDirectoryAgentDto(name = file.nameWithoutExtension, filePath = file.absolutePath))
                }
            }

            val skillsDir = java.io.File(dir, "skills")
            if (skillsDir.exists() && skillsDir.isDirectory) {
                skillsDir.listFiles()?.filter { it.isDirectory }?.forEach { skillDir ->
                    val markdownFile = java.io.File(skillDir, "skill.md")
                    val metadataFile = java.io.File(skillDir, "metadata.json")
                    skills.add(
                        WorkingDirectorySkillDto(
                            name = skillDir.name,
                            directoryPath = skillDir.absolutePath,
                            markdownPath = markdownFile.absolutePath,
                            metadataPath = metadataFile.takeIf { it.exists() }?.absolutePath,
                            enabled = true,
                        ),
                    )
                }
            }
        } else {
            diagnostics.add("Working directory does not exist: $effectivePath")
        }

        return WorkingDirectorySummaryResponse(
            configuredPath = configuredPath,
            effectivePath = effectivePath,
            valid = configuredPath.isNotBlank() && exists,
            exists = exists,
            agents = agents,
            skills = skills,
            diagnostics = diagnostics,
            lastLoadedAt = System.currentTimeMillis(),
        )
    }

    fun platforms(): List<PlatformStatusDto> {
        val running = platformCase.runningPlatformNames()
        return requireNotNull(effectiveV2Configuration()).platforms.values.map { cfg ->
            PlatformStatusDto(
                name = cfg.id,
                type = cfg.type,
                enabled = cfg.enabled,
                running = cfg.id in running || cfg.type in running,
                host = cfg.settings["host"].orEmpty(),
                port = cfg.settings["port"]?.toIntOrNull() ?: 0,
                wsPort = cfg.settings["wsPort"]?.toIntOrNull() ?: 0,
            )
        }
    }

    suspend fun startWeixinQrLogin(platformId: String): WeixinQrLoginDto =
        requireWeixinQrLoginService().start(platformId).toDto()

    fun weixinQrLoginStatus(platformId: String, sessionId: String): WeixinQrLoginDto =
        requireWeixinQrLoginService().status(platformId, sessionId).toDto()

    suspend fun cancelWeixinQrLogin(platformId: String, sessionId: String): WeixinQrLoginDto =
        requireWeixinQrLoginService().cancel(platformId, sessionId).toDto()

    private fun requireWeixinQrLoginService(): WeixinQrLoginService = checkNotNull(weixinQrLoginService) {
        "Weixin QR login service is not installed"
    }

    private fun WeixinQrLoginView.toDto() = WeixinQrLoginDto(
        sessionId = sessionId,
        platformId = platformId,
        status = status.name,
        qrImageDataUrl = qrImageDataUrl,
        qrRevision = qrRevision,
        expiresAtEpochMillis = expiresAtEpochMillis,
        pollAfterMillis = pollAfterMillis,
        message = message,
        accountId = accountId,
        platformRunning = platformRunning,
    )

    fun providers(): List<ProviderDto> {
        return providerCase.getMetaList().map { meta ->
            ProviderDto(
                name = meta.name,
                displayName = meta.displayName,
                kind = meta.kind,
                supportToolCalling = meta.supportToolCalling,
                supportVision = meta.supportVision,
                supportStreaming = meta.supportStreaming,
            )
        }
    }

    suspend fun testProviders(): Map<String, Boolean> = providerCase.testAll()

    fun tools(): List<ToolDto> {
        return toolCase.list(ToolListingFilters(includeHighRisk = true)).map { listing ->
            val tool = toolCase.get(listing.name) ?: error("Tool '${listing.name}' missing after listing")
            ToolDto(
                name = listing.name,
                description = listing.description,
                parameters = tool.schema.parameters,
                source = listing.source,
                owner = listing.owner,
                riskLevel = listing.riskLevel,
                requiredCapabilities = listing.requiredCapabilities,
                defaultEnabled = listing.defaultEnabled,
                effectiveEnabled = listing.effectiveEnabled,
                auditLog = listing.auditLog,
                requiredPermissionGroup = tool.schema.requiredPermissionGroup,
                statusReason = listing.statusReason,
            )
        }
    }

    fun workspaces(): WorkspaceListResponse {
        return WorkspaceListResponse(workspaceCase.list().map { it.toDto() })
    }

    fun workspaceDetail(id: String): WorkspaceDetailDto {
        val snapshot = workspaceCase.get(id) ?: throw NoSuchElementException("Workspace '$id' not found")
        val status = workspaceCase.list().firstOrNull { it.id == id }
            ?: WorkspaceStatus(
                id = snapshot.id,
                name = snapshot.name,
                enabled = snapshot.enabled,
                activeSnapshotVersion = snapshot.version,
                loadedAt = snapshot.loadedAt,
                diagnostics = snapshot.diagnostics,
            )
        return snapshot.toDetailDto(status)
    }

    fun reloadWorkspace(id: String): com.heyanle.priestess.bot.workspace.WorkspaceReloadResult {
        return workspaceCase.reload(id)
    }

    fun reloadWorkspaces(): List<com.heyanle.priestess.bot.workspace.WorkspaceReloadResult> {
        return workspaceCase.reloadAll()
    }

    fun workspaceTools(id: String): WorkspaceResourceListResponse {
        val snapshot = requireWorkspaceSnapshot(id)
        return WorkspaceResourceListResponse(snapshot.id, snapshot.toolNames)
    }

    fun workspaceMcp(id: String): WorkspaceResourceListResponse {
        val snapshot = requireWorkspaceSnapshot(id)
        return WorkspaceResourceListResponse(snapshot.id, snapshot.mcpServerIds)
    }

    fun workspaceSkills(id: String): WorkspaceResourceListResponse {
        val snapshot = requireWorkspaceSnapshot(id)
        return WorkspaceResourceListResponse(snapshot.id, snapshot.skillNames)
    }

    fun workspacePersonas(id: String): WorkspaceResourceListResponse {
        val snapshot = requireWorkspaceSnapshot(id)
        return WorkspaceResourceListResponse(snapshot.id, snapshot.personaIds)
    }

    fun workspaceMemory(id: String): WorkspaceMemoryPolicyConfig {
        return requireWorkspaceSnapshot(id).memoryPolicy
    }

    fun personas(workspaceId: String): PersonaListResponse {
        return PersonaListResponse(requirePersonaCase().list(if (applicationManagement != null) "platform" else workspaceId.ifBlank { "default" }))
    }

    fun upsertPersona(request: PersonaUpsertDto): com.heyanle.priestess.bot.persona.Persona {
        if (!request.enabled && request.id != null) applicationManagement?.requirePersonaUnbound(request.id)
        return requirePersonaCase().upsert(
            PersonaUpsertRequest(
                id = request.id,
                workspaceId = if (applicationManagement != null) "platform" else request.workspaceId,
                name = request.name,
                description = request.description,
                tone = request.tone,
                boundaries = request.boundaries,
                systemPromptTemplate = request.systemPromptTemplate,
                exampleDialogs = request.exampleDialogs,
                enabled = request.enabled,
                agentNames = request.agentNames,
                errorMessages = request.errorMessages,
            ),
        )
    }

    fun deletePersona(id: String): DeleteResponse {
        applicationManagement?.requirePersonaUnbound(id)
        return DeleteResponse(requirePersonaCase().delete(id))
    }

    fun resolvePersona(request: PersonaResolveRequest): PersonaResolveResponse {
        applicationManagement?.let { return PersonaResolveResponse(it.personaForAgent(request.agentName)) }
        return PersonaResolveResponse(
            requirePersonaCase().resolve(
                workspaceId = request.workspaceId.ifBlank { "default" },
                agentName = request.agentName,
            ),
        )
    }

    fun memories(
        workspaceId: String,
        platformId: String?,
        sessionId: String?,
        userId: String?,
        agentName: String?,
        type: String?,
        tag: String?,
        limit: Int,
    ): MemoryListResponse {
        val memoryType = type?.takeIf { it.isNotBlank() }?.let {
            com.heyanle.priestess.bot.memory.MemoryType.valueOf(it.uppercase())
        }
        return MemoryListResponse(
            requireMemoryCase().list(
                MemoryFilter(
                    scopeContext = MemoryScopeContext(
                        workspaceId = workspaceId.ifBlank { "default" },
                        platformId = platformId,
                        sessionId = sessionId,
                        userId = userId,
                        agentName = agentName,
                    ),
                    type = memoryType,
                    tag = tag,
                    limit = limit,
                ),
            ),
        )
    }

    fun saveMemory(request: MemorySaveRequest): com.heyanle.priestess.bot.memory.MemoryRecord {
        return requireMemoryCase().save(
            content = request.content,
            type = request.type,
            scope = request.scope,
            scopeContext = request.toScopeContext(),
            tags = request.tags,
            confidence = request.confidence,
            expiresAt = request.expiresAt,
        )
    }

    fun searchMemory(request: MemorySearchRequest): MemorySearchResponse {
        return MemorySearchResponse(
            requireMemoryCase().search(
                MemorySearchQuery(
                    query = request.query,
                    scopeContext = request.toScopeContext(),
                    scope = request.scope,
                    type = request.type,
                    limit = request.limit,
                ),
            ),
        )
    }

    fun deleteMemory(
        id: String,
        workspaceId: String,
        platformId: String?,
        sessionId: String?,
        userId: String?,
        agentName: String?,
    ): DeleteResponse {
        return DeleteResponse(
            requireMemoryCase().delete(
                id = id,
                scopeContext = MemoryScopeContext(
                    workspaceId = workspaceId.ifBlank { "default" },
                    platformId = platformId,
                    sessionId = sessionId,
                    userId = userId,
                    agentName = agentName,
                ),
            ),
        )
    }

    fun expireMemory(): ExpireMemoryResponse {
        return ExpireMemoryResponse(requireMemoryCase().expire())
    }

    fun conversations(): List<ConversationDto> {
        return conversationCase.getAll().map {
            ConversationDto(
                id = it.id,
                platform = it.platform,
                sessionId = it.sessionId,
                createdAt = it.createdAt,
                updatedAt = it.updatedAt,
            )
        }
    }

    fun messages(conversationId: String, count: Int): List<MessageDto> {
        return conversationCase.getMessages(conversationId, count).map {
            MessageDto(
                id = it.id,
                conversationId = it.conversationId,
                role = it.role.name,
                content = it.content,
                toolCalls = it.toolCalls,
                toolCallId = it.toolCallId,
                createdAt = it.createdAt,
            )
        }
    }

    fun plugins(): PluginListResponse {
        return PluginListResponse(pluginCase.list(), pluginCase.extensions())
    }

    fun discoverPlugins(): PluginListResponse {
        pluginCase.discover()
        return plugins()
    }

    fun enablePlugin(id: String): PluginListResponse {
        pluginCase.enable(id)
        return plugins()
    }

    fun disablePlugin(id: String): PluginListResponse {
        pluginCase.disable(id)
        return plugins()
    }

    fun loadPlugin(id: String): PluginListResponse {
        pluginCase.load(id)
        return plugins()
    }

    fun unloadPlugin(id: String): PluginListResponse {
        pluginCase.unload(id)
        return plugins()
    }

    suspend fun chatAgent(request: AgentChatRequest): AgentChatResponse {
        return chatAgentThroughPipeline(request)
    }

    fun knowledgeBases(): KnowledgeBaseListResponse {
        return KnowledgeBaseListResponse(knowledgeCase.listBases())
    }

    fun createKnowledgeBase(request: CreateKnowledgeBaseRequest): KnowledgeBaseListResponse {
        knowledgeCase.createBase(request.name, request.description)
        return knowledgeBases()
    }

    fun addKnowledgeDocument(baseId: String, request: AddKnowledgeDocumentRequest): List<com.heyanle.priestess.bot.knowledge.KnowledgeChunk> {
        return knowledgeCase.addTextDocument(baseId, request.documentName, request.content)
    }

    fun searchKnowledge(request: KnowledgeSearchRequest): List<KnowledgeSearchResultDto> {
        return knowledgeCase.search(request.query, request.knowledgeBaseId, request.limit)
            .map { KnowledgeSearchResultDto(it.chunk, it.score) }
    }

    suspend fun testSubAgent(request: SubAgentTestRequest): SubAgentTestResponse {
        return testSubAgentThroughPipeline(request)
    }

    private suspend fun chatAgentThroughPipeline(request: AgentChatRequest): AgentChatResponse {
        if (request.message.isBlank()) {
            return AgentChatResponse(
                status = "ERROR",
                content = "Message must not be blank",
                events = emptyList(),
                providerName = "",
                model = "",
                conversationId = request.conversationId.orEmpty(),
            )
        }
        val conversationId = request.conversationId?.takeIf(String::isNotBlank) ?: "dashboard-${UUID.randomUUID()}"
        val execution = pipelineCase.processAndAwait(
            dashboardEvent(
                message = request.message,
                workspaceId = request.workspaceId,
                platformId = request.platformId,
                sessionId = request.sessionId ?: conversationId,
                userId = request.userId,
                agentId = request.agentId,
            ),
        )
        val trace = execution.trace
        return AgentChatResponse(
            status = execution.status,
            content = execution.content.ifBlank { execution.error.orEmpty() },
            events = emptyList(),
            providerName = trace?.providerId.orEmpty(),
            model = trace?.model.orEmpty(),
            conversationId = conversationId,
            selectedAgentName = execution.selectedAgentId,
            selectedRouteName = execution.selectedRouteId,
            selectionReason = execution.selectionReason,
            runtimeVersion = trace?.effectiveVersion,
            workspaceVersion = trace?.workspaceVersion,
            toolIds = trace?.toolIds.orEmpty(),
        )
    }

    private suspend fun testSubAgentThroughPipeline(request: SubAgentTestRequest): SubAgentTestResponse {
        val conversationId = request.conversationId?.takeIf(String::isNotBlank) ?: "dashboard-${UUID.randomUUID()}"
        val execution = pipelineCase.processAndAwait(
            dashboardEvent(
                message = request.message,
                workspaceId = request.workspaceId,
                platformId = request.platformId,
                sessionId = request.sessionId ?: conversationId,
                userId = request.userId,
            ),
        )
        return SubAgentTestResponse(
            status = execution.status,
            content = execution.content.ifBlank { execution.error.orEmpty() },
            selectedAgentName = execution.selectedAgentId.orEmpty(),
            selectedRouteName = execution.selectedRouteId,
            selectionReason = execution.selectionReason.orEmpty(),
            events = emptyList(),
            conversationId = conversationId,
            providerName = execution.trace?.providerId,
            model = execution.trace?.model,
            runtimeVersion = execution.trace?.effectiveVersion,
            workspaceVersion = execution.trace?.workspaceVersion,
            toolIds = execution.trace?.toolIds.orEmpty(),
        )
    }

    private fun dashboardEvent(
        message: String,
        workspaceId: String,
        platformId: String?,
        sessionId: String,
        userId: String?,
        agentId: String? = null,
    ): MessageEvent {
        val resolvedPlatformId = platformId?.takeIf(String::isNotBlank) ?: "dashboard"
        val platform = DashboardPipelinePlatform(resolvedPlatformId)
        return MessageEvent(
            platform = platform,
            session = MessageSession(
                id = sessionId,
                type = SessionType.PRIVATE,
                platformName = resolvedPlatformId,
                metadata = mapOf(
                    "workspaceId" to workspaceId,
                    "senderId" to (userId?.takeIf(String::isNotBlank) ?: sessionId),
                ) + (agentId?.let { mapOf("agentId" to it) } ?: emptyMap()),
            ),
            chain = MessageChain.text(message),
            messageId = "dashboard-${UUID.randomUUID()}",
        )
    }

    private class DashboardPipelinePlatform(id: String) : Platform() {
        override val metadata = PlatformMetadata(id, "Dashboard", false, false)
        override suspend fun run(): Job = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String = "dashboard"
    }

    private fun requireWorkspaceSnapshot(id: String): WorkspaceSnapshot {
        return workspaceCase.get(id)
            ?: throw NoSuchElementException("Workspace '$id' not found")
    }

    private fun requirePersonaCase(): PersonaCase {
        return personaCase ?: throw IllegalStateException("Persona runtime is not available")
    }

    private fun requireMemoryCase(): MemoryCase {
        return memoryCase ?: throw IllegalStateException("Memory runtime is not available")
    }

    private fun MemorySaveRequest.toScopeContext(): MemoryScopeContext {
        return MemoryScopeContext(
            workspaceId = workspaceId.ifBlank { "default" },
            platformId = platformId,
            sessionId = sessionId,
            userId = userId,
            agentName = agentName,
        )
    }

    private fun MemorySearchRequest.toScopeContext(): MemoryScopeContext {
        return MemoryScopeContext(
            workspaceId = workspaceId.ifBlank { "default" },
            platformId = platformId,
            sessionId = sessionId,
            userId = userId,
            agentName = agentName,
        )
    }

    private fun WorkspaceStatus.toDto(): WorkspaceStatusDto {
        return WorkspaceStatusDto(
            id = id,
            name = name,
            enabled = enabled,
            activeSnapshotVersion = activeSnapshotVersion,
            loadedAt = loadedAt,
            lastReload = lastReload,
            diagnostics = diagnostics,
        )
    }

    private fun WorkspaceSnapshot.toDetailDto(status: WorkspaceStatus): WorkspaceDetailDto {
        return WorkspaceDetailDto(
            status = status.toDto(),
            providerName = providerName,
            agents = agentIds,
            tools = toolNames,
            skills = skillNames,
            skillSettings = skillSettings,
            mcpServers = mcpServerIds,
            mcpServerDetails = mcpServers.map {
                WorkspaceMcpServerSummaryDto(
                    id = it.id,
                    transport = it.transport,
                    command = it.command,
                    args = it.args,
                    url = it.url,
                )
            },
            personas = personaIds,
            memory = memoryPolicy,
            reloadPlan = status.lastReload?.plan,
        )
    }
}
