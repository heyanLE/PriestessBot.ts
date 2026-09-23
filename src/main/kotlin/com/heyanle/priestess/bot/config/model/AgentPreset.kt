package com.heyanle.priestess.bot.config.model

import kotlinx.serialization.Serializable

/**
 * Selects how an Agent operates: which prompt it assembles, how it schedules tool calls and how it
 * compresses context. The preset is data, resolved through
 * [com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry]; adding one must not add a branch to
 * the runtime.
 *
 * Defaults to [NORMAL] so every Agent written before presets existed keeps the behaviour it had.
 */
@Serializable
enum class AgentPreset {
    /** The simple chat Agent: role-first prompt, serial tools, truncation compression. */
    NORMAL,

    /** A task Agent aligned with the DeepSeek Harness `standard` preset: priority-ordered sections,
     * an instruction document, per-tool guidance, parallel-safe tool calls and summarization compaction. */
    DEEPSEEK_HARNESS,
}
