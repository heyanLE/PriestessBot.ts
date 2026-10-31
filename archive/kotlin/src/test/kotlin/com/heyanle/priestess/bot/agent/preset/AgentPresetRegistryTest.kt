package com.heyanle.priestess.bot.agent.preset

import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.config.model.AgentRuntimeDefaults
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The registry is the only place that decides what a preset means. A missing definition would fail at
 * request time, so completeness and the chat preset's exact layout are pinned here.
 */
class AgentPresetRegistryTest {

    @Test
    fun `every preset has a definition`() {
        assertEquals(AgentPreset.entries.toSet(), AgentPresetRegistry.all.map { it.preset }.toSet())
    }

    @Test
    fun `display names are distinct and non blank`() {
        val names = AgentPresetRegistry.all.map { it.displayName }
        assertTrue(names.none { it.isBlank() })
        assertEquals(names.size, names.toSet().size, "Preset display names must be unique: $names")
        assertTrue(AgentPresetRegistry.all.all { it.description.isNotBlank() })
    }

    @Test
    fun `section orders are unique within a preset`() {
        AgentPresetRegistry.all.forEach { definition ->
            val orders = definition.sections.map { it.order }
            assertEquals(
                orders.size,
                orders.toSet().size,
                "Preset ${definition.preset} declares duplicate section orders: $orders",
            )
        }
    }

    @Test
    fun `the chat preset reproduces the layout that predates presets`() {
        val normal = AgentPresetRegistry.of(AgentPreset.NORMAL)
        // Role first, then platform mechanics: the order change 1 established for every Agent.
        assertEquals(
            listOf(
                PromptSectionId.AGENT_ROLE,
                PromptSectionId.PLATFORM,
                PromptSectionId.MESSAGE_IDENTITY,
                PromptSectionId.AGENT_DIRECTORIES,
                PromptSectionId.FORMATTING,
                PromptSectionId.RESPONSE_DELIVERY,
                PromptSectionId.LOADED_SKILLS,
            ),
            normal.sections.sortedBy { it.order }.map { it.id },
        )
        assertEquals(null, normal.identityTemplate, "The chat preset must not wrap the prompt")
        assertEquals(null, normal.instructionsDocument, "The chat preset must not read an instruction document")
    }

    @Test
    fun `the chat preset defaults equal the shared runtime defaults`() {
        val defaults = AgentPresetRegistry.defaultsFor(AgentPreset.NORMAL)
        assertEquals(AgentRuntimeDefaults.MAX_STEPS, defaults.maxSteps)
        assertEquals(AgentRuntimeDefaults.MAX_CONTEXT_TOKENS, defaults.maxContextTokens)
        assertEquals(AgentRuntimeDefaults.MAX_ROUNDS, defaults.maxRounds)
    }

    @Test
    fun `the task preset places its role document after the harness sections`() {
        val harness = AgentPresetRegistry.of(AgentPreset.DEEPSEEK_HARNESS)
        val ordered = harness.sections.sortedBy { it.order }
        val identity = ordered.indexOfFirst { it.id == PromptSectionId.HARNESS_IDENTITY }
        val instructions = ordered.indexOfFirst { it.id == PromptSectionId.INSTRUCTIONS }
        val role = ordered.indexOfFirst { it.id == PromptSectionId.AGENT_ROLE }
        val suffix = ordered.indexOfFirst { it.id == PromptSectionId.IDENTITY_SUFFIX }
        assertTrue(identity < instructions, "Harness identity must precede the instruction document")
        assertTrue(instructions < role, "The instruction document must precede the Agent role")
        assertTrue(role < suffix, "The identity suffix must close the prompt")
        assertTrue(harness.instructionsDocument != null)
        assertTrue(harness.identityTemplate != null)
    }

    @Test
    fun `the task preset grants a larger budget than the chat preset`() {
        val normal = AgentPresetRegistry.defaultsFor(AgentPreset.NORMAL)
        val harness = AgentPresetRegistry.defaultsFor(AgentPreset.DEEPSEEK_HARNESS)
        assertTrue(harness.maxSteps > normal.maxSteps, "A task Agent needs more steps than a chat Agent")
        assertTrue(harness.maxContextTokens > normal.maxContextTokens)
    }
}
