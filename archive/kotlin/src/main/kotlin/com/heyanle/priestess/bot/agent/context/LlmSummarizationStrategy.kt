package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/**
 * Produces the summary that replaces a span of conversation. Supplied by the runner, which is the layer
 * that owns a provider. Returning a blank string is treated as a failure so the strategy can fall back.
 */
fun interface ContextSummarizer {
    suspend fun summarize(messages: List<ConversationMessage>, maxTokens: Int): String
}

/**
 * Replaces an oversized tool observation with a bounded head and tail around an explicit marker.
 *
 * One tool result can dwarf the rest of the conversation, so bounding it first keeps the summarizer's own
 * input small and predictable. Sizes are measured in code points, so a multi-byte character is never cut.
 */
class ToolResultPruner(
    private val thresholdChars: Int = 8_192,
    private val headChars: Int = 4_096,
    private val tailChars: Int = 1_024,
) {
    init {
        require(thresholdChars > 0 && headChars >= 0 && tailChars >= 0) { "Pruner bounds must not be negative" }
        require(headChars + tailChars <= thresholdChars) {
            "headChars + tailChars must not exceed thresholdChars, otherwise pruning would grow the content"
        }
    }

    fun prune(messages: List<ConversationMessage>): List<ConversationMessage> = messages.map { message ->
        val content = message.content
        if (message.role != "tool" || content == null || content.codePointCount(0, content.length) <= thresholdChars) {
            message
        } else {
            message.copy(content = prune(content))
        }
    }

    fun prune(content: String): String {
        val codePoints = content.codePoints().toArray()
        val head = String(codePoints, 0, headChars)
        val tail = String(codePoints, codePoints.size - tailChars, tailChars)
        return buildString {
            append(head)
            append(PRUNE_MARKER)
            append(tail)
            append("\n[tool result pruned: ${codePoints.size} characters reduced to ${headChars + tailChars}]")
        }
    }

    companion object {
        const val PRUNE_MARKER: String = "\n\n[... tool result middle pruned ...]\n\n"
    }
}

/**
 * Replaces the oldest span of conversation with one model-generated checkpoint.
 *
 * Truncation drops task state exactly when a long task has the most of it, so this strategy keeps the
 * recent turns verbatim and condenses what came before. The request in flight is never summarized, a tool
 * exchange is never split from the user turn that produced it, and any failure falls back to plain
 * truncation rather than failing the message.
 */
class LlmSummarizationStrategy(
    private val tokenCounter: TokenCounter,
    private val summarizer: ContextSummarizer,
    private val fallback: ContextCompressStrategy,
    private val pruner: ToolResultPruner = ToolResultPruner(),
    /** Share of the window kept verbatim, matching the reference implementation's retain ratio. */
    private val retainRatio: Double = 0.2,
    private val summaryMaxTokens: Int = 8_192,
) : ContextCompressStrategy {

    override suspend fun compress(
        messages: List<ConversationMessage>,
        systemMessage: ConversationMessage?,
        maxTokens: Int,
        maxRounds: Int,
    ): List<ConversationMessage> {
        // A round is atomic, so summarizing whole rounds can never separate a tool call from its result.
        val rounds = ConversationRounds.split(messages)
        val retained = retainRecentRounds(rounds, systemMessage, maxTokens)
        val summarizedCount = rounds.size - retained.size
        if (summarizedCount <= 0) return fallback.compress(messages, systemMessage, maxTokens, maxRounds)

        val span = pruner.prune(rounds.subList(0, summarizedCount).flatten())
        val summary = runCatching { summarizer.summarize(span, summaryMaxTokens) }.getOrNull()
        if (summary.isNullOrBlank()) {
            // Losing the checkpoint must not cost the message, so degrade to truncation instead.
            return fallback.compress(messages, systemMessage, maxTokens, maxRounds)
        }
        return listOfNotNull(systemMessage) + checkpoint(summary) + retained.flatten()
    }

    /**
     * Keeps the most recent rounds that fit [retainRatio] of the window, always including the last one so
     * the request in flight survives verbatim.
     */
    private fun retainRecentRounds(
        rounds: List<List<ConversationMessage>>,
        systemMessage: ConversationMessage?,
        maxTokens: Int,
    ): List<List<ConversationMessage>> {
        val budget = (maxTokens * retainRatio).toInt().coerceAtLeast(1)
        val retained = mutableListOf<List<ConversationMessage>>()
        var used = systemMessage?.let(tokenCounter::count) ?: 0
        for (round in rounds.asReversed()) {
            val cost = round.sumOf(tokenCounter::count)
            if (retained.isNotEmpty() && used + cost > budget) break
            retained.add(0, round)
            used += cost
        }
        return retained
    }

    private fun checkpoint(summary: String): ConversationMessage = ConversationMessage.user(
        buildString {
            append(CHECKPOINT_PREAMBLE)
            append("\n\n<compacted-summary>\n")
            append(summary.trim())
            append("\n</compacted-summary>")
        },
    )

    companion object {
        const val CHECKPOINT_PREAMBLE: String =
            "This is an automatically generated checkpoint condensing an earlier span of the conversation " +
                "to free up context. Treat the captured background as established and build on it without " +
                "restating it. Continue the task directly from the messages that follow, without " +
                "acknowledging this checkpoint."
    }
}
