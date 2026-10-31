package com.heyanle.priestess.bot.agent

/**
 * Agent 执行钩子，用于在运行、工具调用和结束节点上发布事件。
 */
interface AgentHooks {
    suspend fun onAgentBegin(context: AgentContext) {}
    suspend fun onToolStart(context: AgentContext, toolName: String, arguments: String) {}
    suspend fun onToolEnd(context: AgentContext, toolName: String, result: AgentResponse.ToolExecuted) {}
    suspend fun onAgentDone(context: AgentContext, response: AgentResponse.Final) {}
    suspend fun onAgentError(context: AgentContext, error: AgentResponse.Error) {}
}
