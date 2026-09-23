package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/**
 * Token 估算器，用于为上下文压缩提供轻量级 token 计数。
 */
class TokenCounter {

    fun count(message: ConversationMessage): Int {
        val roleOverhead = 4
        val contentTokens = countText(message.content)
        val toolCallTokens = message.toolCalls?.sumOf { tc ->
            countText(tc.name) + countText(tc.arguments)
        } ?: 0
        val toolCallIdTokens = message.toolCallId?.let { countText(it) } ?: 0
        val nameTokens = message.name?.let { countText(it) } ?: 0
        return roleOverhead + contentTokens + toolCallTokens + toolCallIdTokens + nameTokens
    }

    fun countAll(messages: List<ConversationMessage>): Int {
        if (messages.isEmpty()) return 0
        val requestOverhead = 2
        return requestOverhead + messages.sumOf { count(it) }
    }

    /**
     * 估算文本的 token 数量。
     *
     * 算法基于常见 LLM 的分词规律：
     * - 中文字符约 0.5-0.7 token/字符，取 1/1.5 ≈ 0.67
     * - 英文字符约 0.25-0.3 token/字符，取 1/4.0 ≈ 0.25
     * - 最终结果取整并至少为 1
     */
    fun countText(text: String?): Int {
        if (text.isNullOrBlank()) return 0
        val totalChars = text.length
        val chineseChars = text.count { it in '\u4e00'..'\u9fff' || it in '\u3400'..'\u4dbf' }
        val otherChars = totalChars - chineseChars
        val chineseTokens = chineseChars / 1.5
        val otherTokens = otherChars / 4.0
        return (chineseTokens + otherTokens).toInt().coerceAtLeast(1)
    }
}
