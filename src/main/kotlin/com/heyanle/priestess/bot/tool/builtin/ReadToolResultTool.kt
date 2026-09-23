package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolResultMaterialization
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ReadToolResultTool(private val store: ToolResultOverflowStore) : FunctionTool() {
    override val resultMaterialization = ToolResultMaterialization.INLINE
    override val schema = ToolSchema(
        name = "read_tool_result", description = "Read a bounded character window from a large prior tool result.",
        parameters = ToolParameters(listOf(ParameterDef("result_id", required = true), ParameterDef("offset", "integer"), ParameterDef("limit", "integer")), listOf("result_id")),
    )
    private val json = Json { encodeDefaults = true }
    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val result = store.read(context.conversationId, args["result_id"].orEmpty()) ?: return ToolResult.error("Tool result was not found", "RESULT_NOT_FOUND")
        val offset = args["offset"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0
        val limit = args["limit"]?.toIntOrNull()?.coerceIn(1, MAX_WINDOW_CODE_POINTS)
            ?: DEFAULT_WINDOW_CODE_POINTS
        val points = result.content.codePoints().toArray()
        val start = offset.coerceAtMost(points.size); val end = (start + limit).coerceAtMost(points.size)
        val content = String(points, start, end - start)
        return ToolResult.success(
            json.encodeToString(
                ReadToolResultResponse(
                    resultId = result.id,
                    content = content,
                    totalCodePoints = points.size,
                    totalBytes = result.totalBytes,
                    offset = start,
                    nextOffset = end,
                    truncated = end < points.size,
                    expiresAtMillis = result.expiresAtMillis,
                ),
            ),
        )
    }

    companion object {
        const val DEFAULT_WINDOW_CODE_POINTS = 2_000
        const val MAX_WINDOW_CODE_POINTS = 2_000
    }
}

@Serializable
data class ReadToolResultResponse(
    val resultId: String,
    val content: String,
    val totalCodePoints: Int,
    val totalBytes: Long,
    val offset: Int,
    val nextOffset: Int,
    val truncated: Boolean,
    val expiresAtMillis: Long,
)
