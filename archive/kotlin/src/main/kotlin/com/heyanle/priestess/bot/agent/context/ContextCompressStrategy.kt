package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/**
 * 上下文压缩策略接口，定义不同压缩算法的统一入口。
 */
interface ContextCompressStrategy {
    suspend fun compress(
        messages: List<ConversationMessage>,
        systemMessage: ConversationMessage?,
        maxTokens: Int = -1,
        maxRounds: Int = -1,
    ): List<ConversationMessage>
}
