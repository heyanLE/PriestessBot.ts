package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.ToolCall
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Summarization is the one compression strategy that can lose task state, so what it may summarize, what
 * it must keep, and how it degrades are all contract.
 */
class LlmSummarizationStrategyTest {
    private val counter = TokenCounter()

    @Test
    fun `the request in flight is never summarized`() = runBlocking {
        val messages = conversation(rounds = 6)
        val current = messages.last()

        val compressed = strategy().compress(messages, systemMessage(), maxTokens = 200, maxRounds = 20)

        assertTrue(compressed.contains(current), "The current request must survive verbatim")
        assertEquals("user", compressed.last().role)
    }

    @Test
    fun `the oldest rounds collapse into one marked checkpoint`() = runBlocking {
        val messages = conversation(rounds = 8)
        var summarizedInput: List<ConversationMessage> = emptyList()

        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { input, _ -> summarizedInput = input; "The user asked about widgets." },
            fallback = TokenWindowStrategy(counter),
        )
        val compressed = strategy.compress(messages, systemMessage(), maxTokens = 150, maxRounds = 20)

        assertTrue(summarizedInput.isNotEmpty(), "The summarizer must receive the span")
        assertEquals(systemMessage(), compressed.first(), "The system message is passed through, not summarized")
        val checkpoint = compressed[1]
        assertTrue(checkpoint.content.orEmpty().contains(LlmSummarizationStrategy.CHECKPOINT_PREAMBLE))
        assertTrue(checkpoint.content.orEmpty().contains("<compacted-summary>"))
        assertTrue(checkpoint.content.orEmpty().contains("The user asked about widgets."))
        assertTrue(
            compressed.size < messages.size,
            "Compression must reduce the list: ${compressed.size} vs ${messages.size}",
        )
    }

    @Test
    fun `a tool exchange is never separated from its round`() = runBlocking {
        val messages = mutableListOf(systemMessage())
        repeat(5) { index ->
            messages += ConversationMessage.user("request $index")
            messages += ConversationMessage.assistant("working $index", toolCalls = listOf(ToolCall("t$index", "read_file", "{}")))
            messages += ConversationMessage.tool(toolCallId = "t$index", name = "read_file", content = "observation $index")
            messages += ConversationMessage.assistant("answer $index")
        }
        messages += ConversationMessage.user("final request")

        var summarizedInput: List<ConversationMessage> = emptyList()
        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { input, _ -> summarizedInput = input; "condensed" },
            fallback = TokenWindowStrategy(counter),
        )
        strategy.compress(messages, systemMessage(), maxTokens = 120, maxRounds = 20)

        val summarizedCalls = summarizedInput.filter { it.role == "assistant" }.flatMap { it.toolCalls.orEmpty() }.map { it.id }
        val summarizedResults = summarizedInput.filter { it.role == "tool" }.map { it.toolCallId }
        assertEquals(
            summarizedCalls.toSet(),
            summarizedResults.toSet(),
            "Every summarized tool call must keep its result: calls=$summarizedCalls results=$summarizedResults",
        )
    }

    @Test
    fun `oversized tool observations are pruned before the summarizer sees them`() = runBlocking {
        val huge = "x".repeat(20_000)
        val messages = mutableListOf(systemMessage())
        repeat(4) { index ->
            messages += ConversationMessage.user("request $index")
            messages += ConversationMessage.tool(toolCallId = "t$index", name = "read_file", content = huge)
        }
        messages += ConversationMessage.user("final request")

        var summarizedInput: List<ConversationMessage> = emptyList()
        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { input, _ -> summarizedInput = input; "condensed" },
            fallback = TokenWindowStrategy(counter),
            pruner = ToolResultPruner(thresholdChars = 1_000, headChars = 400, tailChars = 100),
        )
        strategy.compress(messages, systemMessage(), maxTokens = 120, maxRounds = 20)

        val biggest = summarizedInput.filter { it.role == "tool" }.maxOfOrNull { it.content.orEmpty().length } ?: 0
        assertTrue(biggest < huge.length, "Pruning must bound the summarizer input, largest was $biggest")
        assertTrue(
            summarizedInput.any { it.content.orEmpty().contains(ToolResultPruner.PRUNE_MARKER) },
            "A pruned observation must carry the marker",
        )
    }

    @Test
    fun `a failing summarizer degrades to truncation instead of failing the message`() = runBlocking {
        val messages = conversation(rounds = 8)
        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { _, _ -> throw IllegalStateException("provider down") },
            fallback = TokenWindowStrategy(counter),
        )

        val compressed = strategy.compress(messages, systemMessage(), maxTokens = 120, maxRounds = 20)

        assertTrue(compressed.isNotEmpty(), "The message must still produce context")
        assertFalse(
            compressed.any { it.content.orEmpty().contains("<compacted-summary>") },
            "A failed summarization must not leave a checkpoint",
        )
    }

    @Test
    fun `a blank summary is treated as a failure`() = runBlocking {
        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { _, _ -> "   " },
            fallback = TokenWindowStrategy(counter),
        )

        val compressed = strategy.compress(conversation(rounds = 6), systemMessage(), maxTokens = 120, maxRounds = 20)

        assertFalse(compressed.any { it.content.orEmpty().contains("<compacted-summary>") })
    }

    @Test
    fun `a single round has nothing safe to summarize`() = runBlocking {
        val messages = mutableListOf(systemMessage(), ConversationMessage.user("only request"))
        var called = false
        val strategy = LlmSummarizationStrategy(
            tokenCounter = counter,
            summarizer = { _, _ -> called = true; "summary" },
            fallback = TokenWindowStrategy(counter),
        )

        strategy.compress(messages, systemMessage(), maxTokens = 10, maxRounds = 20)

        assertFalse(called, "Summarizing the only round would summarize the request itself")
    }

    @Test
    fun `the pruner leaves small and non tool content alone`() {
        val pruner = ToolResultPruner(thresholdChars = 100, headChars = 40, tailChars = 10)
        val small = ConversationMessage.tool(toolCallId = "t", name = "read_file", content = "short")
        val largeUser = ConversationMessage.user("y".repeat(500))

        val pruned = pruner.prune(listOf(small, largeUser))

        assertEquals("short", pruned[0].content)
        assertEquals(500, pruned[1].content.orEmpty().length, "Only tool observations are pruned")
    }

    @Test
    fun `the pruner keeps a head and a tail and never splits a character`() {
        val content = "中".repeat(500)
        val pruner = ToolResultPruner(thresholdChars = 100, headChars = 40, tailChars = 10)

        val pruned = pruner.prune(content)

        assertTrue(pruned.startsWith("中".repeat(40)))
        assertTrue(pruned.contains(ToolResultPruner.PRUNE_MARKER))
        assertTrue(pruned.contains("中".repeat(10)))
        assertFalse(pruned.contains('\uFFFD'), "Truncation must not corrupt a multi-byte character")
    }

    @Test
    fun `contradictory pruner bounds are refused`() {
        assertFailsWith<IllegalArgumentException> { ToolResultPruner(thresholdChars = 100, headChars = 90, tailChars = 90) }
        assertFailsWith<IllegalArgumentException> { ToolResultPruner(thresholdChars = 0) }
    }

    private fun strategy() = LlmSummarizationStrategy(
        tokenCounter = counter,
        summarizer = { _, _ -> "condensed history" },
        fallback = TokenWindowStrategy(counter),
    )

    private fun systemMessage() = ConversationMessage.system("You are a task agent.")

    private fun conversation(rounds: Int): MutableList<ConversationMessage> {
        val messages = mutableListOf(systemMessage())
        repeat(rounds) { index ->
            messages += ConversationMessage.user("request $index with some words to spend tokens")
            messages += ConversationMessage.assistant("answer $index with some words to spend tokens")
        }
        // The runner appends the inbound message before compressing, so the list ends on the live request.
        messages += ConversationMessage.user("current request with some words to spend tokens")
        return messages
    }
}
