package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/**
 * 仅保留符合 OpenAI 兼容协议的完整工具调用轮次。
 *
 * 对话持久化可能在 assistant 的工具调用消息已保存、所有工具结果尚未保存时中断。
 * Provider 会拒绝此类消息序列，因此后续请求绝不能将不完整轮次作为历史消息发送。
 */
object ToolCallRoundSanitizer {
    fun sanitize(messages: List<ConversationMessage>): List<ConversationMessage> {
        val result = mutableListOf<ConversationMessage>()
        var index = 0

        while (index < messages.size) {
            val message = messages[index]
            if (message.role == "assistant" && !message.toolCalls.isNullOrEmpty()) {
                val requiredIds = message.toolCalls.map { it.id }.toSet()
                val toolMessages = mutableListOf<ConversationMessage>()
                var next = index + 1
                while (next < messages.size && messages[next].role == "tool") {
                    toolMessages += messages[next]
                    next++
                }

                val returnedIds = toolMessages.mapNotNull { it.toolCallId }.toSet()
                if (requiredIds.all { it in returnedIds }) {
                    result += message
                    result += toolMessages.filter { it.toolCallId in requiredIds }
                    index = next
                    continue
                }

                // 丢弃整个不完整轮次；其工具消息会在下方作为孤儿消息跳过，
                // 以保证剩余历史仍符合协议。
                index++
                continue
            }

            // 工具消息只能在上方与其紧邻的、完整的 assistant 工具调用消息一同输出。
            if (message.role != "tool") {
                result += message
            }
            index++
        }

        return result
    }
}
