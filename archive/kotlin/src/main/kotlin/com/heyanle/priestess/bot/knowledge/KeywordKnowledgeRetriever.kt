package com.heyanle.priestess.bot.knowledge

/**
 * 基于关键词的知识检索器，用轻量匹配为知识片段排序。
 */
object KeywordKnowledgeRetriever {
    private val tokenRegex = Regex("[\\p{L}\\p{N}_]+")

    fun search(query: String, chunks: List<KnowledgeChunk>, limit: Int): List<KnowledgeSearchResult> {
        val queryTokens = tokenize(query)
        if (queryTokens.isEmpty()) return emptyList()
        val queryPhrase = query.trim().lowercase()

        return chunks.mapNotNull { chunk ->
            val content = chunk.content.lowercase()
            val contentTokens = tokenize(content)
            val occurrences = queryTokens.sumOf { token -> contentTokens.count { it == token } }
            val phraseBonus = if (queryPhrase.length >= 3 && content.contains(queryPhrase)) 2.0 else 0.0
            val score = occurrences.toDouble() + phraseBonus
            if (score > 0.0) KnowledgeSearchResult(chunk, score) else null
        }
            .sortedWith(
                compareByDescending<KnowledgeSearchResult> { it.score }
                    .thenByDescending { it.chunk.createdAt },
            )
            .take(limit)
    }

    private fun tokenize(value: String): List<String> {
        return tokenRegex.findAll(value.lowercase()).map { it.value }.toList()
    }
}
