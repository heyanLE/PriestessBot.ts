package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/** Keeps whole recent user turns, including their complete tool exchanges. */
class RoundTruncationStrategy : ContextCompressStrategy {
    override suspend fun compress(
        messages: List<ConversationMessage>,
        systemMessage: ConversationMessage?,
        maxTokens: Int,
        maxRounds: Int,
    ): List<ConversationMessage> = listOfNotNull(systemMessage) +
        ConversationRounds.split(messages).takeLast(maxRounds.coerceAtLeast(0)).flatten()
}
