package com.heyanle.priestess.bot.agent

/**
 * Agent 上下文压缩策略。
 *
 * Each entry owns the string used by `context.compression.strategy`, so the validator's allowlist and the
 * compiler's parser cannot disagree — they previously were two hand-maintained lists, and adding a
 * strategy to one without the other made a valid configuration fail activation.
 */
enum class CompressStrategy(val configName: String) {
    ROUND_TRUNCATION("round_truncation"),
    TOKEN_WINDOW("token_window"),

    /** Replaces the oldest span with a model-generated checkpoint instead of dropping it. */
    LLM_SUMMARIZATION("llm_summarization"),
    ;

    companion object {
        /** Every value the persisted configuration may use. */
        val configNames: Set<String> = entries.mapTo(mutableSetOf()) { it.configName }

        fun fromConfigName(value: String): CompressStrategy? =
            entries.firstOrNull { it.configName == value.trim().lowercase() }
    }
}
