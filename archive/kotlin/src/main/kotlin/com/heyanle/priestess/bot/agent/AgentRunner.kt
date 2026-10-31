package com.heyanle.priestess.bot.agent

/**
 * Agent 运行器接口，定义单步执行、持续执行和最终结果读取能力。
 */
interface AgentRunner {
    val state: AgentState
    suspend fun reset()
    suspend fun step(): AgentResponse
    suspend fun stepUntilDone(): AgentResponse
    fun isDone(): Boolean
    fun finalResponse(): AgentResponse.Final?
}
