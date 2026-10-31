package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.AgentLlmDocument
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.config.model.AgentProfileDocument
import com.heyanle.priestess.bot.config.model.ApplicationConfigurationDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.config.model.ContextSettingsDocument
import com.heyanle.priestess.bot.config.model.ExecutionSettingsDocument
import java.nio.file.Path
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The Agent type must survive the v3 projection, because validation and compilation read the projected
 * document rather than the v3 one.
 */
class AgentTypeConfigurationTest {
    private val source = ApplicationConfigurationSource()
    private val json = Json { encodeDefaults = true }

    @Test
    fun `CODEX default fields do not warn but changed inert budgets do`() = inDirectory { root ->
        val original = profile("assistant", AgentType.CODEX)
        val path = root.resolve("config.json")
        val defaults = source.decode(json.encodeToString(validDocument().copy(agents = listOf(original))), path)
        assertFalse(defaults.diagnostics.any { it.code?.startsWith("CODEX_") == true })

        val changed = original.copy(
            context = ContextSettingsDocument(compression = original.context.compression.copy(maxRounds = 99)),
            execution = ExecutionSettingsDocument(maxSteps = 99),
        )
        val result = source.decode(json.encodeToString(validDocument().copy(agents = listOf(changed))), path)
        assertTrue(result.diagnostics.any { it.code == "CODEX_COMPRESSION_INERT" })
        assertTrue(result.diagnostics.any { it.code == "CODEX_MAX_STEPS_INERT" })
        assertFalse(result.diagnostics.any { it.path.endsWith("personaExampleTokens") })
    }

    @Test
    fun `an omitted type compiles as the chat type`() = inDirectory { root ->
        val document = validDocument().copy(agents = listOf(profile("assistant")))
        // encodeDefaults would write the default; strip the field to prove absence is accepted.
        val content = json.encodeToString(document).replace(Regex(",\\s*\"type\"\\s*:\\s*\"NORMAL\""), "")
        assertFalse(Regex("\"type\"\\s*:\\s*\"NORMAL\"").containsMatchIn(content), "The fixture must omit the Agent type field")

        val loaded = source.decode(content, root.resolve("config.json"))

        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val projected = assertNotNull(loaded.value).workspaces.getValue("assistant").document.agents.single()
        assertEquals(AgentType.NORMAL, projected.type)
    }

    @Test
    fun `the type survives projection`() = inDirectory { root ->
        val document = validDocument().copy(
            agents = listOf(profile("assistant", AgentType.DEEPSEEK_HARNESS)),
        )

        val loaded = source.decode(json.encodeToString(document), root.resolve("config.json"))

        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val raw = assertNotNull(loaded.value)
        assertEquals(AgentType.DEEPSEEK_HARNESS, raw.application?.agents?.single()?.type)
        assertEquals(AgentType.DEEPSEEK_HARNESS, raw.workspaces.getValue("assistant").document.agents.single().type)
    }

    @Test
    fun `old preset field is read as type and rewritten on serialization`() = inDirectory { root ->
        val document = validDocument().copy(agents = listOf(profile("assistant", AgentType.DEEPSEEK_HARNESS)))
        val legacyV3 = json.encodeToString(document).replace(Regex("\"type\"\\s*:\\s*\"DEEPSEEK_HARNESS\""), "\"preset\":\"DEEPSEEK_HARNESS\"")
        assertTrue(legacyV3.contains("\"preset\""))
        val loaded = source.decode(legacyV3, root.resolve("config.json"))
        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        assertEquals(AgentType.DEEPSEEK_HARNESS, loaded.value?.application?.agents?.single()?.type)
        val normalized = json.encodeToString(loaded.value!!.application!!)
        assertTrue(normalized.contains("\"type\""))
        assertFalse(normalized.contains("\"preset\""))
    }

    @Test
    fun `Codex type is rejected while its external runner is not installed`() = inDirectory { root ->
        val document = validDocument().copy(agents = listOf(profile("assistant", AgentType.CODEX)))
        val loaded = source.decode(json.encodeToString(document), root.resolve("config.json"))
        assertFalse(loaded.isSuccess)
        assertTrue(loaded.diagnostics.any { it.message.contains("not available") })
        assertTrue(loaded.diagnostics.any { it.message.contains("OPENAI_CHAT_COMPLETIONS") })
    }

    @Test
    fun `an unregistered type is rejected before activation`() = inDirectory { root ->
        val content = json.encodeToString(validDocument().copy(agents = listOf(profile("assistant"))))
            .replace(Regex("\"type\"\\s*:\\s*\"NORMAL\""), "\"type\":\"NOT_A_TYPE\"")

        val loaded = source.decode(content, root.resolve("config.json"))

        assertFalse(loaded.isSuccess, "An unknown type must not produce a usable generation")
        assertEquals(null, loaded.value)
        assertTrue(loaded.diagnostics.isNotEmpty(), "Rejection must be reported")
    }

    private fun profile(id: String, type: AgentType = AgentType.NORMAL) = AgentProfileDocument(
        id = id,
        type = type,
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
