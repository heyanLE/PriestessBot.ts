package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.observability.trace.ExecutionStatus
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceController
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceInput
import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.ToolResult
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CodexTurnExecutorTest {
    @Test
    fun `one accepted turn returns its final message and acknowledges events`() = runBlocking {
        val port = FakePort(ArrayDeque(listOf(
            event(1, """{"type":"session_configured"}"""),
            event(2, """{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Done"}"""),
        )))
        val response = CodexTurnExecutor(port).run("thread-1", "hello")
        assertEquals("Done", assertIs<AgentResponse.Final>(response).content)
        assertEquals(listOf(1L, 2L), port.acknowledged)
        val request = Json.parseToJsonElement(port.submitted).jsonObject
        assertEquals("start_if_idle", request["mode"]!!.jsonPrimitive.content)
        assertTrue(request["dynamic_tools"]!!.jsonArray.isEmpty())
        assertEquals("hello", request["input"]!!.jsonArray.single().jsonObject["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun `unexpected dynamic call is denied and the turn is interrupted`() = runBlocking {
        val port = FakePort(ArrayDeque(listOf(
            event(1, """{"type":"dynamic_tool_call_request","callId":"call-1","turnId":"turn-1","tool":"write_file","arguments":{}}"""),
        )))
        val response = CodexTurnExecutor(port).run("thread-1", "write")
        assertIs<AgentResponse.Error>(response)
        assertEquals(listOf(1L), port.acknowledged)
        assertEquals(listOf("thread-1"), port.interrupted)
        assertEquals("false", Json.parseToJsonElement(port.deniedResponse).jsonObject["success"]!!.jsonPrimitive.content)
    }

    @Test
    fun `native command approval is denied for an unbridged turn`() = runBlocking {
        val port = FakePort(ArrayDeque(listOf(
            event(1, """{"type":"exec_approval_request","call_id":"exec-1","turn_id":"turn-1"}"""),
        )))
        val response = CodexTurnExecutor(port).run("thread-1", "run a command")
        assertIs<AgentResponse.Error>(response)
        assertEquals("false", Json.parseToJsonElement(port.reviewRequest).jsonObject["approved"]!!.jsonPrimitive.content)
        assertEquals(listOf("thread-1"), port.interrupted)
        assertEquals(listOf(1L), port.acknowledged)
    }

    @Test
    fun `declared tool executes through ToolCase and returns a model-visible result`() = runBlocking {
        val tool = FakeTool(name = "lookup")
        val toolCase = ToolCase(ToolController().apply { register(tool) })
        val context = AgentContext(
            agent = Agent("agent", "Use lookup", "model", type = AgentType.CODEX, effectiveToolIds = setOf("lookup")),
            conversationId = "conversation", platform = null, session = null, messages = mutableListOf(),
            metadata = mapOf("workspaceId" to "workspace"),
        )
        val dispatcher = CodexToolDispatcher(context, toolCase)
        val port = FakePort(ArrayDeque(listOf(
            event(1, """{"type":"dynamic_tool_call_request","callId":"call-1","turnId":"turn-1","tool":"lookup","arguments":{"value":"Paris"}}"""),
            event(2, """{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Done"}"""),
        )))
        val response = CodexTurnExecutor(port, tools = dispatcher).run("thread-1", "look up Paris")
        assertEquals("Done", assertIs<AgentResponse.Final>(response).content)
        assertEquals("Paris", tool.calls.single()["value"])
        assertEquals("true", Json.parseToJsonElement(port.deniedResponse).jsonObject["success"]!!.jsonPrimitive.content)
        assertTrue(port.interrupted.isEmpty())
        assertEquals(listOf(1L, 2L), port.acknowledged)
        assertEquals("lookup", Json.parseToJsonElement(port.submitted).jsonObject["dynamic_tools"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `caller role and turn id both restrict native tool callbacks`() = runBlocking {
        val tool = FakeTool(schema = ToolSchema("restricted", requiredPermissionGroup = PermissionGroup.ADMIN))
        val toolCase = ToolCase(ToolController().apply { register(tool) })
        val context = AgentContext(
            agent = Agent("agent", "", "model", type = AgentType.CODEX, effectiveToolIds = setOf("restricted")),
            conversationId = "conversation", platform = null, session = null, messages = mutableListOf(),
            metadata = mapOf("workspaceId" to "workspace"), permissionGroup = PermissionGroup.OPERATOR,
        )
        val dispatcher = CodexToolDispatcher(context, toolCase)
        assertTrue(dispatcher.dynamicTools.isEmpty())
        val port = FakePort(ArrayDeque(listOf(
            event(1, """{"type":"dynamic_tool_call_request","callId":"call-1","turnId":"another-turn","tool":"restricted","arguments":{}}"""),
        )))
        assertIs<AgentResponse.Error>(CodexTurnExecutor(port, tools = dispatcher).run("thread-1", "run restricted"))
        assertTrue(tool.calls.isEmpty())
        assertEquals("", port.deniedResponse)
        assertEquals(listOf("thread-1"), port.interrupted)
    }

    @Test
    fun `duplicate native call id cannot execute the same tool twice`() = runBlocking {
        val tool = FakeTool(name = "lookup")
        val dispatcher = CodexToolDispatcher(AgentContext(
            agent = Agent("agent", "", "model", type = AgentType.CODEX, effectiveToolIds = setOf("lookup")),
            conversationId = "conversation", platform = null, session = null, messages = mutableListOf(),
            metadata = mapOf("workspaceId" to "workspace"),
        ), ToolCase(ToolController().apply { register(tool) }))
        val request = """{"type":"dynamic_tool_call_request","callId":"call-1","turnId":"turn-1","tool":"lookup","arguments":{"value":"Paris"}}"""
        val port = FakePort(ArrayDeque(listOf(event(1, request), event(2, request))))
        assertIs<AgentResponse.Error>(CodexTurnExecutor(port, tools = dispatcher).run("thread-1", "lookup"))
        assertEquals(1, tool.calls.size)
        assertEquals("false", Json.parseToJsonElement(port.deniedResponse).jsonObject["success"]!!.jsonPrimitive.content)
        assertEquals(listOf("thread-1"), port.interrupted)
    }

    @Test
    fun `turn timeout interrupts the native thread`() = runBlocking {
        val port = FakePort(ArrayDeque(), pollDelayMillis = 1_000)
        val response = CodexTurnExecutor(port, timeoutMillis = 20).run("thread-1", "wait")
        assertTrue(assertIs<AgentResponse.Error>(response).message.contains("timed out"))
        assertEquals(listOf("thread-1"), port.interrupted)
    }

    @Test
    fun `timeout during an allowed tool still acknowledges its native event`() = runBlocking {
        val slow = object : FunctionTool() {
            override val schema = ToolSchema(name = "slow")
            override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
                delay(1_000)
                return ToolResult.success("done")
            }
        }
        val dispatcher = CodexToolDispatcher(AgentContext(
            agent = Agent("agent", "", "model", type = AgentType.CODEX, effectiveToolIds = setOf("slow")),
            conversationId = "conversation", platform = null, session = null, messages = mutableListOf(),
        ), ToolCase(ToolController().apply { register(slow) }))
        val port = FakePort(ArrayDeque(listOf(event(1,
            """{"type":"dynamic_tool_call_request","callId":"call-1","turnId":"turn-1","tool":"slow","arguments":{}}"""))))
        val response = CodexTurnExecutor(port, timeoutMillis = 30, tools = dispatcher).run("thread-1", "slow")
        assertTrue(assertIs<AgentResponse.Error>(response).message.contains("timed out"))
        assertEquals(listOf(1L), port.acknowledged)
        assertEquals(listOf("thread-1"), port.interrupted)
    }

    @Test
    fun `old turn tool request is acknowledged but never answered as the new turn`() = runBlocking {
        val port = FakePort(ArrayDeque(listOf(event(1,
            """{"type":"dynamic_tool_call_request","callId":"old-call","turnId":"old-turn","tool":"lookup","arguments":{}}"""))))
        assertIs<AgentResponse.Error>(CodexTurnExecutor(port).run("thread-1", "new turn"))
        assertEquals(listOf(1L), port.acknowledged)
        assertEquals("", port.deniedResponse)
    }

    @Test
    fun `native events appear in execution trace without a fabricated ChatProvider call`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val controller = ExecutionTraceController(DatabaseCase(database))
            val trace = controller.start(ExecutionTraceInput("telegram", "session", input = "hello"))
            val port = FakePort(ArrayDeque(listOf(
                event(1, """{"type":"agent_message","message":"Done"}"""),
                event(2, """{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Done"}"""),
            )))
            val response = CodexTurnExecutor(port, trace = trace).run("thread-1", "hello")
            assertIs<AgentResponse.Final>(response)
            trace.complete(ExecutionStatus.SUCCEEDED, response.content)
            val events = controller.detail(trace.id)!!.events
            assertTrue(events.any { it.type == "codex.turn.started" })
            assertTrue(events.any { it.type == "codex.event" })
            assertTrue(events.any { it.type == "codex.turn.finished" })
            assertTrue(events.none { it.type == "llm.request" || it.type == "llm.response" })
        } finally {
            database.stop()
        }
    }

    private fun event(sequence: Int, message: String) = """{"status":"event","sequence":$sequence,"event":{"id":"turn-1","msg":$message}}"""

    private class FakePort(private val events: ArrayDeque<String>, private val pollDelayMillis: Long = 0) : CodexNativePort {
        var submitted = ""
        var deniedResponse = ""
        var reviewRequest = ""
        val acknowledged = mutableListOf<Long>()
        val interrupted = mutableListOf<String>()

        override suspend fun startThread(paramsJson: String): String = error("Unused")
        override suspend fun resumeThread(paramsJson: String): String = error("Unused")
        override suspend fun submitTurn(threadId: String, requestJson: String): String {
            submitted = requestJson
            return """{"status":"started","turn_id":"turn-1"}"""
        }
        override suspend fun pollEvent(threadId: String, timeoutMillis: Int): String {
            if (pollDelayMillis > 0) delay(pollDelayMillis)
            return events.removeFirst()
        }
        override suspend fun ackEvent(threadId: String, sequence: Long) = withContext(Dispatchers.IO) {
            acknowledged += sequence
        }
        override suspend fun dynamicToolResponse(threadId: String, callId: String, responseJson: String) { deniedResponse = responseJson }
        override suspend fun reviewDecision(threadId: String, requestJson: String) { reviewRequest = requestJson }
        override suspend fun interrupt(threadId: String) { interrupted += threadId }
        override fun close() = Unit
    }
}
