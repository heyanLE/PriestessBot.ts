package com.heyanle.priestess.bot.config.model

/**
 * Baseline runtime budgets for an Agent that does not state its own.
 *
 * These values are the single source of truth for the configuration model, the compiled [com.heyanle.priestess.bot.agent.Agent]
 * and (mirrored in `dashboard/src/models/configV3.ts`) the Dashboard Agent factory. A window smaller than one assembled
 * request makes compression discard the context the Agent needs, which is indistinguishable from a weak model, so the
 * default has to fit the assembled system prompt plus at least one tool result.
 *
 * `AgentRuntimeDefaultsDriftTest` fails if the three sources stop agreeing.
 */
object AgentRuntimeDefaults {
    /** Default context window in tokens for an Agent without explicit compression settings. */
    const val MAX_CONTEXT_TOKENS: Int = 32_768

    /** Default step budget for an Agent without explicit execution settings. */
    const val MAX_STEPS: Int = 25

    /** Default conversation round budget for an Agent without explicit compression settings. */
    const val MAX_ROUNDS: Int = 20
}
