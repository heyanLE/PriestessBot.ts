package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import com.heyanle.priestess.bot.testkit.FakeProvider
import com.heyanle.priestess.bot.testkit.testAgent
import com.heyanle.priestess.bot.testkit.testAgentContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolExecutor
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The system prompt is assembled from ordered sections with the Agent's role first.
 *
 * Tool schemas travel to the provider as native function definitions, so the prompt must not restate
 * them, and permission mechanics stay out of model context because an unusable tool is filtered out
 * of the request rather than described as unavailable.
 */
class SystemPromptCompositionTest {

    @Test
    fun `role document precedes platform mechanics`() = runBlocking {
        val prompt = systemPrompt(
            context = testAgentContext(
                agent = testAgent().copy(instructions = "You are a prompt composition test agent."),
                metadata = mapOf("agentConfigDirectory" to "/tmp/agent-config", "agentTempDirectory" to "/tmp/agent-temp"),
            ),
        )

        assertTrue(
            prompt.startsWith("## Role Document"),
            "The Agent role document must be the first section, but the prompt started with: ${prompt.take(80)}",
        )
        assertTrue(prompt.contains("You are a prompt composition test agent."))

        val ordered = listOf(
            "## Role Document",
            "## Platform",
            "## Message Identity",
            "## Agent Directories",
            "## Formatting",
            "## Response Delivery",
            "## Loaded Skills",
        )
        val indices = ordered.map { heading ->
            heading to prompt.indexOf(heading).also { index ->
                assertTrue(index >= 0, "Expected section '$heading' in the system prompt")
            }
        }
        assertEquals(
            indices.map { it.second }.sorted(),
            indices.map { it.second },
            "Sections must appear in the declared order, found: ${indices.joinToString { "${it.first}@${it.second}" }}",
        )
    }

    @Test
    fun `tool schemas are delivered natively and not restated as prompt text`() = runBlocking {
        val tool = stubTool(name = "read_file", description = "Read a UTF-8 text file.")
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val prompt = systemPrompt(context = testAgentContext(), tools = listOf(tool), provider = provider)

        assertFalse(
            prompt.contains("Available tools:"),
            "The system prompt must not enumerate tools as plain text",
        )
        assertFalse(
            prompt.contains("read_file"),
            "Tool names belong in the native function definitions, not in system prompt text",
        )

        val nativeTools = provider.requests.single().tools
        assertEquals(1, nativeTools.size, "The visible tool must still reach the provider natively")
        assertTrue(nativeTools.single().toString().contains("read_file"))
        assertTrue(nativeTools.single().toString().contains("Read a UTF-8 text file."))
    }

    @Test
    fun `unusable tool is filtered from the request without denial text`() = runBlocking {
        val restricted = stubTool(
            name = "super_secret",
            description = "Administrator only.",
            requiredPermissionGroup = PermissionGroup.ADMIN,
        )
        val provider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop")))
        val prompt = systemPrompt(
            context = testAgentContext(agent = testAgent().copy(strictPermissionToolFiltering = true)),
            tools = listOf(restricted),
            provider = provider,
        )

        assertTrue(
            provider.requests.single().tools.isEmpty(),
            "A tool the caller cannot use must be absent from the request",
        )
        assertFalse(
            prompt.contains("当前权限不足"),
            "Permission mechanics must not be disclosed to the model",
        )
        assertFalse(prompt.contains("super_secret"))
    }

    @Test
    fun `agent directories section is omitted when the agent has no directory metadata`() = runBlocking {
        val withoutDirectories = systemPrompt(context = testAgentContext())
        assertFalse(
            withoutDirectories.contains("## Agent Directories"),
            "An empty section must be omitted instead of rendering a bare heading",
        )

        val withDirectories = systemPrompt(
            context = testAgentContext(
                metadata = mapOf("agentConfigDirectory" to "/tmp/agent-config", "agentTempDirectory" to "/tmp/agent-temp"),
            ),
        )
        assertTrue(withDirectories.contains("## Agent Directories"))
        assertTrue(withDirectories.contains("/tmp/agent-config"))
    }

    @Test
    fun `skill blocks are preserved`() = runBlocking {
        val skillState = PipelineSkillState(
            availableSkills = listOf(
                SkillPromptReference(name = "demo-skill", description = "A demo skill.", inlineMarkdown = "# Demo"),
            ),
        )
        skillState.load("demo-skill")

        val prompt = systemPrompt(context = testAgentContext(skillState = skillState))

        assertTrue(prompt.contains("demo-skill"), "Available skill names must remain in the prompt")
        assertTrue(prompt.contains("# Demo"), "A loaded SKILL.md document must remain in the prompt")
    }

    private suspend fun systemPrompt(
        context: AgentContext,
        tools: List<FunctionTool> = emptyList(),
        provider: FakeProvider = FakeProvider(listOf(LLMResponse(content = "done", finishReason = "stop"))),
    ): String {
        val toolController = ToolController()
        tools.forEach(toolController::register)
        ReActRunner(
            context = context,
            provider = provider,
            toolCase = ToolCase(
                controller = toolController,
                executorProvider = { ToolExecutor(toolController) },
            ),
            contextManager = ContextManager(TokenCounter()),
            overflowStore = ToolResultOverflowStore(),
        ).stepUntilDone()
        return provider.requests.single().messages.first { it.role == "system" }.content.orEmpty()
    }

    private fun stubTool(
        name: String,
        description: String,
        requiredPermissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    ): FunctionTool = object : FunctionTool() {
        override val schema = ToolSchema(
            name = name,
            description = description,
            requiredPermissionGroup = requiredPermissionGroup,
        )

        override suspend fun execute(
            context: com.heyanle.priestess.bot.tool.AgentToolContext,
            args: Map<String, String>,
        ): ToolResult = ToolResult.success("ok")
    }
}
