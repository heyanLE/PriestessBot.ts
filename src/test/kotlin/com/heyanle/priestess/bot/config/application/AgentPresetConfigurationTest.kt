package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.AgentLlmDocument
import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.config.model.AgentProfileDocument
import com.heyanle.priestess.bot.config.model.ApplicationConfigurationDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import java.nio.file.Path
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The preset must survive the v3 projection, because validation and compilation read the projected
 * document rather than the v3 one.
 */
class AgentPresetConfigurationTest {
    private val source = ApplicationConfigurationSource()
    private val json = Json { encodeDefaults = true }

    @Test
    fun `an omitted preset compiles as the chat preset`() = inDirectory { root ->
        val document = validDocument().copy(agents = listOf(profile("assistant")))
        // encodeDefaults would write the default; strip the field to prove absence is accepted.
        val content = json.encodeToString(document).replace(Regex(",\\s*\"preset\"\\s*:\\s*\"NORMAL\""), "")
        assertFalse(content.contains("\"preset\""), "The fixture must omit the preset field")

        val loaded = source.decode(content, root.resolve("config.json"))

        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val projected = assertNotNull(loaded.value).workspaces.getValue("assistant").document.agents.single()
        assertEquals(AgentPreset.NORMAL, projected.preset)
    }

    @Test
    fun `the preset survives projection`() = inDirectory { root ->
        val document = validDocument().copy(
            agents = listOf(profile("assistant", AgentPreset.DEEPSEEK_HARNESS)),
        )

        val loaded = source.decode(json.encodeToString(document), root.resolve("config.json"))

        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val raw = assertNotNull(loaded.value)
        assertEquals(AgentPreset.DEEPSEEK_HARNESS, raw.application?.agents?.single()?.preset)
        assertEquals(AgentPreset.DEEPSEEK_HARNESS, raw.workspaces.getValue("assistant").document.agents.single().preset)
    }

    @Test
    fun `an unregistered preset is rejected before activation`() = inDirectory { root ->
        val content = json.encodeToString(validDocument().copy(agents = listOf(profile("assistant"))))
            .replace(Regex("\"preset\"\\s*:\\s*\"NORMAL\""), "\"preset\":\"NOT_A_PRESET\"")

        val loaded = source.decode(content, root.resolve("config.json"))

        assertFalse(loaded.isSuccess, "An unknown preset must not produce a usable generation")
        assertEquals(null, loaded.value)
        assertTrue(loaded.diagnostics.isNotEmpty(), "Rejection must be reported")
    }

    private fun profile(id: String, preset: AgentPreset = AgentPreset.NORMAL) = AgentProfileDocument(
        id = id,
        preset = preset,
        llm = AgentLlmDocument("llm", "model"),
    )

    private fun validDocument() = ApplicationConfigurationDocument(
        platformDirectory = "platform",
        llms = listOf(ProviderConnectionDocument("llm", "openai-compatible")),
        agents = listOf(profile("assistant")),
    )

    private inline fun inDirectory(block: (Path) -> Unit) {
        val root = java.nio.file.Files.createTempDirectory("agent-preset-config-test-")
        try {
            block(root)
        } finally {
            root.toFile().deleteRecursively()
        }
    }
}
