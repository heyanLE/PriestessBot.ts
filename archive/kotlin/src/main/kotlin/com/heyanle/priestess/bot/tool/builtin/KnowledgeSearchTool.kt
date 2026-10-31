package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.knowledge.KnowledgeCase
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.annotation.Tool

@Tool(name = "knowledge_search", description = "Search local knowledge bases for relevant context")
class KnowledgeSearchTool(
    private val knowledgeCaseProvider: (() -> KnowledgeCase)? = null,
) : FunctionTool() {
    override val schema = ToolSchema(
        name = "knowledge_search",
        description = "Search local knowledge bases for relevant context.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef(name = "query", type = "string", description = "Search query", required = true),
                ParameterDef(name = "knowledgeBaseId", type = "string", description = "Optional knowledge base id"),
                ParameterDef(name = "limit", type = "string", description = "Maximum number of snippets"),
            ),
            required = listOf("query"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = listOf(ToolCapabilities.KNOWLEDGE),
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val knowledgeCase = knowledgeCaseProvider?.invoke()
            ?: return ToolResult.error("Knowledge search is not configured")
        val query = args["query"]?.trim().orEmpty()
        if (query.isBlank()) return ToolResult.error("query is required")
        val limit = args["limit"]?.toIntOrNull() ?: 5
        val requestedBaseId = args["knowledgeBaseId"]?.takeIf { it.isNotBlank() }
        val allowedBaseIds = context.metadata.workspaceKnowledgeBaseIds()
        if (requestedBaseId != null && allowedBaseIds != null && requestedBaseId !in allowedBaseIds) {
            return ToolResult.error("Knowledge base '$requestedBaseId' is not allowed by workspace memory policy", "WORKSPACE_KNOWLEDGE_BASE_DENIED")
        }
        val results = if (requestedBaseId != null || allowedBaseIds == null) {
            knowledgeCase.search(query, requestedBaseId, limit)
        } else {
            allowedBaseIds.flatMap { baseId -> knowledgeCase.search(query, baseId, limit) }
                .sortedByDescending { it.score }
                .take(limit.coerceIn(1, 20))
        }
        if (results.isEmpty()) {
            return ToolResult.success("No knowledge results found for: $query")
        }
        val output = buildString {
            appendLine("Knowledge results for: $query")
            results.forEachIndexed { index, result ->
                appendLine()
                appendLine("${index + 1}. ${result.chunk.documentName} (score=${"%.2f".format(result.score)})")
                appendLine(result.chunk.content)
            }
        }
        return ToolResult.success(output.trim())
    }
}

private fun Map<String, String>.workspaceKnowledgeBaseIds(): Set<String>? {
    val raw = this["workspaceMemoryKnowledgeBaseIds"]
        ?: this["workspace_memory_knowledge_base_ids"]
        ?: return null
    return raw.split(",")
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .toSet()
}
