package com.heyanle.priestess.bot.agent.type

import com.heyanle.priestess.bot.agent.preset.AgentPresetDefaults
import com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry
import com.heyanle.priestess.bot.agent.codex.CodexNativeAvailability
import com.heyanle.priestess.bot.config.model.AgentEngine
import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.config.model.AgentRuntimeDefaults
import com.heyanle.priestess.bot.config.model.ToolInjectionMode
import com.heyanle.priestess.bot.config.model.WireProtocol

data class AgentTypeDefinition(
    val type: AgentType,
    val displayName: String,
    val description: String,
    val engine: AgentEngine,
    val internalPreset: AgentPreset?,
    val llmProtocols: Set<WireProtocol>,
    val toolInjectionModes: Set<ToolInjectionMode>,
    val defaults: AgentPresetDefaults,
    /** CODEX is advertised but cannot be activated until its runner and caller-policy bridge are registered. */
    val available: Boolean,
)

object AgentTypeRegistry {
    private val definitions: Map<AgentType, AgentTypeDefinition> = listOf(
        AgentTypeDefinition(
            type = AgentType.NORMAL,
            displayName = "普通",
            description = AgentPresetRegistry.of(AgentPreset.NORMAL).description,
            engine = AgentEngine.INTERNAL,
            internalPreset = AgentPreset.NORMAL,
            llmProtocols = WireProtocol.entries.toSet(),
            toolInjectionModes = setOf(ToolInjectionMode.MULTI, ToolInjectionMode.NONE),
            defaults = AgentPresetRegistry.defaultsFor(AgentPreset.NORMAL),
            available = true,
        ),
        AgentTypeDefinition(
            type = AgentType.DEEPSEEK_HARNESS,
            displayName = "DeepSeek Harness",
            description = AgentPresetRegistry.of(AgentPreset.DEEPSEEK_HARNESS).description,
            engine = AgentEngine.INTERNAL,
            internalPreset = AgentPreset.DEEPSEEK_HARNESS,
            llmProtocols = WireProtocol.entries.toSet(),
            toolInjectionModes = setOf(ToolInjectionMode.MULTI, ToolInjectionMode.NONE),
            defaults = AgentPresetRegistry.defaultsFor(AgentPreset.DEEPSEEK_HARNESS),
            available = true,
        ),
        AgentTypeDefinition(
            type = AgentType.CODEX,
            displayName = "Codex（实验）",
            description = "通过本地 JNI 调用 Codex Rust 引擎；需要显式实验开关与固定 SHA-256 的原生库。",
            engine = AgentEngine.CODEX,
            internalPreset = null,
            llmProtocols = setOf(WireProtocol.OPENAI_RESPONSES),
            toolInjectionModes = setOf(ToolInjectionMode.NONE, ToolInjectionMode.MULTI),
            defaults = AgentPresetDefaults(
                maxSteps = AgentRuntimeDefaults.MAX_STEPS,
                maxContextTokens = AgentRuntimeDefaults.MAX_CONTEXT_TOKENS,
                maxRounds = AgentRuntimeDefaults.MAX_ROUNDS,
            ),
            available = CodexNativeAvailability.selection.path != null,
        ),
    ).associateBy(AgentTypeDefinition::type)

    init {
        require(definitions.keys == AgentType.entries.toSet()) { "Every Agent type needs a definition" }
        definitions.values.forEach { definition ->
            require(definition.llmProtocols.isNotEmpty()) { "${definition.type} declares no LLM protocols" }
            require((definition.engine == AgentEngine.INTERNAL) == (definition.internalPreset != null)) {
                "${definition.type} has an inconsistent internal preset"
            }
        }
    }

    val all: List<AgentTypeDefinition> get() = AgentType.entries.map(definitions::getValue)
    fun of(type: AgentType): AgentTypeDefinition = definitions.getValue(type)
}
