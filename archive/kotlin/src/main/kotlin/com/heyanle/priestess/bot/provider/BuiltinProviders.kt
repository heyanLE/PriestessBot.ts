package com.heyanle.priestess.bot.provider

import com.heyanle.priestess.bot.provider.adapters.ollama.OllamaProvider
import com.heyanle.priestess.bot.provider.adapters.openai.OpenAIProvider
import com.heyanle.priestess.bot.provider.adapters.anthropic.AnthropicProvider
import com.heyanle.priestess.bot.provider.adapters.gemini.GeminiProvider

fun registerBuiltinProviders() {
    ProviderRegistry.register(
        metadata = ProviderMetadata(
            name = "openai",
            displayName = "OpenAI",
            kind = LLMKind.OPENAI,
            supportToolCalling = true,
            supportVision = true,
            supportStreaming = true,
        ),
        factory = { cfg -> OpenAIProvider(cfg) }
    )

    ProviderRegistry.register(
        metadata = ProviderMetadata(
            name = "openai-compatible",
            displayName = "OpenAI Compatible",
            kind = LLMKind.OPENAI,
            supportToolCalling = true,
            supportVision = true,
            supportStreaming = true,
        ),
        factory = { cfg -> OpenAIProvider(cfg) }
    )

    ProviderRegistry.register(
        metadata = ProviderMetadata(
            name = "ollama",
            displayName = "Ollama",
            kind = LLMKind.OLLAMA,
            supportToolCalling = true,
            supportVision = false,
            supportStreaming = true,
        ),
        factory = { cfg -> OllamaProvider(cfg) }
    )

    ProviderRegistry.register(
        metadata = ProviderMetadata(
            name = "anthropic",
            displayName = "Anthropic",
            kind = LLMKind.ANTHROPIC,
            supportToolCalling = false,
            supportVision = false,
            supportStreaming = false,
        ),
        factory = { cfg -> AnthropicProvider(cfg) }
    )

    ProviderRegistry.register(
        metadata = ProviderMetadata(
            name = "gemini",
            displayName = "Gemini",
            kind = LLMKind.GEMINI,
            supportToolCalling = false,
            supportVision = false,
            supportStreaming = false,
        ),
        factory = { cfg -> GeminiProvider(cfg) }
    )
}
