package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.provider.model.ToolCall
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/**
 * Decides how the tool calls of one step are dispatched.
 *
 * Implementations MUST return outcomes in submission order regardless of completion order, so the
 * transcript is identical whether or not calls overlapped.
 */
interface ToolCallScheduler {
    suspend fun execute(
        calls: List<ToolCall>,
        run: suspend (ToolCall) -> ToolCallOutcome,
    ): List<ToolCallOutcome>
}

/** One call at a time, in order. The behaviour every Agent had before scheduling was selectable. */
class SerialToolCallScheduler : ToolCallScheduler {
    override suspend fun execute(
        calls: List<ToolCall>,
        run: suspend (ToolCall) -> ToolCallOutcome,
    ): List<ToolCallOutcome> = calls.map { run(it) }
}

/**
 * Runs each maximal run of *consecutive* parallel-safe calls concurrently, bounded by [maxConcurrent].
 * Every other call runs alone in submission order.
 *
 * Restricting concurrency to a run of adjacent calls is what keeps a mutating call exclusive: it never
 * overlaps the calls on either side of it, even though unrelated parallel-safe calls may overlap.
 */
class ParallelSafeToolCallScheduler(
    private val maxConcurrent: Int,
    private val parallelSafe: (ToolCall) -> Boolean,
) : ToolCallScheduler {
    override suspend fun execute(
        calls: List<ToolCall>,
        run: suspend (ToolCall) -> ToolCallOutcome,
    ): List<ToolCallOutcome> {
        val outcomes = arrayOfNulls<ToolCallOutcome>(calls.size)
        var index = 0
        while (index < calls.size) {
            if (!parallelSafe(calls[index])) {
                outcomes[index] = run(calls[index])
                index++
                continue
            }
            var end = index
            while (end < calls.size && parallelSafe(calls[end])) end++
            coroutineScope {
                val permits = Semaphore(maxConcurrent.coerceAtLeast(1))
                (index until end).map { position ->
                    async { permits.withPermit { outcomes[position] = run(calls[position]) } }
                }.awaitAll()
            }
            index = end
        }
        return calls.indices.map { position ->
            outcomes[position] ?: error("Tool call '${calls[position].name}' produced no outcome")
        }
    }
}
