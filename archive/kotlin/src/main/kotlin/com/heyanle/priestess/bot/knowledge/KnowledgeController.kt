package com.heyanle.priestess.bot.knowledge

import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.KnowledgeBasesTable
import com.heyanle.priestess.bot.core.db.KnowledgeChunksTable
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import java.util.UUID

/**
 * 知识库控制器，负责知识库和知识片段的持久化读写。
 */
class KnowledgeController(
    private val db: DatabaseCase,
) : BaseController("KnowledgeController") {
    fun createBase(name: String, description: String = ""): KnowledgeBase {
        require(name.isNotBlank()) { "Knowledge base name must not be blank" }
        return db.execute {
            val id = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()
            KnowledgeBasesTable.insert {
                it[KnowledgeBasesTable.id] = id
                it[KnowledgeBasesTable.name] = name.trim()
                it[KnowledgeBasesTable.description] = description
                it[createdAt] = now
                it[updatedAt] = now
            }
            KnowledgeBase(id, name.trim(), description, now, now)
        }
    }

    fun listBases(): List<KnowledgeBase> {
        return db.execute {
            KnowledgeBasesTable.selectAll()
                .orderBy(KnowledgeBasesTable.updatedAt, SortOrder.DESC)
                .map { it.toKnowledgeBase() }
        }
    }

    fun addChunks(baseId: String, documentName: String, chunks: List<String>): List<KnowledgeChunk> {
        require(baseId.isNotBlank()) { "Knowledge base id must not be blank" }
        require(documentName.isNotBlank()) { "Document name must not be blank" }
        val normalized = chunks.map { it.trim() }.filter { it.isNotBlank() }
        require(normalized.isNotEmpty()) { "Document has no indexable content" }

        return db.execute {
            val now = System.currentTimeMillis()
            normalized.map { content ->
                val id = UUID.randomUUID().toString()
                KnowledgeChunksTable.insert {
                    it[KnowledgeChunksTable.id] = id
                    it[knowledgeBaseId] = baseId
                    it[KnowledgeChunksTable.documentName] = documentName.trim()
                    it[KnowledgeChunksTable.content] = content
                    it[createdAt] = now
                }
                KnowledgeChunk(id, baseId, documentName.trim(), content, now)
            }
        }
    }

    fun listChunks(baseId: String? = null): List<KnowledgeChunk> {
        return db.execute {
            val query = KnowledgeChunksTable.selectAll()
            val filtered = if (baseId.isNullOrBlank()) {
                query
            } else {
                query.where { KnowledgeChunksTable.knowledgeBaseId eq baseId }
            }
            filtered
                .orderBy(KnowledgeChunksTable.createdAt, SortOrder.DESC)
                .map { it.toKnowledgeChunk() }
        }
    }

    private fun ResultRow.toKnowledgeBase(): KnowledgeBase {
        return KnowledgeBase(
            id = this[KnowledgeBasesTable.id],
            name = this[KnowledgeBasesTable.name],
            description = this[KnowledgeBasesTable.description],
            createdAt = this[KnowledgeBasesTable.createdAt],
            updatedAt = this[KnowledgeBasesTable.updatedAt],
        )
    }

    private fun ResultRow.toKnowledgeChunk(): KnowledgeChunk {
        return KnowledgeChunk(
            id = this[KnowledgeChunksTable.id],
            knowledgeBaseId = this[KnowledgeChunksTable.knowledgeBaseId],
            documentName = this[KnowledgeChunksTable.documentName],
            content = this[KnowledgeChunksTable.content],
            createdAt = this[KnowledgeChunksTable.createdAt],
        )
    }
}
