package com.heyanle.priestess.bot.persona

import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.PersonasTable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import java.util.UUID

/**
 * 人设控制器，负责人设档案的持久化、软删除和按智能体解析。
 */
class PersonaController(
    private val db: DatabaseCase,
) : BaseController("PersonaController") {
    private companion object {
        const val MAX_EXAMPLE_DIALOGS = 20
        const val MAX_EXAMPLE_MESSAGE_CHARS = 8_000
    }

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun list(workspaceId: String): List<Persona> {
        require(workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        return db.execute {
            PersonasTable.selectAll()
                .where { PersonasTable.workspaceId eq workspaceId }
                .orderBy(PersonasTable.updatedAt, SortOrder.DESC)
                .map { it.toPersona() }
                .filter { it.deletedAt == null }
        }
    }

    fun get(id: String): Persona? {
        require(id.isNotBlank()) { "Persona id must not be blank" }
        return db.execute {
            PersonasTable.selectAll()
                .where { PersonasTable.id eq id }
                .limit(1)
                .firstOrNull()
                ?.toPersona()
                ?.takeIf { it.deletedAt == null }
        }
    }

    fun upsert(request: PersonaUpsertRequest): Persona {
        val workspaceId = request.workspaceId.trim()
        val name = request.name.trim()
        require(workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        require(name.isNotBlank()) { "Persona name must not be blank" }
        val id = request.id?.trim()?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        val normalizedBoundaries = request.boundaries.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        val normalizedAgentNames = request.agentNames.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        require(request.exampleDialogs.size <= MAX_EXAMPLE_DIALOGS) {
            "Persona example dialogs must not exceed $MAX_EXAMPLE_DIALOGS pairs"
        }
        val normalizedExampleDialogs = request.exampleDialogs.mapIndexed { index, dialog ->
            val user = dialog.user.trim()
            val assistant = dialog.assistant.trim()
            require(user.isNotBlank()) { "Persona example dialog ${index + 1} user message must not be blank" }
            require(assistant.isNotBlank()) { "Persona example dialog ${index + 1} assistant message must not be blank" }
            require(user.length <= MAX_EXAMPLE_MESSAGE_CHARS) {
                "Persona example dialog ${index + 1} user message must not exceed $MAX_EXAMPLE_MESSAGE_CHARS characters"
            }
            require(assistant.length <= MAX_EXAMPLE_MESSAGE_CHARS) {
                "Persona example dialog ${index + 1} assistant message must not exceed $MAX_EXAMPLE_MESSAGE_CHARS characters"
            }
            PersonaExampleDialog(user = user, assistant = assistant)
        }
        val now = System.currentTimeMillis()

        return db.execute {
            val existing = PersonasTable.selectAll()
                .where { PersonasTable.id eq id }
                .limit(1)
                .firstOrNull()
                ?.toPersona()
            val createdAt = existing?.createdAt ?: now
            val persona = Persona(
                id = id,
                workspaceId = workspaceId,
                name = name,
                description = request.description.trim(),
                tone = request.tone.trim(),
                boundaries = normalizedBoundaries,
                systemPromptTemplate = request.systemPromptTemplate.trim(),
                exampleDialogs = normalizedExampleDialogs,
                enabled = request.enabled,
                agentNames = normalizedAgentNames,
                errorMessages = request.errorMessages.copy(
                    permissionDenied = request.errorMessages.permissionDenied.trim(),
                ),
                createdAt = createdAt,
                updatedAt = now,
            )
            if (existing == null) {
                PersonasTable.insert {
                    it[PersonasTable.id] = persona.id
                    it[PersonasTable.workspaceId] = persona.workspaceId
                    it[PersonasTable.name] = persona.name
                    it[description] = persona.description
                    it[tone] = persona.tone
                    it[boundaries] = json.encodeToString(persona.boundaries)
                    it[systemPromptTemplate] = persona.systemPromptTemplate
                    it[exampleDialogs] = json.encodeToString(persona.exampleDialogs)
                    it[enabled] = persona.enabled
                    it[agentNames] = json.encodeToString(persona.agentNames)
                    it[errorMessages] = json.encodeToString(persona.errorMessages)
                    it[PersonasTable.createdAt] = persona.createdAt
                    it[updatedAt] = persona.updatedAt
                    it[deletedAt] = persona.deletedAt
                }
            } else {
                PersonasTable.update({ PersonasTable.id eq id }) {
                    it[PersonasTable.workspaceId] = persona.workspaceId
                    it[PersonasTable.name] = persona.name
                    it[description] = persona.description
                    it[tone] = persona.tone
                    it[boundaries] = json.encodeToString(persona.boundaries)
                    it[systemPromptTemplate] = persona.systemPromptTemplate
                    it[exampleDialogs] = json.encodeToString(persona.exampleDialogs)
                    it[enabled] = persona.enabled
                    it[agentNames] = json.encodeToString(persona.agentNames)
                    it[errorMessages] = json.encodeToString(persona.errorMessages)
                    it[updatedAt] = persona.updatedAt
                    it[deletedAt] = null
                }
            }
            persona
        }
    }

    fun delete(id: String): Boolean {
        require(id.isNotBlank()) { "Persona id must not be blank" }
        val now = System.currentTimeMillis()
        return db.execute {
            PersonasTable.update({
                (PersonasTable.id eq id) and PersonasTable.deletedAt.isNull()
            }) {
                it[updatedAt] = now
                it[deletedAt] = now
            } > 0
        }
    }

    fun resolve(workspaceId: String, agentName: String): Persona? {
        require(workspaceId.isNotBlank()) { "Workspace id must not be blank" }
        val normalizedAgentName = agentName.trim()
        return list(workspaceId)
            .asSequence()
            .filter { it.enabled }
            .filter { it.agentNames.isEmpty() || normalizedAgentName in it.agentNames }
            .sortedWith(
                compareByDescending<Persona> { normalizedAgentName in it.agentNames }
                    .thenByDescending { it.updatedAt },
            )
            .firstOrNull()
    }

    private fun ResultRow.toPersona(): Persona {
        return Persona(
            id = this[PersonasTable.id],
            workspaceId = this[PersonasTable.workspaceId],
            name = this[PersonasTable.name],
            description = this[PersonasTable.description],
            tone = this[PersonasTable.tone],
            boundaries = json.decodeFromString(this[PersonasTable.boundaries]),
            systemPromptTemplate = this[PersonasTable.systemPromptTemplate],
            exampleDialogs = json.decodeFromString(this[PersonasTable.exampleDialogs]),
            enabled = this[PersonasTable.enabled],
            agentNames = json.decodeFromString(this[PersonasTable.agentNames]),
            errorMessages = json.decodeFromString(this[PersonasTable.errorMessages]),
            createdAt = this[PersonasTable.createdAt],
            updatedAt = this[PersonasTable.updatedAt],
            deletedAt = this[PersonasTable.deletedAt],
        )
    }
}
