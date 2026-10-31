package com.heyanle.priestess.bot.observability.trace

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.agent.runner.ReActRunner
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.provider.model.*
import com.heyanle.priestess.bot.testkit.*
import com.heyanle.priestess.bot.tool.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kotlin.test.*

class ReActExecutionTraceTest {
    @Test
    fun `trace captures actual post compression requests every response and tool observation`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val controller = ExecutionTraceController(DatabaseCase(database))
            val trace = controller.start(ExecutionTraceInput("qq", "group", input = "real question"))
            val provider = FakeProvider(listOf(
                LLMResponse(toolCalls = listOf(ToolCall("call-1", "fake_tool", """{"value":"abc"}""")), tokenUsage = TokenUsage(20, 5, 25)),
                LLMResponse("final answer", tokenUsage = TokenUsage(30, 7, 37)),
            ))
            val tools = ToolCase(ToolController().apply { register(FakeTool(result = ToolResult.success("tool evidence"))) })
            val context = testAgentContext(agent = testAgent().copy(maxContextRounds = 1), messages = mutableListOf(
                ConversationMessage.user("OLD REQUEST MUST BE TRUNCATED"), ConversationMessage.assistant("old answer"),
                ConversationMessage.user("real question"),
            )).copy(executionTrace = trace)
            val response = ReActRunner(context, provider, tools, ContextManager(TokenCounter())).stepUntilDone()
            assertIs<AgentResponse.Final>(response)
            trace.complete(ExecutionStatus.SUCCEEDED, response.content)
            val detail = assertNotNull(controller.detail(trace.id))
            val requests = detail.events.filter { it.type == "llm.request" }
            assertEquals(2, requests.size)
            requests.forEachIndexed { index, event ->
                val actual = event.data["messages"]!!.jsonArray.map { it.jsonObject["content"]?.jsonPrimitive?.content }
                assertEquals(provider.requests[index].messages.map { it.content }, actual)
                assertFalse(actual.any { it.orEmpty().contains("OLD REQUEST MUST BE TRUNCATED") })
            }
            assertEquals(62L, detail.execution.totalTokens)
            assertEquals(2, detail.events.count { it.type == "llm.response" })
            val toolResult = detail.events.single { it.type == "tool.result" }
            assertEquals("call-1", toolResult.data["callId"]?.jsonPrimitive?.content)
            assertEquals("tool evidence", toolResult.data["observation"]?.jsonPrimitive?.content)
            assertNotNull(toolResult.durationMillis)
        } finally { database.stop() }
    }

    @Test
    fun `provider failure and cancellation are recorded and can finalize independently`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val controller = ExecutionTraceController(DatabaseCase(database))
            val failure = controller.start(ExecutionTraceInput("qq", "failed"))
            val context = testAgentContext().copy(executionTrace = failure)
            val result = ReActRunner(context, FakeProvider(failure = IllegalStateException("provider offline")),
                ToolCase(ToolController()), ContextManager(TokenCounter())).stepUntilDone()
            assertIs<AgentResponse.Error>(result)
            failure.complete(ExecutionStatus.FAILED, error = result.message)
            assertTrue(controller.detail(failure.id)!!.events.any { it.type == "llm.error" })
            val cancelled = controller.start(ExecutionTraceInput("qq", "cancelled"))
            assertFailsWith<CancellationException> {
                ReActRunner(testAgentContext().copy(executionTrace = cancelled), FakeProvider(failure = CancellationException("stop")),
                    ToolCase(ToolController()), ContextManager(TokenCounter())).stepUntilDone()
            }
            cancelled.complete(ExecutionStatus.CANCELLED)
            assertTrue(controller.detail(cancelled.id)!!.events.any { it.type == "llm.cancelled" })
            assertEquals(ExecutionStatus.CANCELLED, controller.detail(cancelled.id)!!.execution.status)
            assertEquals(ExecutionStatus.FAILED, controller.detail(failure.id)!!.execution.status)
        } finally { database.stop() }
    }
}
