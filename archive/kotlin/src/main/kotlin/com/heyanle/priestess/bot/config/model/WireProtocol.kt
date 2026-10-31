package com.heyanle.priestess.bot.config.model

/** The wire format a provider connection speaks, independent of its vendor name. */
enum class WireProtocol {
    OPENAI_CHAT_COMPLETIONS,
    OPENAI_RESPONSES,
    ANTHROPIC_MESSAGES,
    GEMINI_GENERATE_CONTENT,
    OLLAMA_CHAT;

    companion object {
        /** Unknown plugin provider types retain their legacy adapter behavior until they declare a protocol. */
        fun defaultFor(providerType: String): WireProtocol? = when (providerType.lowercase()) {
            "openai", "openai-compatible" -> OPENAI_CHAT_COMPLETIONS
            "anthropic" -> ANTHROPIC_MESSAGES
            "gemini" -> GEMINI_GENERATE_CONTENT
            "ollama" -> OLLAMA_CHAT
            else -> null
        }

        fun supportedFor(providerType: String): List<WireProtocol>? = when (providerType.lowercase()) {
            "openai", "openai-compatible" -> listOf(OPENAI_CHAT_COMPLETIONS, OPENAI_RESPONSES)
            "anthropic" -> listOf(ANTHROPIC_MESSAGES)
            "gemini" -> listOf(GEMINI_GENERATE_CONTENT)
            "ollama" -> listOf(OLLAMA_CHAT)
            else -> null
        }

        fun parse(value: String): WireProtocol? = entries.firstOrNull { it.name == value }

        fun resolve(providerType: String, declared: String?): WireProtocol? =
            declared?.let(::parse) ?: if (declared == null) defaultFor(providerType) else null
    }
}
