package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.agent.CompressStrategy
import com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry
import com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource
import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.runtime.ConfigurationOperationResult
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.memory.*
import com.heyanle.priestess.bot.persona.PersonaCase
import com.heyanle.priestess.bot.platform.*
import kotlinx.coroutines.Job
import kotlinx.serialization.Serializable

@Serializable
data class ApplicationConfigurationView(
    val document: ApplicationConfigurationDocument? = null,
    val revision: String? = null,
    val sourcePath: String,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

@Serializable
data class ImRouteTestRequest(
    val sessionType: SessionType,
    val text: String,
    val mentionsBot: Boolean = false,
    val mentionsAny: Boolean = false,
    val replyToBot: Boolean = false,
    val hasReply: Boolean = false,
    val senderId: String = "",
)

@Serializable
data class ImRouteTestResponse(
    val matched: Boolean,
    val routeId: String? = null,
    val action: String? = null,
    val agentId: String? = null,
    val normalizedText: String,
    val permissionGroup: String = "OPERATOR",
)

/** One behaviour preset as the Dashboard needs it: the roster plus the budgets a new Agent inherits. */
@Serializable
data class AgentPresetView(
    val preset: String,
    val displayName: String,
    val description: String,
    val maxSteps: Int,
    val maxContextTokens: Int,
    val maxRounds: Int,
)

/** Configuration and resource administration, separate from message execution. */
class ApplicationManagementService(
    private val runtime: ConfigurationRuntimeService,
    private val personas: PersonaCase,
    private val memories: MemoryCase,
) {
    /**
     * The preset roster comes from the registry so the Dashboard never keeps a second copy that could
     * silently disagree with the runtime.
     */
    fun agentPresets(): List<AgentPresetView> = AgentPresetRegistry.all.map { definition ->
        AgentPresetView(
            preset = definition.preset.name,
            displayName = definition.displayName,
            description = definition.description,
            maxSteps = definition.defaults.maxSteps,
            maxContextTokens = definition.defaults.maxContextTokens,
            maxRounds = definition.defaults.maxRounds,
        )
    }

    /**
     * Accepted `context.compression.strategy` values, taken from the enum. The editor renders its options
     * from this, so adding a strategy cannot leave the Dashboard offering an outdated list.
     */
    fun compressionStrategies(): List<String> = CompressStrategy.configNames.sorted()

    fun raw(): ApplicationConfigurationView {
        val result = runtime.inspectRaw()
        return ApplicationConfigurationView(result.value?.application, result.value?.revision?.value, runtime.sourcePath().toString(), result.diagnostics)
    }

    fun preview(content: String): ConfigurationOperationResult = validatePersonas(content) ?: runtime.previewApplication(content)
    fun apply(content: String, revision: String?): ConfigurationOperationResult =
        validatePersonas(content) ?: runtime.applyApplication(content, revision?.let(::RawConfigRevision))
    fun reload(): ConfigurationOperationResult = runtime.reloadFromDisk()

    fun requirePersonaUnbound(id: String) {
        val agents = application().agents.filter { it.enabled && it.personaId == id }
        require(agents.isEmpty()) { "Persona is selected by Agents: ${agents.joinToString { it.displayName }}. Unbind it before disabling or deleting." }
    }

    fun personaForAgent(id: String): com.heyanle.priestess.bot.persona.Persona? {
        val agent = application().agents.find { it.id == id && it.enabled } ?: throw NoSuchElementException("Agent '$id' is unavailable")
        val selected = agent.personaId ?: return null
        return personas.list("platform").firstOrNull { it.id == selected && it.enabled }
    }

    private fun validatePersonas(content: String): ConfigurationOperationResult? {
        val decoded = ApplicationConfigurationSource().decode(content, runtime.sourcePath())
        val document = decoded.value?.application ?: return ConfigurationOperationResult(false, diagnostics = decoded.diagnostics)
        val available = personas.list("platform").filter { it.enabled }.mapTo(hashSetOf()) { it.id }
        val errors = document.agents.filter { it.enabled && it.personaId != null && it.personaId !in available }.map {
            ConfigurationDiagnostic("AGENT_PERSONA_UNAVAILABLE", DiagnosticSeverity.ERROR, "Agent '${it.id}' selects a missing or disabled persona", runtime.sourcePath().toString(), "agents.${it.id}.personaId")
        }
        return if (errors.isEmpty()) null else ConfigurationOperationResult(false, diagnostics = errors)
    }

    fun testRoute(id: String, request: ImRouteTestRequest): ImRouteTestResponse {
        val im = application().ims.find { it.id == id } ?: throw NoSuchElementException("IM '$id' does not exist")
        val event = MessageEvent(
            PreviewPlatform(id),
            MessageSession("preview", request.sessionType, id, buildMap {
                put("senderId", request.senderId); put("selfId", "preview-bot")
                if (request.hasReply || request.replyToBot) { put("hasReply", "true"); put("replyMessageId", "preview-reply") }
                if (request.replyToBot) put("replySenderId", "preview-bot")
            }),
            MessageChain(buildList {
                if (request.mentionsBot) add(MessageComponent.At("preview-bot"))
                else if (request.mentionsAny) add(MessageComponent.At("preview-other"))
                if (request.hasReply || request.replyToBot) add(MessageComponent.Reply("preview-reply"))
                add(MessageComponent.Text(request.text))
            }),
        )
        // Preview rules before enabling a transport; this never starts or contacts an IM.
        val match = ImRouter().match(im.copy(enabled = true), event)
        return ImRouteTestResponse(match != null, match?.route?.id, match?.route?.action?.type?.name, match?.route?.action?.agentId,
            match?.text ?: request.text.trimStart(), match?.permissionGroup?.name ?: "OPERATOR")
    }

    fun listMemories(libraryId: String, query: String, limit: Int = 100, offset: Long = 0): MemoryListResponse {
        requireLibrary(libraryId)
        return MemoryListResponse(memories.listLibrary(libraryId, query, limit, offset))
    }

    fun saveMemory(libraryId: String, request: MemorySaveRequest): MemoryRecord {
        requireLibrary(libraryId)
        return memories.save(
            request.content, request.type, request.scope,
            MemoryScopeContext("platform", request.platformId, request.sessionId, request.userId, request.agentName, libraryIds = setOf(libraryId)),
            request.tags, request.confidence, request.expiresAt, libraryId,
        )
    }

    fun deleteMemory(libraryId: String, id: String): DeleteResponse {
        requireLibrary(libraryId)
        return DeleteResponse(memories.deleteLibraryRecord(libraryId, id))
    }

    private fun requireLibrary(id: String) = application().memoryLibraries.find { it.id == id }
        ?: throw NoSuchElementException("Memory library '$id' does not exist")
    private fun application() = checkNotNull(runtime.currentSnapshot()?.application) { "Application configuration is unavailable" }

    private class PreviewPlatform(name: String) : Platform() {
        override val metadata = PlatformMetadata(name, name, false, false)
        override suspend fun run() = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = error("Route previews never send messages")
    }
}
