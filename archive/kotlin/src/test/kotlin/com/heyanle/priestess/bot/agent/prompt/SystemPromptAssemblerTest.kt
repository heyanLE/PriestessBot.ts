package com.heyanle.priestess.bot.agent.prompt

import com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry
import com.heyanle.priestess.bot.agent.preset.IdentityTemplateSpec
import com.heyanle.priestess.bot.agent.preset.InstructionsDocumentSpec
import com.heyanle.priestess.bot.agent.preset.PromptSectionId
import com.heyanle.priestess.bot.agent.preset.PromptSectionSpec
import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.testkit.testAgent
import com.heyanle.priestess.bot.testkit.testAgentContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * One assembler serves every preset; a preset changes which sections appear and in what order.
 */
class SystemPromptAssemblerTest {

    @Test
    fun `sections render in ascending order`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(
                PromptSectionSpec(PromptSectionId.FORMATTING, 500),
                PromptSectionSpec(PromptSectionId.HARNESS_IDENTITY, -1000),
                PromptSectionSpec(PromptSectionId.PLATFORM, 200),
            ),
        )
        val prompt = assembler.assemble(testAgentContext(), emptyList())

        val harness = prompt.indexOf("## Harness")
        val platform = prompt.indexOf("## Platform")
        val formatting = prompt.indexOf("## Formatting")
        assertTrue(harness in 0..<platform, "Harness identity must precede platform facts")
        assertTrue(platform < formatting, "Platform must precede formatting")
    }

    @Test
    fun `blank sections are omitted rather than rendering a bare heading`() {
        // Neither the Agent nor the context carries directory metadata, so that section renders blank.
        val assembler = SystemPromptAssembler(
            sections = listOf(
                PromptSectionSpec(PromptSectionId.AGENT_ROLE, 100),
                PromptSectionSpec(PromptSectionId.AGENT_DIRECTORIES, 200),
                PromptSectionSpec(PromptSectionId.FORMATTING, 300),
            ),
        )
        val prompt = assembler.assemble(testAgentContext(), emptyList())

        assertTrue(prompt.contains("## Role Document"))
        assertTrue(prompt.contains("## Formatting"))
        assertFalse(prompt.contains("## Agent Directories"))
    }

    @Test
    fun `identity template interpolates the model and the working directory`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(
                PromptSectionSpec(PromptSectionId.IDENTITY_PREFIX, 0),
                PromptSectionSpec(PromptSectionId.IDENTITY_SUFFIX, 100),
            ),
            identityTemplate = IdentityTemplateSpec(
                prefix = "You are an agent powered by the {{model}} model.",
                suffix = "Your working directory is {{cwd}}.",
            ),
        )
        val prompt = assembler.assemble(
            testAgentContext(
                agent = testAgent().copy(model = "some-model"),
                metadata = mapOf("agentConfigDirectory" to "/tmp/agent-config"),
            ),
            emptyList(),
        )

        assertTrue(prompt.contains("powered by the some-model model"), prompt)
        assertTrue(prompt.contains("working directory is /tmp/agent-config"), prompt)
        assertFalse(prompt.contains("{{model}}"))
        assertFalse(prompt.contains("{{cwd}}"))
    }

    @Test
    fun `absent identity template contributes nothing`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(
                PromptSectionSpec(PromptSectionId.IDENTITY_PREFIX, 0),
                PromptSectionSpec(PromptSectionId.IDENTITY_SUFFIX, 100),
            ),
            identityTemplate = null,
        )
        assertEquals("", assembler.assemble(testAgentContext(), emptyList()))
    }

    @Test
    fun `instruction document renders as its own section`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(PromptSectionSpec(PromptSectionId.INSTRUCTIONS, 900)),
            instructions = { "INSTRUCTIONS-PRESENT" },
        )
        assertTrue(assembler.assemble(testAgentContext(), emptyList()).contains("INSTRUCTIONS-PRESENT"))
    }

    @Test
    fun `tool guidance renders once per guided tool in risk order`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(PromptSectionSpec(PromptSectionId.TOOL_GUIDANCE, 1000)),
        )
        val tools = listOf(
            stubTool("write_thing", ToolRiskLevel.STATE_WRITE, "Write guidance."),
            stubTool("read_thing", ToolRiskLevel.SAFE_READ, "Read guidance."),
            stubTool("silent_thing", ToolRiskLevel.SAFE_READ, ""),
        )
        val prompt = assembler.assemble(testAgentContext(), tools)

        assertTrue(prompt.contains("### read_thing"))
        assertTrue(prompt.contains("Read guidance."))
        assertTrue(prompt.contains("### write_thing"))
        assertTrue(prompt.startsWith("## Tool Guidance\n\n### read_thing"), "Read-only guidance must come first: $prompt")
        assertFalse(prompt.contains("silent_thing"), "A tool without guidance must not add a block")
    }

    @Test
    fun `no guided tools means no guidance section`() {
        val assembler = SystemPromptAssembler(
            sections = listOf(PromptSectionSpec(PromptSectionId.TOOL_GUIDANCE, 1000)),
        )
        val prompt = assembler.assemble(testAgentContext(), listOf(stubTool("plain", ToolRiskLevel.SAFE_READ, "")))
        assertEquals("", prompt)
    }

    @Test
    fun `the chat preset assembles its documented layout end to end`() {
        val definition = AgentPresetRegistry.of(AgentPreset.NORMAL)
        val assembler = SystemPromptAssembler(definition.sections, definition.identityTemplate)
        val prompt = assembler.assemble(
            testAgentContext(agent = testAgent().copy(instructions = "You are a chat agent.")),
            emptyList(),
        )

        assertTrue(prompt.startsWith("## Role Document"), "The chat preset keeps role-first: $prompt")
        assertTrue(prompt.contains("You are a chat agent."))
        assertTrue(prompt.contains("## Platform"))
        assertTrue(prompt.contains("## Formatting"))
        assertTrue(prompt.contains("## Loaded Skills"))
        assertFalse(prompt.contains("## Harness"), "The chat preset must not gain harness sections")
        assertFalse(prompt.contains("## Tool Guidance"))
    }

    @Test
    fun `the task preset assembles harness identity before the role document`() {
        val definition = AgentPresetRegistry.of(AgentPreset.DEEPSEEK_HARNESS)
        val assembler = SystemPromptAssembler(
            sections = definition.sections,
            identityTemplate = definition.identityTemplate,
            instructions = { "PROJECT RULES" },
        )
        val prompt = assembler.assemble(
            testAgentContext(
                agent = testAgent().copy(model = "harness-model", instructions = "You are a task agent."),
                metadata = mapOf("agentConfigDirectory" to "/tmp/agent-config"),
            ),
            listOf(stubTool("read_file", ToolRiskLevel.SAFE_READ, "Read guidance.")),
        )

        val harness = prompt.indexOf("## Harness")
        val identity = prompt.indexOf("harness-model")
        val instructions = prompt.indexOf("PROJECT RULES")
        val guidance = prompt.indexOf("## Tool Guidance")
        val role = prompt.indexOf("## Role Document")
        assertTrue(harness in 0..<identity, "Harness identity must come first")
        assertTrue(identity < instructions, "Identity wrapper must precede the instruction document")
        assertTrue(instructions < guidance, "Instructions must precede tool guidance")
        assertTrue(guidance < role, "Tool guidance must precede the Agent role document")
        assertTrue(prompt.contains("You are a task agent."))
    }

    private fun stubTool(name: String, risk: ToolRiskLevel, guidance: String): FunctionTool = object : FunctionTool() {
        override val schema = ToolSchema(name = name, description = "$name description", guidance = guidance, riskLevel = risk)
        override suspend fun execute(
            context: com.heyanle.priestess.bot.tool.AgentToolContext,
            args: Map<String, String>,
        ): ToolResult = ToolResult.success("ok")
    }
}
