package com.heyanle.priestess.bot.knowledge

/**
 * 知识库模块门面，向外提供知识库创建、文档入库和检索能力。
 */
class KnowledgeCase(
    private val controller: KnowledgeController,
) {
    fun createBase(name: String, description: String = ""): KnowledgeBase {
        return controller.createBase(name, description)
    }

    fun listBases(): List<KnowledgeBase> = controller.listBases()

    fun addTextDocument(baseId: String, documentName: String, content: String): List<KnowledgeChunk> {
        return controller.addChunks(baseId, documentName, splitText(content))
    }

    fun search(query: String, baseId: String? = null, limit: Int = 5): List<KnowledgeSearchResult> {
        if (query.isBlank()) return emptyList()
        val chunks = controller.listChunks(baseId)
        return KeywordKnowledgeRetriever.search(query, chunks, limit.coerceIn(1, 20))
    }

    private fun splitText(content: String, maxChunkChars: Int = 900): List<String> {
        return content
            .split(Regex("\\n\\s*\\n"))
            .flatMap { paragraph ->
                val trimmed = paragraph.trim()
                if (trimmed.length <= maxChunkChars) {
                    listOf(trimmed)
                } else {
                    trimmed.chunked(maxChunkChars)
                }
            }
            .map { it.trim() }
            .filter { it.isNotBlank() }
    }
}
