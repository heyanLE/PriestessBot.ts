package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.agent.context.TokenCounter

data class ToolResultMaterializationConfig(
    val inlineTokens: Int,
    val previewTokens: Int,
    val ttlSeconds: Long,
    val maxResultBytes: Long,
    val maxTotalBytes: Long,
)

/**
 * Converts every provider-bound tool result into a context-safe observation.
 * Small payloads remain unchanged; oversized payloads are referenced through
 * the runtime-scoped [ToolResultOverflowStore].
 */
class ToolResultMaterializer(
    private val store: ToolResultOverflowStore,
    private val tokenCounter: TokenCounter = TokenCounter(),
) {
    fun materialize(
        conversationId: String,
        result: ToolResult,
        config: ToolResultMaterializationConfig,
    ): String {
        val content = if (result.success) result.output else result.error
        if (content.isEmpty()) return content

        val estimatedTokens = tokenCounter.countText(content)
        if (estimatedTokens <= config.inlineTokens.coerceAtLeast(1)) return content

        val codePoints = content.codePoints().toArray()
        val inlineBudget = config.inlineTokens.coerceAtLeast(1)
        val previewBudget = config.previewTokens.coerceIn(1, inlineBudget)
        val preview = preview(codePoints, previewBudget)
        val previewCodePoints = preview.codePointCount(0, preview.length)
        val totalBytes = content.toByteArray(Charsets.UTF_8).size.toLong()
        val status = if (result.success) "success" else "error"
        val errorCode = result.errorCode
            ?.replace(Regex("[^A-Za-z0-9_.-]"), "_")
            ?.takeIf { it.isNotBlank() }
        val sourceTruncated = SOURCE_TRUNCATED_PATTERN.containsMatchIn(content)
        val stored = runCatching {
            store.store(
                conversationId = conversationId,
                content = content,
                ttlSeconds = config.ttlSeconds,
                maxResultBytes = config.maxResultBytes,
                maxTotalBytes = config.maxTotalBytes,
                estimatedTokens = estimatedTokens,
            )
        }.getOrNull()

        val sourceMarker = if (sourceTruncated) " source_truncated=true" else ""
        val errorMarker = errorCode?.let { " error_code=$it" }.orEmpty()
        return if (stored != null) {
            buildString {
                append(preview)
                append("\n\n[TOOL_RESULT_OVERFLOW")
                append(" result_id=${stored.id}")
                append(" status=$status")
                append(errorMarker)
                append(" total_code_points=${stored.totalCodePoints}")
                append(" total_bytes=${stored.totalBytes}")
                append(" estimated_tokens=${stored.estimatedTokens}")
                append(" next_offset=$previewCodePoints")
                append(" expires_at_millis=${stored.expiresAtMillis}")
                append(sourceMarker)
                append(". Use read_tool_result with this result_id, offset, and limit to read more.]")
            }
        } else {
            buildString {
                append(preview)
                append("\n\n[TOOL_RESULT_OVERFLOW_UNAVAILABLE")
                append(" status=$status")
                append(errorMarker)
                append(" total_code_points=${codePoints.size}")
                append(" total_bytes=$totalBytes")
                append(" estimated_tokens=$estimatedTokens")
                append(sourceMarker)
                append(". The full result could not be retained.]")
            }
        }
    }

    private fun preview(codePoints: IntArray, tokenBudget: Int): String {
        if (codePoints.isEmpty()) return ""
        var low = 0
        var high = codePoints.size
        while (low < high) {
            val mid = (low + high + 1) ushr 1
            val candidate = String(codePoints, 0, mid)
            if (tokenCounter.countText(candidate) <= tokenBudget) {
                low = mid
            } else {
                high = mid - 1
            }
        }
        return String(codePoints, 0, low)
    }

    companion object {
        private val SOURCE_TRUNCATED_PATTERN = Regex("\\\"truncated\\\"\\s*:\\s*true")
    }
}
