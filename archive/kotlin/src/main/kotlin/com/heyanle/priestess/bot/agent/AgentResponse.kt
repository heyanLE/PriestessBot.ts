package com.heyanle.priestess.bot.agent

/**
 * Agent 单步或完整运行结果。
 */
sealed class AgentResponse {
    /**
     * Agent 仍在推理或等待后续工具结果。
     */
    data class Thinking(val content: String) : AgentResponse()

    /**
     * 工具调用完成后的中间结果。
     */
    data class ToolExecuted(
        val toolCallId: String,
        val toolName: String,
        val toolResult: com.heyanle.priestess.bot.tool.ToolResult,
    ) : AgentResponse()

    /**
     * Agent 生成的最终回复。
     */
    data class Final(val content: String) : AgentResponse()

    /**
     * Agent 运行失败信息。
     */
    data class Error(val message: String, val cause: Throwable? = null) : AgentResponse()
}
