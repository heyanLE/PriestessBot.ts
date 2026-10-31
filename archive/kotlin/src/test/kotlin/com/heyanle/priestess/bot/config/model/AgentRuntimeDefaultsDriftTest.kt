package com.heyanle.priestess.bot.config.model

import com.heyanle.priestess.bot.agent.Agent
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The context window and step budget an Agent gets by default are declared in three places: the
 * configuration model, the compiled runtime [Agent], and the Dashboard Agent factory. A window smaller
 * than one assembled request silently degrades every newly created Agent, so the three must agree.
 */
class AgentRuntimeDefaultsDriftTest {

    @Test
    fun `configuration model uses the shared runtime defaults`() {
        assertEquals(AgentRuntimeDefaults.MAX_CONTEXT_TOKENS, CompressionSettingsDocument().maxTokens)
        assertEquals(AgentRuntimeDefaults.MAX_STEPS, ExecutionSettingsDocument().maxSteps)
    }

    @Test
    fun `compiled agent uses the shared runtime defaults`() {
        val agent = Agent(name = "drift", instructions = "i", model = "m")
        assertEquals(AgentRuntimeDefaults.MAX_CONTEXT_TOKENS, agent.maxContextTokens)
        assertEquals(AgentRuntimeDefaults.MAX_STEPS, agent.maxSteps)
    }

    @Test
    fun `dashboard agent factory mirrors the shared runtime defaults`() {
        val source = dashboardConfigModel()
        assertEquals(
            AgentRuntimeDefaults.MAX_CONTEXT_TOKENS,
            intConstant(source, "maxContextTokens"),
            "dashboard/src/models/configV3.ts agentRuntimeDefaults.maxContextTokens must equal AgentRuntimeDefaults.MAX_CONTEXT_TOKENS",
        )
        assertEquals(
            AgentRuntimeDefaults.MAX_STEPS,
            intConstant(source, "maxSteps"),
            "dashboard/src/models/configV3.ts agentRuntimeDefaults.maxSteps must equal AgentRuntimeDefaults.MAX_STEPS",
        )
    }

    @Test
    fun `default window fits an assembled request`() {
        // A window at or below the old 4096 default cannot hold the assembled system prompt plus one
        // tool result, which is the regression this guard exists to prevent.
        assertTrue(
            AgentRuntimeDefaults.MAX_CONTEXT_TOKENS >= 16_384,
            "Default context window ${AgentRuntimeDefaults.MAX_CONTEXT_TOKENS} is too small for an assembled request",
        )
        assertTrue(
            AgentRuntimeDefaults.MAX_STEPS >= 20,
            "Default step budget ${AgentRuntimeDefaults.MAX_STEPS} does not permit a multi-step tool workflow",
        )
    }

    private fun dashboardConfigModel(): String {
        val candidates = listOf(
            File("dashboard/src/models/configV3.ts"),
            File("../dashboard/src/models/configV3.ts"),
        )
        val file = candidates.firstOrNull { it.isFile }
        assertNotNull(file, "Cannot locate dashboard/src/models/configV3.ts from ${File(".").absolutePath}")
        return file.readText()
    }

    /** Reads a numeric `name: <int>` entry from the exported `agentRuntimeDefaults` block. */
    private fun intConstant(source: String, name: String): Int {
        val block = source.substringAfter("export const agentRuntimeDefaults", missingDelimiterValue = "")
        assertTrue(block.isNotEmpty(), "agentRuntimeDefaults block is missing from the Dashboard config model")
        val match = Regex("""\b${Regex.escape(name)}\s*:\s*(\d+)""").find(block)
        assertNotNull(match, "agentRuntimeDefaults.$name is missing from the Dashboard config model")
        return match.groupValues[1].toInt()
    }
}
