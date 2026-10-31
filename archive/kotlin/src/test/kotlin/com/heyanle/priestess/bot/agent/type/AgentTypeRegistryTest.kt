package com.heyanle.priestess.bot.agent.type

import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.agent.AgentController
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.ExternalAgentRunner
import com.heyanle.priestess.bot.agent.ExternalAgentRunnerRegistry
import com.heyanle.priestess.bot.config.model.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AgentTypeRegistryTest {
    @Test
    fun `every type declares protocols and internal types preserve their preset`() {
        assertEquals(AgentType.entries.toSet(), AgentTypeRegistry.all.map { it.type }.toSet())
        AgentTypeRegistry.all.forEach { assertTrue(it.llmProtocols.isNotEmpty()) }
        val provider = EffectiveProviderConnection("llm", "openai", true, "https://example.test/v1", null, null, emptyMap(), WireProtocol.OPENAI_CHAT_COMPLETIONS)
        for ((type, preset) in listOf(AgentType.NORMAL to AgentPreset.NORMAL, AgentType.DEEPSEEK_HARNESS to AgentPreset.DEEPSEEK_HARNESS)) {
            val definition = AgentDefinitionDocument("assistant", type = type, providerRef = "llm", model = "test-model")
            val runtime = AgentCase(AgentController()).createAgent(EffectiveAgent(definition, provider, emptySet()))
            assertEquals(type, runtime.type)
            assertEquals(preset, runtime.preset)
        }
        val codex = AgentTypeRegistry.of(AgentType.CODEX)
        assertEquals(AgentEngine.CODEX, codex.engine)
        assertEquals(null, codex.internalPreset)
        assertEquals(setOf(WireProtocol.OPENAI_RESPONSES), codex.llmProtocols)
        assertEquals(setOf(ToolInjectionMode.NONE, ToolInjectionMode.MULTI), codex.toolInjectionModes)
        assertFalse(codex.available)
    }

    @Test
    fun `external runner registry never falls back to internal execution`() {
        val registry = ExternalAgentRunnerRegistry()
        assertEquals(null, registry.get(AgentEngine.CODEX))
        val runner = ExternalAgentRunner { AgentResponse.Final("native") }
        registry.register(AgentEngine.CODEX, runner)
        assertNotNull(registry.get(AgentEngine.CODEX))
        registry.unregister(AgentEngine.CODEX)
        assertEquals(null, registry.get(AgentEngine.CODEX))
    }
}
