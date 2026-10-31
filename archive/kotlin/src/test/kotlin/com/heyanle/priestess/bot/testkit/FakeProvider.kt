package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.LLMKind
import com.heyanle.priestess.bot.provider.ProviderMetadata
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse

class FakeProvider(
    responses: List<LLMResponse> = emptyList(),
    private val failure: Throwable? = null,
) : ChatProvider {
    private val scriptedResponses = ArrayDeque(responses)
    val requests = mutableListOf<LLMRequest>()

    override val metadata = ProviderMetadata(
        name = "fake-provider",
        displayName = "Fake Provider",
        kind = LLMKind.OPENAI,
        supportToolCalling = true,
        supportVision = false,
        supportStreaming = false,
    )

    override val config = ProviderConfig(
        name = "fake-provider",
        type = "fake-provider",
        model = "fake-model",
    )

    override suspend fun test(): Boolean = failure == null

    override suspend fun textChat(request: LLMRequest): LLMResponse {
        requests += request
        failure?.let { throw it }
        return scriptedResponses.removeFirstOrNull()
            ?: LLMResponse(content = "fallback final", finishReason = "stop")
    }

    override suspend fun getModels(): List<String> = listOf("fake-model")
}
