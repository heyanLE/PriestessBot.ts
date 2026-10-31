package com.heyanle.priestess.bot.persona

import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.memory.MemorySearchQuery
import com.heyanle.priestess.bot.memory.MemorySearchResult

/**
 * 人设与记忆注入上下文，描述当前消息可使用的人设和记忆范围。
 */
data class PersonaMemoryInjectionContext(
    val workspaceId: String,
    val agentName: String,
    val platformId: String? = null,
    val sessionId: String? = null,
    val userId: String? = null,
    val message: String,
    val maxMemories: Int = 3,
    val allowedPersonaIds: Set<String>? = null,
    val selectedPersonaId: String? = null,
    val memoryLibraryIds: Set<String>? = null,
    val allowedMemoryScopes: Set<com.heyanle.priestess.bot.memory.MemoryScope>? = null,
    val exampleTokenBudget: Int = 512,
)

/**
 * 人设与记忆注入结果，包含渲染后的指令、元数据和命中的上下文。
 */
data class PersonaMemoryInjection(
    val instructions: String,
    val metadata: Map<String, String>,
    val persona: Persona?,
    val exampleDialogs: List<PersonaExampleDialog>,
    val memories: List<MemorySearchResult>,
) {
    val hasContent: Boolean
        get() = persona != null || memories.isNotEmpty()
}

/**
 * 人设与记忆注入器，将匹配的人设和记忆渲染进智能体指令。
 */
class PersonaMemoryInjector(
    private val personaCase: PersonaCase,
    private val memoryCase: MemoryCase,
    private val maxMemorySnippetChars: Int = 320,
) {
    fun inject(
        baseInstructions: String,
        context: PersonaMemoryInjectionContext,
    ): PersonaMemoryInjection {
        val workspaceId = context.workspaceId.trim()
        val agentName = context.agentName.trim()
        require(workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        require(agentName.isNotBlank()) { "Agent name must not be blank" }

        val persona = resolvePersona(workspaceId, agentName, context.allowedPersonaIds, context.selectedPersonaId)
        val scopeContext = MemoryScopeContext(
            workspaceId = workspaceId,
            platformId = context.platformId,
            sessionId = context.sessionId,
            userId = context.userId,
            agentName = agentName,
            libraryIds = context.memoryLibraryIds,
            allowedScopes = context.allowedMemoryScopes,
        )
        val memories = if (context.maxMemories <= 0 || context.memoryLibraryIds?.isEmpty() == true || context.allowedMemoryScopes?.isEmpty() == true) {
            emptyList()
        } else {
            memoryCase.search(
                MemorySearchQuery(
                    query = context.message,
                    scopeContext = scopeContext,
                    limit = 50,
                ),
            ).filter { context.allowedMemoryScopes == null || it.record.scope in context.allowedMemoryScopes }
                .take(context.maxMemories.coerceIn(1, 20))
        }
        val renderedSection = renderSection(persona, memories, context.exampleTokenBudget)
        val instructions = if (renderedSection.isBlank()) {
            baseInstructions
        } else {
            buildString {
                append(baseInstructions.trimEnd())
                if (isNotEmpty()) append("\n\n")
                append(renderedSection)
            }
        }
        val metadata = buildMetadata(persona, memories)
        return PersonaMemoryInjection(
            instructions = instructions,
            metadata = metadata,
            persona = persona,
            exampleDialogs = persona?.exampleDialogs.orEmpty(),
            memories = memories,
        )
    }

    private fun renderSection(
        persona: Persona?,
        memories: List<MemorySearchResult>,
        exampleTokenBudget: Int,
    ): String {
        if (persona == null && memories.isEmpty()) return ""
        return buildString {
            append("## Persona And Memory Context")
            if (persona != null) {
                append("\n\n### Persona: ")
                append(persona.name)
                if (persona.description.isNotBlank()) {
                    append("\nDescription: ")
                    append(persona.description)
                }
                if (persona.tone.isNotBlank()) {
                    append("\nTone: ")
                    append(persona.tone)
                }
                if (persona.boundaries.isNotEmpty()) {
                    append("\nBoundaries:")
                    persona.boundaries.forEach { boundary ->
                        append("\n- ")
                        append(boundary)
                    }
                }
                if (persona.systemPromptTemplate.isNotBlank()) {
                    append("\nInstructions:\n")
                    append(persona.systemPromptTemplate)
                }
                val counter = com.heyanle.priestess.bot.agent.context.TokenCounter()
                var remaining = exampleTokenBudget.coerceAtLeast(0)
                val examples = persona.exampleDialogs.mapNotNull { example ->
                    val text = kotlinx.serialization.json.buildJsonObject {
                        put("example_user", kotlinx.serialization.json.JsonPrimitive(example.user))
                        put("example_assistant", kotlinx.serialization.json.JsonPrimitive(example.assistant))
                    }.toString()
                    val tokens = counter.countText(text)
                    if (tokens > remaining) null else text.also { remaining -= tokens }
                }
                if (examples.isNotEmpty()) {
                    append("\n\n### Fictional style examples — not conversation history\n")
                    append("These invented pairs demonstrate tone only. They are not facts about this user, past requests, completed actions, relationships, or memory. Follow the actual current request; never continue an example.\n")
                    examples.forEach { append(it).append('\n') }
                }
            }
            if (memories.isNotEmpty()) {
                append("\n\n### Relevant Memories")
                memories.forEachIndexed { index, result ->
                    append("\n")
                    append(index + 1)
                    append(". [")
                    append(result.record.id)
                    append("] ")
                    append(result.record.type.name)
                    append(": ")
                    append(result.record.content.trim().take(maxMemorySnippetChars))
                    if (result.record.content.length > maxMemorySnippetChars) append("...")
                    append(" (reason: ")
                    append(result.matchReason)
                    append(")")
                }
            }
        }
    }

    private fun buildMetadata(
        persona: Persona?,
        memories: List<MemorySearchResult>,
    ): Map<String, String> {
        val metadata = mutableMapOf<String, String>()
        if (persona != null) {
            metadata["injectedPersonaId"] = persona.id
            metadata["injectedPersonaName"] = persona.name
            metadata["injected_persona_id"] = persona.id
            metadata["injected_persona_name"] = persona.name
            metadata["injectedExampleDialogCount"] = persona.exampleDialogs.size.toString()
            metadata["injected_example_dialog_count"] = persona.exampleDialogs.size.toString()
        }
        if (memories.isNotEmpty()) {
            metadata["injectedMemoryIds"] = memories.joinToString(",") { it.record.id }
            metadata["injectedMemoryReasons"] = memories.joinToString(" | ") { "${it.record.id}:${it.matchReason}" }
            metadata["injected_memory_ids"] = memories.joinToString(",") { it.record.id }
            metadata["injected_memory_reasons"] = memories.joinToString(" | ") { "${it.record.id}:${it.matchReason}" }
        }
        metadata["injectedMemoryCount"] = memories.size.toString()
        metadata["injected_memory_count"] = memories.size.toString()
        return metadata
    }

    private fun resolvePersona(
        workspaceId: String,
        agentName: String,
        allowedPersonaIds: Set<String>?,
        selectedPersonaId: String?,
    ): Persona? {
        if (selectedPersonaId != null) {
            return personaCase.list(workspaceId).firstOrNull {
                it.id == selectedPersonaId && it.enabled && (allowedPersonaIds == null || it.id in allowedPersonaIds)
            } ?: error("Selected persona '$selectedPersonaId' is missing or disabled")
        }
        if (allowedPersonaIds == null) {
            return personaCase.resolve(workspaceId, agentName)
        }
        val normalizedAgentName = agentName.trim()
        return personaCase.list(workspaceId)
            .asSequence()
            .filter { it.id in allowedPersonaIds }
            .filter { it.enabled }
            .filter { it.agentNames.isEmpty() || normalizedAgentName in it.agentNames }
            .sortedWith(
                compareByDescending<Persona> { normalizedAgentName in it.agentNames }
                    .thenByDescending { it.updatedAt },
            )
            .firstOrNull()
    }
}
