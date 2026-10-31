package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/** Drops oldest complete turns; the active request is retained even if it exceeds the soft budget. */
class TokenWindowStrategy(private val tokenCounter: TokenCounter) : ContextCompressStrategy {
    override suspend fun compress(
        messages: List<ConversationMessage>,
        systemMessage: ConversationMessage?,
        maxTokens: Int,
        maxRounds: Int,
    ): List<ConversationMessage> {
        val rounds = ConversationRounds.split(messages)
        val selected = mutableListOf<List<ConversationMessage>>()
        var used = (systemMessage?.let(tokenCounter::count) ?: 0) + 2
        for (round in rounds.asReversed()) {
            if (selected.size >= maxRounds.coerceAtLeast(1)) break
            val cost = round.sumOf(tokenCounter::count)
            if (selected.isNotEmpty() && used + cost > maxTokens) break
            selected.add(0, round)
            used += cost
        }
        return listOfNotNull(systemMessage) + selected.flatten()
    }
}
