package com.heyanle.priestess.bot.observability.trace

import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.TokenUsage
import java.nio.file.Files
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kotlin.test.*

class ExecutionTraceControllerTest {
    @Test
    fun `concurrent executions have contiguous isolated logs and terminal projection`() = runBlocking {
        val database = memoryDatabase()
        try {
            val controller = ExecutionTraceController(DatabaseCase(database))
            val ids = (1..12).map { number -> async(Dispatchers.Default) {
                val trace = controller.start(ExecutionTraceInput("qq", "group-$number", input = "request-$number"))
                trace.identify("workspace", "agent-$number", "provider", "model")
                repeat(8) { index -> trace.record(TraceCategory.AGENT, "check", buildJsonObject { put("owner", number); put("index", index) }) }
                trace.llmResponse(1, LLMResponse(tokenUsage = TokenUsage(10, 4, 14)), 12)
                trace.complete(ExecutionStatus.SUCCEEDED, "answer-$number")
                trace.record(TraceCategory.AGENT, "too-late")
                trace.complete(ExecutionStatus.FAILED, error = "must not replace terminal state")
                trace.id
            } }.awaitAll()
            assertEquals(12, ids.distinct().size)
            ids.forEachIndexed { index, id ->
                val detail = assertNotNull(controller.detail(id))
                assertEquals(ExecutionStatus.SUCCEEDED, detail.execution.status)
                assertEquals((1..detail.events.size).toList(), detail.events.map { it.seq })
                assertTrue(detail.events.all { it.executionId == id })
                assertEquals("answer-${index + 1}", detail.execution.outputPreview)
                assertEquals(14L, detail.execution.totalTokens)
                assertEquals(8, detail.events.count { it.type == "check" && it.data["owner"]?.jsonPrimitive?.int == index + 1 })
                assertFalse(detail.events.any { it.type == "too-late" })
            }
            val filtered = controller.list(ExecutionTraceFilter(platform = "qq", agent = "agent-3", status = ExecutionStatus.SUCCEEDED))
            assertEquals(1, filtered.items.size)
            assertEquals(1L, filtered.total)
            assertEquals("group-3", filtered.items.single().sessionId)
        } finally { database.stop() }
    }

    @Test
    fun `payloads are redacted before disk persistence and detail is cursor paged`() = runBlocking {
        val database = memoryDatabase()
        try {
            val controller = ExecutionTraceController(DatabaseCase(database), redactor = TraceRedactor(listOf("secret-value-123")))
            val trace = controller.start(ExecutionTraceInput("qq", "group", input = "token=secret-value-123"))
            trace.record(TraceCategory.TOOL, "tool.call", buildJsonObject {
                put("arguments", """{"apiKey":"api-hidden","normal":"kept","nested":{"password":"pass-hidden"}}""")
                put("authorization", "Bearer hidden-bearer")
                put("result", "secret-value-123")
            })
            trace.complete(ExecutionStatus.FAILED, error = "Bearer bearer-hidden; api_key=error-hidden")
            val first = assertNotNull(controller.detail(trace.id, limit = 2))
            assertTrue(first.hasMore)
            val second = assertNotNull(controller.detail(trace.id, afterSeq = first.nextSeq, limit = 2))
            assertFalse(second.hasMore)
            assertEquals(listOf(3), second.events.map { it.seq })
            val encoded = first.toString() + second.toString()
            listOf("secret-value-123", "api-hidden", "pass-hidden", "hidden-bearer", "bearer-hidden", "error-hidden").forEach {
                assertFalse(encoded.contains(it), "Secret retained: $it")
            }
            assertTrue(encoded.contains("kept"))
            assertEquals(ExecutionStatus.FAILED, second.execution.status)
        } finally { database.stop() }
    }

    @Test
    fun `limits preserve completion and indicate omitted content`() = runBlocking {
        val database = memoryDatabase()
        try {
            val controller = ExecutionTraceController(DatabaseCase(database), maxEvents = 3, maxExecutionBytes = 200)
            val trace = controller.start(ExecutionTraceInput("qq", "group", input = "x".repeat(10_000)))
            repeat(10) { trace.record(TraceCategory.LLM, "large", buildJsonObject { put("body", "x".repeat(10_000)) }) }
            trace.complete(ExecutionStatus.CANCELLED, error = "shutdown")
            val detail = assertNotNull(controller.detail(trace.id))
            assertEquals(4, detail.events.size)
            assertEquals("execution.finished", detail.events.last().type)
            assertTrue(detail.execution.truncated)
            assertTrue(detail.events.any { it.truncated })
            assertEquals(ExecutionStatus.CANCELLED, detail.execution.status)
            assertEquals(100, controller.list(ExecutionTraceFilter(limit = 10_000)).limit)
        } finally { database.stop() }
    }

    @Test
    fun `completed logs survive restart and abandoned executions become failed`() = runBlocking {
        val path = Files.createTempFile("execution-trace-", ".sqlite")
        var database = DatabaseController(path.toString())
        try {
            val first = ExecutionTraceController(DatabaseCase(database))
            val completed = first.start(ExecutionTraceInput("qq", "one"))
            completed.complete(ExecutionStatus.SUCCEEDED)
            val abandoned = first.start(ExecutionTraceInput("qq", "two"))
            database.stop()
            database = DatabaseController(path.toString())
            val restored = ExecutionTraceController(DatabaseCase(database))
            assertEquals(ExecutionStatus.SUCCEEDED, restored.detail(completed.id)?.execution?.status)
            val interrupted = assertNotNull(restored.detail(abandoned.id))
            assertEquals(ExecutionStatus.FAILED, interrupted.execution.status)
            assertEquals("execution.interrupted", interrupted.events.last().type)
            assertTrue(interrupted.execution.error.orEmpty().contains("restarted"))
        } finally { database.stop(); Files.deleteIfExists(path) }
    }

    @Test
    fun `retention prunes completed chains together with their events but preserves active chains`() = runBlocking {
        val database = memoryDatabase()
        try {
            var time = 1L
            val controller = ExecutionTraceController(DatabaseCase(database), retainedExecutions = 2, now = { time++ })
            val active = controller.start(ExecutionTraceInput("qq", "active"))
            val old = controller.start(ExecutionTraceInput("qq", "old"))
            old.complete(ExecutionStatus.SUCCEEDED)
            val fresh = controller.start(ExecutionTraceInput("qq", "fresh"))
            assertNull(controller.detail(old.id))
            assertNotNull(controller.detail(active.id))
            assertNotNull(controller.detail(fresh.id))
            assertEquals(2L, controller.list().total)
        } finally { database.stop() }
    }

    private fun memoryDatabase() = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
}
