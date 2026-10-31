package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.testkit.FakeProvider
import com.heyanle.priestess.bot.testkit.testAgentContext
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolExecutor
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The two runners share one loop and differ only in scheduling, so what is asserted here is the
 * integration: overlap for parallel-safe tools, submission-order observations, exclusive mutation, and
 * one failing call never taking its siblings down.
 */
class HarnessRunnerSchedulingTest {

    @Test
    fun `the task runner overlaps parallel-safe tools and appends observations in submission order`() = runBlocking {
        val tracker = Tracker()
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    content = "working",
                    toolCalls = listOf(ToolCall("1", "slow_read", "{}"), ToolCall("2", "fast_read", "{}")),
                ),
                LLMResponse(content = "final", finishReason = "stop"),
            ),
        )
        val tools = listOf(
            probe("slow_read", parallelSafe = true, delayMillis = 150, tracker = tracker),
            probe("fast_read", parallelSafe = true, delayMillis = 10, tracker = tracker),
        )

        val result = runner(context, provider, tools, harness = true).stepUntilDone()

        assertEquals(AgentResponse.Final("final"), result)
        assertTrue(tracker.maxConcurrent.get() >= 2, "Expected overlap, peak was ${tracker.maxConcurrent.get()}")
        assertEquals(listOf("fast_read", "slow_read"), tracker.completionOrder, "The fixture must finish out of order")
        assertEquals(
            listOf("slow_read", "fast_read"),
            context.messages.filter { it.role == "tool" }.map { it.name },
            "Observations must follow submission order, not completion order",
        )
    }

    @Test
    fun `the chat runner stays serial`() = runBlocking {
        val tracker = Tracker()
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    content = "working",
                    toolCalls = listOf(ToolCall("1", "a_read", "{}"), ToolCall("2", "b_read", "{}")),
                ),
                LLMResponse(content = "final", finishReason = "stop"),
            ),
        )
        val tools = listOf(
            probe("a_read", parallelSafe = true, delayMillis = 60, tracker = tracker),
            probe("b_read", parallelSafe = true, delayMillis = 10, tracker = tracker),
        )

        runner(context, provider, tools, harness = false).stepUntilDone()

        assertEquals(1, tracker.maxConcurrent.get(), "The chat runner must not overlap tool calls")
        assertEquals(listOf("a_read", "b_read"), tracker.completionOrder)
    }

    @Test
    fun `a mutating tool is exclusive while its parallel-safe siblings still overlap`() = runBlocking {
        val tracker = Tracker()
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    content = "working",
                    toolCalls = listOf(
                        ToolCall("1", "read_a", "{}"),
                        ToolCall("2", "write_file", "{}"),
                        ToolCall("3", "read_b", "{}"),
                        ToolCall("4", "read_c", "{}"),
                    ),
                ),
                LLMResponse(content = "final", finishReason = "stop"),
            ),
        )
        val tools = listOf(
            probe("read_a", parallelSafe = true, delayMillis = 40, tracker = tracker),
            probe("write_file", parallelSafe = false, delayMillis = 40, tracker = tracker),
            probe("read_b", parallelSafe = true, delayMillis = 40, tracker = tracker),
            probe("read_c", parallelSafe = true, delayMillis = 40, tracker = tracker),
        )

        runner(context, provider, tools, harness = true).stepUntilDone()

        assertEquals(0, tracker.exclusiveOverlap.get(), "A mutating tool overlapped another call")
        assertTrue(tracker.maxConcurrent.get() >= 2, "The reads after the write should still overlap")
        assertEquals(
            listOf("read_a", "write_file", "read_b", "read_c"),
            context.messages.filter { it.role == "tool" }.map { it.name },
        )
    }

    @Test
    fun `a failing parallel-safe tool does not take its siblings down`() = runBlocking {
        val tracker = Tracker()
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    content = "working",
                    toolCalls = listOf(ToolCall("1", "explodes", "{}"), ToolCall("2", "succeeds", "{}")),
                ),
                LLMResponse(content = "recovered", finishReason = "stop"),
            ),
        )
        val tools = listOf(
            failingProbe("explodes", delayMillis = 30, tracker = tracker),
            probe("succeeds", parallelSafe = true, delayMillis = 60, tracker = tracker),
        )

        val result = runner(context, provider, tools, harness = true).stepUntilDone()

        assertEquals(AgentResponse.Final("recovered"), result, "The step must continue after one call fails")
        val observations = context.messages.filter { it.role == "tool" }.associate { it.name to it.content.orEmpty() }
        assertTrue(observations.getValue("explodes").contains("boom"), observations.toString())
        assertTrue(observations.getValue("succeeds").contains("succeeds ok"), observations.toString())
    }

    private fun runner(
        context: AgentContext,
        provider: FakeProvider,
        tools: List<FunctionTool>,
        harness: Boolean,
        maxParallel: Int = 4,
    ): ReActRunner {
        val controller = ToolController()
        tools.forEach(controller::register)
        val toolCase = ToolCase(controller = controller, executorProvider = { ToolExecutor(controller) })
        return if (harness) {
            HarnessRunner(
                context = context,
                provider = provider,
                toolCase = toolCase,
                contextManager = ContextManager(TokenCounter()),
                maxParallelToolCalls = maxParallel,
            )
        } else {
            ReActRunner(
                context = context,
                provider = provider,
                toolCase = toolCase,
                contextManager = ContextManager(TokenCounter()),
            )
        }
    }

    private fun probe(name: String, parallelSafe: Boolean, delayMillis: Long, tracker: Tracker): FunctionTool =
        object : FunctionTool() {
            override val schema = ToolSchema(name = name, description = name, parallelSafe = parallelSafe)

            override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
                tracker.enter(parallelSafe)
                try {
                    delay(delayMillis)
                    tracker.completionOrder.add(name)
                    return ToolResult.success("$name ok")
                } finally {
                    tracker.exit()
                }
            }
        }

    private fun failingProbe(name: String, delayMillis: Long, tracker: Tracker): FunctionTool =
        object : FunctionTool() {
            override val schema = ToolSchema(name = name, description = name, parallelSafe = true)

            override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
                tracker.enter(true)
                try {
                    delay(delayMillis)
                    tracker.completionOrder.add(name)
                    throw IllegalStateException("boom")
                } finally {
                    tracker.exit()
                }
            }
        }

    private class Tracker {
        val current = AtomicInteger()
        val maxConcurrent = AtomicInteger()
        val exclusiveOverlap = AtomicInteger()
        val completionOrder = java.util.Collections.synchronizedList(mutableListOf<String>())

        fun enter(parallelSafe: Boolean) {
            val now = current.incrementAndGet()
            maxConcurrent.updateAndGet { maxOf(it, now) }
            if (!parallelSafe && now > 1) exclusiveOverlap.incrementAndGet()
        }

        fun exit() {
            current.decrementAndGet()
        }
    }
}
