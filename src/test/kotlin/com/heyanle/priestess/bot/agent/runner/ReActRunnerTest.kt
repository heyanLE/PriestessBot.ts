package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentHooks
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.AgentState
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import com.heyanle.priestess.bot.testkit.FakeProvider
import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.testkit.testAgent
import com.heyanle.priestess.bot.testkit.testAgentContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolExecutor
import com.heyanle.priestess.bot.tool.ToolPolicy
import com.heyanle.priestess.bot.tool.ToolPolicyDecision
import com.heyanle.priestess.bot.tool.ToolPolicyDenialCode
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.builtin.UnloadSkillTool
import com.heyanle.priestess.bot.tool.builtin.UseSkillTool
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ReActRunnerTest {
    @Test
    fun `response annotations survive separate tool rounds and reset between runs`() = runBlocking {
        val context = testAgentContext()
        var invocations = 0
        val tool = object : FunctionTool() {
            override val schema = ToolSchema(name = "mark", description = "Mark the final reply")
            override suspend fun execute(context: com.heyanle.priestess.bot.tool.AgentToolContext, args: Map<String, String>): ToolResult {
                context.responseIntent.mention(if (invocations++ == 0) "123" else "456")
                return ToolResult.success("marked")
            }
        }
        val provider = FakeProvider(listOf(
            LLMResponse(content = "working", toolCalls = listOf(ToolCall("1", "mark", "{}"))),
            LLMResponse(content = "still working", toolCalls = listOf(ToolCall("2", "mark", "{}"))),
            LLMResponse(content = "final", finishReason = "stop"),
        ))
        val runner = runner(context, provider, listOf(tool))
        assertEquals(AgentResponse.Final("final"), runner.stepUntilDone())
        assertEquals(listOf("123", "456"), context.responseIntent.snapshot().mentions)
        assertTrue(testAgentContext().responseIntent.snapshot().mentions.isEmpty())
        runner.reset()
        assertTrue(context.responseIntent.snapshot().mentions.isEmpty())
    }

    @Test
    fun `provider receives system then examples history and current user in order`() = runBlocking {
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val context = testAgentContext(
            messages = mutableListOf(
                ConversationMessage.user("Example user"),
                ConversationMessage.assistant("Example assistant"),
                ConversationMessage.user("History user"),
                ConversationMessage.assistant("History assistant"),
                ConversationMessage.user("Current user"),
            ),
        )

        runner(context, provider).stepUntilDone()

        val messages = provider.requests.single().messages
        assertEquals(listOf("system", "user", "assistant", "user", "assistant", "user"), messages.map { it.role })
        assertEquals(
            listOf("Example user", "Example assistant", "History user", "History assistant", "Current user"),
            messages.drop(1).map { it.content },
        )
    }

    @Test
    fun `returns final response when provider does not request tools`() = runBlocking {
        val context = testAgentContext()
        val runner = runner(
            context = context,
            provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop"))),
        )

        val response = runner.stepUntilDone()

        assertEquals(AgentResponse.Final("done"), response)
        assertEquals(AgentState.DONE, runner.state)
        assertEquals("system", context.messages.first().role)
        assertEquals("assistant", context.messages.last().role)
        assertEquals("done", context.messages.last().content)
    }

    @Test
    fun `uses Agent generation settings in every provider request`() = runBlocking {
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val context = testAgentContext(
            agent = testAgent().copy(temperature = 0.2, maxOutputTokens = 1234),
        )

        runner(context, provider).stepUntilDone()

        assertEquals(0.2, provider.requests.single().temperature)
        assertEquals(1234, provider.requests.single().maxTokens)
    }

    @Test
    fun `executes tool call then continues to final response`() = runBlocking {
        val tool = FakeTool(result = ToolResult.success("observed"))
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    content = "need tool",
                    toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}""")),
                ),
                LLMResponse(content = "final after tool", finishReason = "stop"),
            ),
        )
        val context = testAgentContext()

        val response = runner(context, provider, listOf(tool)).stepUntilDone()

        assertEquals(AgentResponse.Final("final after tool"), response)
        assertEquals(listOf(mapOf("value" to "abc")), tool.calls)
        assertTrue(context.messages.any { it.role == "assistant" && it.toolCalls?.firstOrNull()?.name == "fake_tool" })
        assertTrue(context.messages.any { it.role == "tool" && it.toolCallId == "call-1" && it.content == "observed" })
        assertEquals(2, provider.requests.size)
    }

    @Test
    fun `materializes oversized registered tool output before the next provider request`() = runBlocking {
        val root = Files.createTempDirectory("react-registered-overflow-")
        val store = ToolResultOverflowStore(root)
        try {
            val content = "registered-output-".repeat(80)
            val tool = FakeTool(result = ToolResult.success(content))
            val provider = FakeProvider(
                listOf(
                    LLMResponse(toolCalls = listOf(ToolCall("call-1", "fake_tool", """{"value":"abc"}"""))),
                    LLMResponse(content = "done", finishReason = "stop"),
                ),
            )
            val context = testAgentContext(
                agent = testAgent().copy(
                    toolResultInlineTokens = 10,
                    toolResultPreviewTokens = 3,
                ),
            )

            runner(context, provider, listOf(tool), overflowStore = store).stepUntilDone()

            val observation = context.messages.single { it.role == "tool" }.content.orEmpty()
            val resultId = requireNotNull(Regex("result_id=([A-Za-z0-9-]+)").find(observation)?.groupValues?.get(1))
            assertTrue(observation.contains("TOOL_RESULT_OVERFLOW"))
            assertFalse(observation.contains(content))
            assertEquals(content, store.read(context.conversationId, resultId)?.content)
            assertEquals(observation, provider.requests[1].messages.single { it.role == "tool" }.content)
        } finally {
            store.close()
        }
    }

    @Test
    fun `materializes oversized failure from a scoped MCP-style tool`() = runBlocking {
        val root = Files.createTempDirectory("react-scoped-overflow-")
        val store = ToolResultOverflowStore(root)
        try {
            val error = "remote MCP failure ".repeat(80)
            val tool = FakeTool(name = "workspace_mcp_tool", result = ToolResult.error(error, "MCP_FAILURE"))
            val provider = FakeProvider(
                listOf(
                    LLMResponse(toolCalls = listOf(ToolCall("call-1", "workspace_mcp_tool", """{"value":"abc"}"""))),
                    LLMResponse(content = "handled", finishReason = "stop"),
                ),
            )
            val context = testAgentContext(
                agent = testAgent().copy(
                    toolResultInlineTokens = 10,
                    toolResultPreviewTokens = 3,
                ),
                metadata = mapOf("workspaceToolNames" to "workspace_mcp_tool"),
                scopedTools = listOf(tool),
            )

            runner(context, provider, overflowStore = store).stepUntilDone()

            val observation = context.messages.single { it.role == "tool" }.content.orEmpty()
            val resultId = requireNotNull(Regex("result_id=([A-Za-z0-9-]+)").find(observation)?.groupValues?.get(1))
            assertTrue(observation.contains("status=error"))
            assertTrue(observation.contains("error_code=MCP_FAILURE"))
            assertEquals(error, store.read(context.conversationId, resultId)?.content)
        } finally {
            store.close()
        }
    }

    @Test
    fun `bounds source-truncated output when overflow storage cannot accept it`() = runBlocking {
        val root = Files.createTempDirectory("react-unavailable-overflow-")
        val store = ToolResultOverflowStore(root)
        try {
            val content = """{"truncated":true,"text":"${"x".repeat(400)}"}"""
            val tool = FakeTool(result = ToolResult.success(content))
            val provider = FakeProvider(
                listOf(
                    LLMResponse(toolCalls = listOf(ToolCall("call-1", "fake_tool", """{"value":"abc"}"""))),
                    LLMResponse(content = "done", finishReason = "stop"),
                ),
            )
            val context = testAgentContext(
                agent = testAgent().copy(
                    toolResultInlineTokens = 10,
                    toolResultPreviewTokens = 3,
                    toolResultMaxBytes = 8,
                    toolResultStoreMaxBytes = 8,
                ),
            )

            runner(context, provider, listOf(tool), overflowStore = store).stepUntilDone()

            val observation = context.messages.single { it.role == "tool" }.content.orEmpty()
            assertTrue(observation.contains("TOOL_RESULT_OVERFLOW_UNAVAILABLE"))
            assertTrue(observation.contains("source_truncated=true"))
            assertFalse(observation.contains(content))
        } finally {
            store.close()
        }
    }

    @Test
    fun `only exposes workspace scoped tools to provider`() = runBlocking {
        val allowedTool = FakeTool(name = "allowed_tool")
        val hiddenTool = FakeTool(name = "hidden_tool")
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val context = testAgentContext(
            metadata = mapOf("workspaceToolNames" to "allowed_tool"),
        )

        runner(context, provider, listOf(allowedTool, hiddenTool)).stepUntilDone()

        val exposedToolNames = provider.requests.single().tools.mapNotNull {
            it["function"]?.toString()?.let { function -> Regex(""""name":"([^"]+)"""").find(function)?.groupValues?.get(1) }
        }
        assertEquals(listOf("allowed_tool"), exposedToolNames)
    }

    @Test
    fun `operator does not see administrator or super administrator tools`() = runBlocking {
        val adminTool = FakeTool(
            schema = ToolSchema(
                name = "admin_tool",
                description = "Administrator operation.",
                requiredPermissionGroup = PermissionGroup.ADMIN,
            ),
        )
        val superAdminTool = FakeTool(
            schema = ToolSchema(
                name = "super_admin_tool",
                description = "Super administrator operation.",
                requiredPermissionGroup = PermissionGroup.SUPER_ADMIN,
            ),
        )
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))

        runner(
            context = testAgentContext(
                agent = testAgent().copy(strictPermissionToolFiltering = true),
            ).copy(permissionGroup = PermissionGroup.OPERATOR),
            provider = provider,
            tools = listOf(adminTool, superAdminTool),
        ).stepUntilDone()

        val exposedTools = provider.requests.single().tools.joinToString()
        assertFalse(exposedTools.contains("admin_tool"))
        assertFalse(exposedTools.contains("super_admin_tool"))
    }

    @Test
    fun `exposes and executes workspace scoped tool without global registration`() = runBlocking {
        val scopedTool = FakeTool(name = "workspace_mcp_tool", result = ToolResult.success("workspace observed"))
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    toolCalls = listOf(
                        ToolCall(id = "call-1", name = "workspace_mcp_tool", arguments = """{"value":"abc"}"""),
                    ),
                ),
                LLMResponse(content = "final after workspace tool", finishReason = "stop"),
            ),
        )
        val context = testAgentContext(
            metadata = mapOf("workspaceToolNames" to "workspace_mcp_tool"),
            scopedTools = listOf(scopedTool),
        )

        val response = runner(context, provider).stepUntilDone()

        assertEquals(AgentResponse.Final("final after workspace tool"), response)
        val exposedToolNames = provider.requests.first().tools.mapNotNull {
            it["function"]?.toString()?.let { function -> Regex(""""name":"([^"]+)"""").find(function)?.groupValues?.get(1) }
        }
        assertEquals(listOf("workspace_mcp_tool"), exposedToolNames)
        assertEquals(listOf(mapOf("value" to "abc")), scopedTool.calls)
        assertTrue(context.messages.any { it.role == "tool" && it.content == "workspace observed" })
    }

    @Test
    fun `use skill tool loads skill markdown into later system prompt`() = runBlocking {
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    toolCalls = listOf(
                        ToolCall(id = "call-1", name = "use_skill", arguments = """{"name":"research"}"""),
                    ),
                ),
                LLMResponse(content = "used skill", finishReason = "stop"),
            ),
        )
        val context = testAgentContext(
            skillState = PipelineSkillState(
                listOf(
                    SkillPromptReference(
                        name = "research",
                        inlineMarkdown = "# Skill: research\n\nFollow the research workflow.",
                    ),
                ),
            ),
        )

        val response = runner(context, provider, listOf(UseSkillTool())).stepUntilDone()

        assertEquals(AgentResponse.Final("used skill"), response)
        assertEquals(2, provider.requests.size)
        val secondSystem = provider.requests[1].messages.first { it.role == "system" }.content.orEmpty()
        assertTrue(secondSystem.contains("# Skill: research"))
        assertTrue(secondSystem.contains("Follow the research workflow."))
    }

    @Test
    fun `unload skill tool removes skill markdown from later system prompt`() = runBlocking {
        val provider = FakeProvider(
            listOf(
                LLMResponse(
                    toolCalls = listOf(
                        ToolCall(id = "call-1", name = "use_skill", arguments = """{"name":"research"}"""),
                    ),
                ),
                LLMResponse(
                    toolCalls = listOf(
                        ToolCall(id = "call-2", name = "unload_skill", arguments = """{"name":"research"}"""),
                    ),
                ),
                LLMResponse(content = "skill unloaded", finishReason = "stop"),
            ),
        )
        val context = testAgentContext(
            skillState = PipelineSkillState(
                listOf(
                    SkillPromptReference(
                        name = "research",
                        inlineMarkdown = "# Skill: research\n\nFollow the research workflow.",
                    ),
                ),
            ),
        )

        val response = runner(context, provider, listOf(UseSkillTool(), UnloadSkillTool())).stepUntilDone()

        assertEquals(AgentResponse.Final("skill unloaded"), response)
        assertEquals(3, provider.requests.size)
        val afterLoad = provider.requests[1].messages.first { it.role == "system" }.content.orEmpty()
        val afterUnload = provider.requests[2].messages.first { it.role == "system" }.content.orEmpty()
        assertTrue(afterLoad.contains("# Skill: research"))
        assertFalse(afterUnload.contains("# Skill: research"))
        assertTrue(afterUnload.contains("No skills loaded."))
    }

    @Test
    fun `converts tool execution failure into failed observation and continues`() = runBlocking {
        val tool = FakeTool(result = ToolResult.error("tool denied"))
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}"""))),
                LLMResponse(content = "handled failure", finishReason = "stop"),
            ),
        )

        val response = runner(context, provider, listOf(tool)).stepUntilDone()

        assertEquals(AgentResponse.Final("handled failure"), response)
        assertTrue(context.messages.any { it.role == "tool" && it.content == "tool denied" })
    }

    @Test
    fun `converts tool executor exception into failed observation and continues`() = runBlocking {
        val tool = FakeTool()
        val context = testAgentContext()
        val provider = FakeProvider(
            listOf(
                LLMResponse(toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}"""))),
                LLMResponse(content = "handled executor failure", finishReason = "stop"),
            ),
        )
        val controller = ToolController().also { it.register(tool) }
        val executor = ToolExecutor(
            registry = controller,
            policy = ToolPolicy { _, _, _ -> error("policy exploded") },
        )

        val response = runner(
            context = context,
            provider = provider,
            tools = listOf(tool),
            toolExecutor = executor,
        ).stepUntilDone()

        assertEquals(AgentResponse.Final("handled executor failure"), response)
        assertEquals(emptyList(), tool.calls)
        assertTrue(context.messages.any { it.role == "tool" && it.toolCallId == "call-1" && it.content == "Tool execution failed: policy exploded" })
    }

    @Test
    fun `uses agent tool timeout for tool calls`() = runBlocking {
        val tool = FakeTool(delayMs = 100)
        val context = testAgentContext(agent = testAgent(toolTimeoutMs = 10))
        val observedToolResults = mutableListOf<AgentResponse.ToolExecuted>()
        val provider = FakeProvider(
            listOf(
                LLMResponse(toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}"""))),
                LLMResponse(content = "handled timeout", finishReason = "stop"),
            ),
        )

        val response = runner(
            context = context,
            provider = provider,
            tools = listOf(tool),
            toolExecutor = ToolExecutor(ToolController().also { it.register(tool) }, defaultTimeoutMillis = 30_000),
            hooks = recordingHooks(observedToolResults),
        ).stepUntilDone()

        assertEquals(AgentResponse.Final("handled timeout"), response)
        val toolResult = observedToolResults.single().toolResult
        assertEquals("TIMEOUT", toolResult.errorCode)
        assertEquals("Tool 'fake_tool' timed out after 10ms", toolResult.error)
        assertTrue(context.messages.any { it.role == "tool" && it.content == toolResult.error })
    }

    @Test
    fun `tool hooks include structured policy denial result`() = runBlocking {
        val tool = FakeTool()
        val context = testAgentContext()
        val observedToolResults = mutableListOf<AgentResponse.ToolExecuted>()
        val provider = FakeProvider(
            listOf(
                LLMResponse(toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}"""))),
                LLMResponse(content = "handled denial", finishReason = "stop"),
            ),
        )
        val controller = ToolController().also { it.register(tool) }
        val executor = ToolExecutor(
            registry = controller,
            policy = ToolPolicy { _, _, _ ->
                ToolPolicyDecision.denied(
                    code = ToolPolicyDenialCode.DISABLED_TOOL,
                    message = "disabled for this agent",
                )
            },
        )

        val response = runner(
            context = context,
            provider = provider,
            tools = listOf(tool),
            toolExecutor = executor,
            hooks = recordingHooks(observedToolResults),
        ).stepUntilDone()

        assertEquals(AgentResponse.Final("handled denial"), response)
        assertEquals(emptyList(), tool.calls)
        val toolResult = observedToolResults.single().toolResult
        assertEquals("PERMISSION_DENIED", toolResult.errorCode)
        assertEquals(ToolPolicyDenialCode.DISABLED_TOOL, toolResult.policyDenialCode)
        assertEquals("PERMISSION_DENIED[DISABLED_TOOL]: disabled for this agent", toolResult.error)
    }

    @Test
    fun `returns error when provider throws`() = runBlocking {
        val runner = runner(
            context = testAgentContext(),
            provider = FakeProvider(failure = IllegalStateException("provider down")),
        )

        val response = runner.stepUntilDone()

        val error = assertIs<AgentResponse.Error>(response)
        assertEquals("provider down", error.message)
        assertEquals(AgentState.ERROR, runner.state)
    }

    @Test
    fun `step after error does not call provider again`() = runBlocking {
        val provider = FakeProvider(failure = IllegalStateException("provider down"))
        val runner = runner(
            context = testAgentContext(),
            provider = provider,
        )

        val first = runner.stepUntilDone()
        val second = runner.step()

        assertIs<AgentResponse.Error>(first)
        val secondError = assertIs<AgentResponse.Error>(second)
        assertEquals("Agent is in error state, cannot continue", secondError.message)
        assertEquals(1, provider.requests.size)
    }

    @Test
    fun `forces a final response without tools when max steps are reached`() = runBlocking {
        val tool = FakeTool()
        val provider = FakeProvider(
            listOf(
                LLMResponse(toolCalls = listOf(ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}"""))),
                LLMResponse(content = "partial findings", finishReason = "stop"),
            ),
        )
        val runner = runner(
            context = testAgentContext(agent = testAgent(maxSteps = 1)),
            provider = provider,
            tools = listOf(tool),
        )

        val response = runner.stepUntilDone()

        assertEquals(AgentResponse.Final("partial findings"), response)
        assertEquals(AgentState.DONE, runner.state)
        assertTrue(provider.requests.last().tools.isEmpty())
    }

    @Test
    fun `step after done returns cached final response without another provider call`() = runBlocking {
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val runner = runner(context = testAgentContext(), provider = provider)

        val first = runner.stepUntilDone()
        val second = runner.step()

        assertEquals(first, second)
        assertEquals(1, provider.requests.size)
        assertNotNull(runner.finalResponse())
    }

    private fun runner(
        context: com.heyanle.priestess.bot.agent.AgentContext,
        provider: FakeProvider,
        tools: List<FunctionTool> = emptyList(),
        toolExecutor: ToolExecutor? = null,
        hooks: AgentHooks? = null,
        overflowStore: ToolResultOverflowStore = ToolResultOverflowStore(),
    ): ReActRunner {
        val toolController = ToolController()
        tools.forEach(toolController::register)
        return ReActRunner(
            context = context,
            provider = provider,
            toolCase = ToolCase(
                controller = toolController,
                executorProvider = { toolExecutor ?: ToolExecutor(toolController) },
            ),
            contextManager = ContextManager(TokenCounter()),
            overflowStore = overflowStore,
            hooks = hooks,
        )
    }

    private fun recordingHooks(results: MutableList<AgentResponse.ToolExecuted>): AgentHooks {
        return object : AgentHooks {
            override suspend fun onToolEnd(context: AgentContext, toolName: String, result: AgentResponse.ToolExecuted) {
                results += result
            }
        }
    }
}
