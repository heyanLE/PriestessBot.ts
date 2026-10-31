package com.heyanle.priestess.bot.agent.preset

import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.config.model.AgentRuntimeDefaults

/** Names a prompt section the assembler knows how to render. */
enum class PromptSectionId {
    HARNESS_IDENTITY,
    IDENTITY_PREFIX,
    INSTRUCTIONS,
    TOOL_GUIDANCE,
    AGENT_ROLE,
    PLATFORM,
    MESSAGE_IDENTITY,
    AGENT_DIRECTORIES,
    FORMATTING,
    RESPONSE_DELIVERY,
    LOADED_SKILLS,
    IDENTITY_SUFFIX,
}

/** A section's identity and its sort position. Both presets order the same renderers differently. */
data class PromptSectionSpec(val id: PromptSectionId, val order: Int)

/**
 * Templated wrapper around the whole prompt. Distinct from the Agent's platform persona, which
 * `PersonaMemoryInjector` has already merged into the Agent's instructions before the runner runs.
 */
data class IdentityTemplateSpec(val prefix: String = "", val suffix: String = "")

/** The instruction document a preset loads from the Agent configuration directory. */
data class InstructionsDocumentSpec(
    val fileNames: List<String> = listOf("AGENTS.md"),
    val maxBytes: Int = 65_536,
)

/** Budgets a preset proposes for a newly created Agent. Explicit Agent values always win. */
data class AgentPresetDefaults(
    val maxSteps: Int,
    val maxContextTokens: Int,
    val maxRounds: Int,
)

/** Which runner drives an Agent. Both share one loop; they differ in how a step's tool calls dispatch. */
enum class AgentRunnerKind {
    /** [com.heyanle.priestess.bot.agent.runner.ReActRunner]: one tool call at a time. */
    REACT,

    /** [com.heyanle.priestess.bot.agent.runner.HarnessRunner]: parallel-safe calls overlap. */
    HARNESS,
}

/** Behaviour selection as data, so a third preset needs no new branch in the runtime. */
data class AgentPresetDefinition(
    val preset: AgentPreset,
    val displayName: String,
    val description: String,
    val runner: AgentRunnerKind,
    val sections: List<PromptSectionSpec>,
    val identityTemplate: IdentityTemplateSpec? = null,
    val instructionsDocument: InstructionsDocumentSpec? = null,
    /** Ceiling on concurrent parallel-safe tool calls in one step; null keeps every call serial. */
    val parallelToolCalls: Int? = null,
    val defaults: AgentPresetDefaults,
)

object AgentPresetRegistry {
    private val definitions: Map<AgentPreset, AgentPresetDefinition> = listOf(
        AgentPresetDefinition(
            preset = AgentPreset.NORMAL,
            displayName = "普通",
            description = "轻量聊天 Agent：角色优先的提示词，串行工具调用，截断式上下文压缩。",
            runner = AgentRunnerKind.REACT,
            // Reproduces the section order introduced before presets existed; pinned by AgentPresetRegistryTest.
            sections = listOf(
                PromptSectionSpec(PromptSectionId.AGENT_ROLE, 100),
                PromptSectionSpec(PromptSectionId.PLATFORM, 200),
                PromptSectionSpec(PromptSectionId.MESSAGE_IDENTITY, 300),
                PromptSectionSpec(PromptSectionId.AGENT_DIRECTORIES, 400),
                PromptSectionSpec(PromptSectionId.FORMATTING, 500),
                PromptSectionSpec(PromptSectionId.RESPONSE_DELIVERY, 600),
                PromptSectionSpec(PromptSectionId.LOADED_SKILLS, 700),
            ),
            defaults = AgentPresetDefaults(
                maxSteps = AgentRuntimeDefaults.MAX_STEPS,
                maxContextTokens = AgentRuntimeDefaults.MAX_CONTEXT_TOKENS,
                maxRounds = AgentRuntimeDefaults.MAX_ROUNDS,
            ),
        ),
        AgentPresetDefinition(
            preset = AgentPreset.DEEPSEEK_HARNESS,
            displayName = "DeepSeek Harness",
            description = "复杂任务 Agent：按优先级组装的分段提示词，目录指令文档，逐工具行为指导，并行安全工具调用，摘要式压缩。",
            runner = AgentRunnerKind.HARNESS,
            sections = listOf(
                PromptSectionSpec(PromptSectionId.HARNESS_IDENTITY, -1000),
                PromptSectionSpec(PromptSectionId.IDENTITY_PREFIX, 0),
                PromptSectionSpec(PromptSectionId.INSTRUCTIONS, 900),
                PromptSectionSpec(PromptSectionId.TOOL_GUIDANCE, 1000),
                PromptSectionSpec(PromptSectionId.AGENT_ROLE, 9000),
                PromptSectionSpec(PromptSectionId.PLATFORM, 9100),
                PromptSectionSpec(PromptSectionId.MESSAGE_IDENTITY, 9200),
                PromptSectionSpec(PromptSectionId.FORMATTING, 9300),
                PromptSectionSpec(PromptSectionId.AGENT_DIRECTORIES, 9400),
                PromptSectionSpec(PromptSectionId.RESPONSE_DELIVERY, 9500),
                PromptSectionSpec(PromptSectionId.LOADED_SKILLS, 9600),
                PromptSectionSpec(PromptSectionId.IDENTITY_SUFFIX, 10200),
            ),
            identityTemplate = IdentityTemplateSpec(
                prefix = "You are a coding agent powered by the {{model}} model.",
                suffix = "Your working directory is {{cwd}}.",
            ),
            instructionsDocument = InstructionsDocumentSpec(),
            parallelToolCalls = 10,
            defaults = AgentPresetDefaults(
                maxSteps = 60,
                maxContextTokens = 131_072,
                maxRounds = 40,
            ),
        ),
    ).associateBy { it.preset }

    init {
        // A preset without a definition would fail at request time; refuse to construct the registry instead.
        val missing = AgentPreset.entries.filterNot { it in definitions }
        require(missing.isEmpty()) { "Agent presets without a definition: $missing" }
    }

    val all: List<AgentPresetDefinition> get() = AgentPreset.entries.map { definitions.getValue(it) }

    fun of(preset: AgentPreset): AgentPresetDefinition = definitions.getValue(preset)

    fun defaultsFor(preset: AgentPreset): AgentPresetDefaults = of(preset).defaults
}
