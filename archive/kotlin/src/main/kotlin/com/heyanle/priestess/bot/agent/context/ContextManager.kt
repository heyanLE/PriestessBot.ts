package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.CompressStrategy
import com.heyanle.priestess.bot.provider.model.ConversationMessage

/**
 * 上下文管理器，负责判断消息是否需要压缩并选择对应压缩策略。
 */
class ContextManager(
    private val tokenCounter: TokenCounter,
    private val strategies: Map<CompressStrategy, ContextCompressStrategy> = mapOf(
        CompressStrategy.ROUND_TRUNCATION to RoundTruncationStrategy(),
        CompressStrategy.TOKEN_WINDOW to TokenWindowStrategy(tokenCounter),
    ),
    private val pruner: ToolResultPruner = ToolResultPruner(),
) {
    suspend fun compress(
        agent: Agent,
        messages: List<ConversationMessage>,
        systemMessage: ConversationMessage?,
        maxTokens: Int = -1,
        maxRounds: Int = -1,
        summarizer: ContextSummarizer? = null,
    ): List<ConversationMessage> {
        if (messages.isEmpty()) return messages
        val validMessages = ToolCallRoundSanitizer.sanitize(messages)
        val effectiveMaxRounds = if (maxRounds > 0) maxRounds else agent.maxContextRounds
        val effectiveMaxTokens = if (maxTokens > 0) maxTokens else agent.maxContextTokens
        if (!needsCompression(validMessages, effectiveMaxTokens, effectiveMaxRounds)) {
            return validMessages
        }
        val strategy = strategyFor(agent, summarizer)
        return ToolCallRoundSanitizer.sanitize(
            strategy.compress(validMessages, systemMessage, effectiveMaxTokens, effectiveMaxRounds),
        )
    }

    fun needsCompression(
        messages: List<ConversationMessage>,
        maxTokens: Int,
        maxRounds: Int,
    ): Boolean {
        val roundCount = messages.count { it.role == "user" }
        if (roundCount > maxRounds) return true
        val totalTokens = tokenCounter.countAll(messages)
        if (totalTokens > maxTokens) return true
        return false
    }

    /**
     * Summarization needs a provider, which only the runner has, so it arrives per call. Without one the
     * Agent truncates instead: silently not compressing would let the request exceed the window.
     */
    private fun strategyFor(agent: Agent, summarizer: ContextSummarizer?): ContextCompressStrategy =
        when (agent.compressStrategy) {
            CompressStrategy.LLM_SUMMARIZATION -> summarizer?.let {
                LlmSummarizationStrategy(tokenCounter, it, TokenWindowStrategy(tokenCounter), pruner)
            } ?: TokenWindowStrategy(tokenCounter)
            else -> strategies[agent.compressStrategy]
                ?: error("Unknown compress strategy: ${agent.compressStrategy}")
        }
}
