package com.heyanle.priestess.bot.provider.adapters.openai

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OpenAIProviderIntegrationTest {

    @Test
    fun `deepseek compatible endpoint returns chat completion`() = runBlocking {
        assumeTrue(integrationEnabled())

        val provider = integrationProvider()
        val response = provider.textChat(
            LLMRequest(
                messages = listOf(
                    ConversationMessage.system("You are a test endpoint. Follow the user instruction exactly."),
                    ConversationMessage.user("Reply exactly with: priestess-provider-ok"),
                ),
                temperature = 0.0,
                maxTokens = 32,
            ),
        )

        assertTrue(response.content.contains("priestess-provider-ok", ignoreCase = true))
    }

    @Test
    fun `deepseek compatible endpoint returns tool call`() = runBlocking {
        assumeTrue(integrationEnabled())

        val provider = integrationProvider()
        val response = provider.textChat(
            LLMRequest(
                messages = listOf(
                    ConversationMessage.system("You must call the provided function. Do not answer in plain text."),
                    ConversationMessage.user("Call lookup_status with target equal to priestess."),
                ),
                tools = listOf(
                    ToolSchema(
                        name = "lookup_status",
                        description = "Looks up a status value.",
                        parameters = ToolParameters(
                            properties = listOf(
                                ParameterDef(
                                    name = "target",
                                    type = "string",
                                    description = "Target to look up.",
                                ),
                            ),
                            required = listOf("target"),
                        ),
                    ).toOpenAIFormat(),
                ),
                temperature = 0.0,
                maxTokens = 128,
            ),
        )

        assertTrue(response.hasToolCalls(), "Expected a tool call but got content='${response.content}'")
        assertEquals("lookup_status", response.toolCalls.single().name)
        assertTrue(response.toolCalls.single().arguments.contains("priestess", ignoreCase = true))
    }

    private fun integrationEnabled(): Boolean {
        return System.getenv("PRIESTESS_OPENAI_PROVIDER_INTEGRATION") == "true"
    }

    private fun integrationProvider(): OpenAIProvider {
        return OpenAIProvider(
            config = ProviderConfig(
                name = System.getenv("PRIESTESS_OPENAI_PROVIDER_NAME") ?: "deepseek-v4-flash",
                type = "openai",
                model = System.getenv("PRIESTESS_OPENAI_PROVIDER_MODEL") ?: "deepseek-v4-flash",
                baseUrl = System.getenv("PRIESTESS_OPENAI_PROVIDER_URL")
                    ?: "http://192.168.31.24:8090/v1/chat/completions",
                apiKey = System.getenv("PRIESTESS_OPENAI_PROVIDER_API_KEY").orEmpty(),
            ),
        )
    }
}
