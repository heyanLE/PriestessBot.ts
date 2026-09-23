package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.observability.MetricsRegistry
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class ToolExecutorTest {
    @Test
    fun `external cancellation is propagated instead of becoming an error result`() = runBlocking {
        val registry = ToolController().apply { register(FakeTool(failure = CancellationException("cancelled by caller"))) }
        assertFailsWith<CancellationException> {
            ToolExecutor(registry).execute(AgentToolContext(), "fake_tool", """{"value":"abc"}""")
        }
    }

    @Test
    fun `parent timeout is not mistaken for the tools own timeout`() = runBlocking {
        val registry = ToolController().apply { register(FakeTool(delayMs = 1_000)) }
        assertFailsWith<TimeoutCancellationException> {
            withTimeout(20) {
                ToolExecutor(registry).execute(AgentToolContext(), "fake_tool", """{"value":"abc"}""", timeoutMillis = 5_000)
            }
        }
    }

    @Test
    fun `unknown tool returns error result`() = runBlocking {
        val executor = ToolExecutor(ToolController())

        val result = executor.execute(AgentToolContext(), "missing_tool", "{}")

        assertFalse(result.success)
        assertEquals("Unknown tool: missing_tool", result.error)
    }

    @Test
    fun `malformed arguments return error and skip tool invocation`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool()
        controller.register(tool)
        val executor = ToolExecutor(controller)

        val result = executor.execute(AgentToolContext(), "fake_tool", "{not-json")

        assertFalse(result.success)
        assertTrue(result.error.contains("Failed to parse arguments"))
        assertEquals(emptyList(), tool.calls)
    }

    @Test
    fun `schema invalid arguments return error and skip tool invocation`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool()
        controller.register(tool)
        val executor = ToolExecutor(controller)

        val result = executor.execute(AgentToolContext(), "fake_tool", "{}")

        assertFalse(result.success)
        assertEquals("Missing required parameter(s) for tool 'fake_tool': value", result.error)
        assertEquals(emptyList(), tool.calls)
    }

    @Test
    fun `permission denied policy skips tool invocation`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool()
        controller.register(tool)
        val executor = ToolExecutor(
            registry = controller,
            policy = ToolPolicy { _, _, _ ->
                ToolPolicyDecision.denied(
                    code = ToolPolicyDenialCode.DISABLED_TOOL,
                    message = "tool disabled by policy",
                )
            },
        )

        val result = executor.execute(AgentToolContext(), "fake_tool", """{"value":"abc"}""")

        assertFalse(result.success)
        assertEquals("PERMISSION_DENIED[DISABLED_TOOL]: tool disabled by policy", result.error)
        assertEquals("PERMISSION_DENIED", result.errorCode)
        assertEquals(ToolPolicyDenialCode.DISABLED_TOOL, result.policyDenialCode)
        assertEquals(emptyList(), tool.calls)
    }

    @Test
    fun `insufficient sender permission skips tool invocation`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool(
            schema = ToolSchema(
                name = "admin_tool",
                parameters = ToolParameters(required = listOf("value")),
                requiredPermissionGroup = PermissionGroup.ADMIN,
            ),
        )
        controller.register(tool)

        val result = ToolExecutor(controller).execute(
            AgentToolContext(permissionGroup = PermissionGroup.OPERATOR),
            "admin_tool",
            """{"value":"abc"}""",
        )

        assertFalse(result.success)
        assertEquals("PERMISSION_DENIED", result.errorCode)
        assertEquals(ToolPolicyDenialCode.INSUFFICIENT_PERMISSION, result.policyDenialCode)
        assertTrue(result.error.contains("current=OPERATOR required=ADMIN"))
        assertTrue(tool.calls.isEmpty())
    }

    @Test
    fun `Agent tool minimum permission can raise but not lower a tool requirement`() = runBlocking {
        val controller = ToolController()
        val ordinary = FakeTool(name = "ordinary_tool")
        val admin = FakeTool(schema = ToolSchema(name = "admin_tool", requiredPermissionGroup = PermissionGroup.ADMIN))
        controller.registerAll(listOf(ordinary, admin))
        val executor = ToolExecutor(controller)

        val raised = executor.execute(
            AgentToolContext(
                permissionGroup = PermissionGroup.OPERATOR,
                minimumToolPermissionGroups = mapOf("ordinary_tool" to PermissionGroup.ADMIN),
            ),
            "ordinary_tool",
            """{"value":"abc"}""",
        )
        val loweredAttempt = executor.execute(
            AgentToolContext(
                permissionGroup = PermissionGroup.OPERATOR,
                minimumToolPermissionGroups = mapOf("admin_tool" to PermissionGroup.OPERATOR),
            ),
            "admin_tool",
            "{}",
        )

        assertEquals(ToolPolicyDenialCode.INSUFFICIENT_PERMISSION, raised.policyDenialCode)
        assertTrue(raised.error.contains("required=ADMIN"))
        assertEquals(ToolPolicyDenialCode.INSUFFICIENT_PERMISSION, loweredAttempt.policyDenialCode)
        assertTrue(loweredAttempt.error.contains("required=ADMIN"))
        assertTrue(ordinary.calls.isEmpty())
        assertTrue(admin.calls.isEmpty())
    }

    @Test
    fun `workspace scoped tools deny calls outside pinned workspace list`() = runBlocking {
        val controller = ToolController()
        val allowed = FakeTool(name = "allowed_tool")
        val denied = FakeTool(name = "denied_tool")
        controller.registerAll(listOf(allowed, denied))
        val executor = ToolExecutor(controller)

        val result = executor.execute(
            context = AgentToolContext(metadata = mapOf("workspace_tool_names" to "allowed_tool")),
            toolCallName = "denied_tool",
            argumentsJson = """{"value":"abc"}""",
        )

        assertFalse(result.success)
        assertEquals("PERMISSION_DENIED", result.errorCode)
        assertEquals(ToolPolicyDenialCode.DISABLED_TOOL, result.policyDenialCode)
        assertEquals("PERMISSION_DENIED[DISABLED_TOOL]: Tool 'denied_tool' is not enabled in workspace", result.error)
        assertEquals(emptyList(), denied.calls)
        assertEquals(emptyList(), allowed.calls)
    }

    @Test
    fun `workspace scoped tool executes without global registration`() = runBlocking {
        val controller = ToolController()
        val scoped = FakeTool(name = "workspace_mcp_tool", result = ToolResult.success("workspace output"))
        val executor = ToolExecutor(controller)

        val result = executor.execute(
            context = AgentToolContext(
                metadata = mapOf("workspace_tool_names" to "workspace_mcp_tool"),
                scopedTools = listOf(scoped),
            ),
            toolCallName = "workspace_mcp_tool",
            argumentsJson = """{"value":"abc"}""",
        )

        assertTrue(result.success)
        assertEquals("workspace output", result.output)
        assertEquals(listOf(mapOf("value" to "abc")), scoped.calls)
    }

    @Test
    fun `tool timeout returns error result`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool(delayMs = 100)
        controller.register(tool)
        val executor = ToolExecutor(controller, defaultTimeoutMillis = 10)

        val result = executor.execute(AgentToolContext(), "fake_tool", """{"value":"abc"}""")

        assertFalse(result.success)
        assertEquals("Tool 'fake_tool' timed out after 10ms", result.error)
        assertEquals("TIMEOUT", result.errorCode)
        assertEquals(listOf(mapOf("value" to "abc")), tool.calls)
    }

    @Test
    fun `tool execution exception is converted to error result`() = runBlocking {
        val controller = ToolController()
        val tool = FakeTool(failure = IllegalStateException("boom"))
        controller.register(tool)
        val executor = ToolExecutor(controller)

        val result = executor.execute(AgentToolContext(), "fake_tool", """{"value":"abc"}""")

        assertFalse(result.success)
        assertEquals("Tool 'fake_tool' execution failed: boom", result.error)
        assertEquals(listOf(mapOf("value" to "abc")), tool.calls)
    }

    @Test
    fun `batch execution preserves order and partial failures`() = runBlocking {
        val controller = ToolController()
        val success = FakeTool(name = "success_tool", result = ToolResult.success("ok"))
        val failure = FakeTool(name = "failure_tool", result = ToolResult.error("bad"))
        controller.registerAll(listOf(success, failure))
        val executor = ToolExecutor(controller)

        val results = executor.executeBatch(
            AgentToolContext(),
            listOf(
                Triple("1", "success_tool", """{"value":"a"}"""),
                Triple("2", "failure_tool", """{"value":"b"}"""),
                Triple("3", "missing_tool", "{}"),
            ),
        )

        assertEquals(listOf("1", "2", "3"), results.keys.toList())
        assertEquals("ok", results["1"]?.output)
        assertEquals("bad", results["2"]?.error)
        assertEquals("Unknown tool: missing_tool", results["3"]?.error)
        assertEquals(listOf(mapOf("value" to "a")), success.calls)
        assertEquals(listOf(mapOf("value" to "b")), failure.calls)
    }

    @Test
    fun `metrics include success failure and unknown tool calls without arguments`() = runBlocking {
        val metrics = MetricsRegistry()
        val controller = ToolController()
        controller.register(FakeTool(name = "success_tool", result = ToolResult.success("ok")))
        controller.register(FakeTool(name = "failure_tool", result = ToolResult.error("bad")))
        controller.register(FakeTool(name = "timeout_tool", delayMs = 100))
        val observabilityCase = ObservabilityCase.standalone(metrics)
        val executor = ToolExecutor(controller, observabilityCase, defaultTimeoutMillis = 10)
        val deniedExecutor = ToolExecutor(
            registry = controller,
            observabilityCase = observabilityCase,
            policy = ToolPolicy { _, tool, _ ->
                if (tool.schema.name == "denied_tool") {
                    ToolPolicyDecision.denied(
                        code = ToolPolicyDenialCode.DISABLED_TOOL,
                        message = "denied",
                    )
                } else {
                    ToolPolicyDecision.allowed()
                }
            },
        )
        controller.register(FakeTool(name = "denied_tool"))

        executor.execute(AgentToolContext(), "success_tool", """{"value":"secret"}""")
        executor.execute(AgentToolContext(), "failure_tool", """{"value":"secret"}""")
        executor.execute(AgentToolContext(), "timeout_tool", """{"value":"secret"}""")
        deniedExecutor.execute(AgentToolContext(), "denied_tool", """{"value":"secret"}""")
        executor.execute(AgentToolContext(), "missing_tool", "{}")

        val rendered = metrics.renderPrometheus()
        assertTrue(rendered.contains("""priestess_tool_calls_total{status="success",tool="success_tool"} 1"""))
        assertTrue(rendered.contains("""priestess_tool_calls_total{status="error",tool="failure_tool"} 1"""))
        assertTrue(rendered.contains("""priestess_tool_calls_total{status="timeout",tool="timeout_tool"} 1"""))
        assertTrue(rendered.contains("""priestess_tool_calls_total{status="permission_denied",tool="denied_tool"} 1"""))
        assertTrue(rendered.contains("""priestess_tool_calls_total{status="error",tool="missing_tool"} 1"""))
        assertFalse(rendered.contains("secret"))
    }
}
