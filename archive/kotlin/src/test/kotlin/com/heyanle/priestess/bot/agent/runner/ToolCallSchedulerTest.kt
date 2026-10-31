package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.provider.model.ToolCall
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Schedulers own dispatch order only. Whatever overlaps, the returned list is in submission order, which is
 * what keeps the transcript deterministic.
 */
class ToolCallSchedulerTest {

    @Test
    fun `the serial scheduler never overlaps and preserves order`() = runBlocking {
        val tracker = Tracker()
        val calls = listOf(call("a"), call("b"), call("c"))

        val outcomes = SerialToolCallScheduler().execute(calls) { outcome(it, tracker) }

        assertEquals(listOf("a", "b", "c"), outcomes.map { it.call.name })
        assertEquals(1, tracker.maxConcurrent.get(), "The serial scheduler must never overlap calls")
    }

    @Test
    fun `parallel-safe calls overlap`() = runBlocking {
        val tracker = Tracker()
        val calls = listOf(call("a"), call("b"), call("c"))

        val outcomes = ParallelSafeToolCallScheduler(maxConcurrent = 4) { true }
            .execute(calls) { outcome(it, tracker) }

        assertEquals(listOf("a", "b", "c"), outcomes.map { it.call.name })
        assertTrue(tracker.maxConcurrent.get() >= 2, "Expected overlap, peak was ${tracker.maxConcurrent.get()}")
    }

    @Test
    fun `outcomes stay in submission order when completion order differs`() = runBlocking {
        val tracker = Tracker()
        // The first call is the slowest, so it finishes last while still being appended first.
        val calls = listOf(call("slow"), call("fast"))

        val outcomes = ParallelSafeToolCallScheduler(maxConcurrent = 4) { true }
            .execute(calls) { outcome(it, tracker, delayMillis = if (it.name == "slow") 120 else 5) }

        assertEquals(listOf("slow", "fast"), outcomes.map { it.call.name })
        assertEquals(listOf("fast", "slow"), tracker.completionOrder, "The fixture must finish out of order")
    }

    @Test
    fun `an exclusive call never overlaps its neighbours`() = runBlocking {
        val tracker = Tracker()
        val mutating = setOf("write")
        val calls = listOf(call("read-a"), call("write"), call("read-b"))

        ParallelSafeToolCallScheduler(maxConcurrent = 4) { it.name !in mutating }
            .execute(calls) { outcome(it, tracker) }

        assertEquals(0, tracker.exclusiveOverlap.get(), "A mutating call ran while something else was running")
        assertEquals(listOf("read-a", "write", "read-b"), tracker.completionOrder)
    }

    @Test
    fun `the concurrency ceiling is honoured`() = runBlocking {
        val tracker = Tracker()
        val calls = (1..8).map { call("read-$it") }

        ParallelSafeToolCallScheduler(maxConcurrent = 2) { true }
            .execute(calls) { outcome(it, tracker, delayMillis = 30) }

        assertTrue(
            tracker.maxConcurrent.get() <= 2,
            "Peak concurrency ${tracker.maxConcurrent.get()} exceeded the ceiling of 2",
        )
    }

    private fun call(name: String) = ToolCall(id = "call-$name", name = name, arguments = "{}")

    private suspend fun outcome(call: ToolCall, tracker: Tracker, delayMillis: Long = 40): ToolCallOutcome {
        tracker.enter(call.name, exclusive = call.name == "write")
        try {
            delay(delayMillis)
            tracker.completionOrder.add(call.name)
            return ToolCallOutcome(
                call = call,
                result = com.heyanle.priestess.bot.tool.ToolResult.success("ok"),
                observation = call.name,
                durationMillis = delayMillis,
            )
        } finally {
            tracker.exit()
        }
    }

    private class Tracker {
        val current = AtomicInteger()
        val maxConcurrent = AtomicInteger()
        val exclusiveOverlap = AtomicInteger()
        val completionOrder = java.util.Collections.synchronizedList(mutableListOf<String>())

        fun enter(name: String, exclusive: Boolean) {
            val now = current.incrementAndGet()
            maxConcurrent.updateAndGet { maxOf(it, now) }
            if (exclusive && now > 1) exclusiveOverlap.incrementAndGet()
        }

        fun exit() {
            current.decrementAndGet()
        }
    }
}
