package com.heyanle.priestess.bot.knowledge

import kotlinx.serialization.Serializable

/**
 * 知识库元信息，用于组织一组可检索的知识片段。
 */
@Serializable
data class KnowledgeBase(
    val id: String,
    val name: String,
    val description: String,
    val createdAt: Long,
    val updatedAt: Long,
)

/**
 * 知识片段，表示从文档中拆分出的最小检索内容。
 */
@Serializable
data class KnowledgeChunk(
    val id: String,
    val knowledgeBaseId: String,
    val documentName: String,
    val content: String,
    val createdAt: Long,
)

/**
 * 知识检索结果，包含命中的片段和关键词匹配得分。
 */
data class KnowledgeSearchResult(
    val chunk: KnowledgeChunk,
    val score: Double,
)
