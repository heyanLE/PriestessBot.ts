package com.heyanle.priestess.bot.agent

import com.heyanle.priestess.bot.config.model.*
import kotlin.test.Test
import kotlin.test.assertEquals

class AgentCaseTest {
    @Test
    fun `creates runtime Agent from the complete effective definition`() {
        val provider = EffectiveProviderConnection("provider-a", "test", true, "", null, null, emptyMap())
        val definition = AgentDefinitionDocument(
            id = "code-agent",
            instructions = "Answer carefully",
            providerRef = provider.id,
            model = "model-a",
            generation = GenerationSettingsDocument(0.25, 512),
            context = ContextSettingsDocument(CompressionSettingsDocument("token_window", 9, 2048)),
            execution = ExecutionSettingsDocument(7, 12_000),
            toolPolicy = ToolPolicyDocument(allow = listOf("read")),
        )
        val agent = AgentCase(AgentController()).createAgent(EffectiveAgent(definition, provider, setOf("read")))

        assertEquals("code-agent", agent.name)
        assertEquals("Answer carefully", agent.instructions)
        assertEquals("model-a", agent.model)
        assertEquals("provider-a", agent.providerName)
        assertEquals(0.25, agent.temperature)
        assertEquals(512, agent.maxOutputTokens)
        assertEquals(7, agent.maxSteps)
        assertEquals(12_000L, agent.toolTimeoutMs)
        assertEquals(CompressStrategy.TOKEN_WINDOW, agent.compressStrategy)
        assertEquals(2048, agent.maxContextTokens)
        assertEquals(9, agent.maxContextRounds)
        assertEquals(setOf("read"), agent.effectiveToolIds)
    }
}
