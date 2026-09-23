package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.AgentPreset
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * `config.example.json` is what a new deployment copies, so it must validate and must itself carry a
 * usable baseline rather than the values that made the default Agent underperform.
 */
class ConfigExampleTest {

    @Test
    fun `example configuration validates and carries the runtime baseline`() {
        val file = listOf(File("config.example.json"), File("../config.example.json")).firstOrNull { it.isFile }
        assertNotNull(file, "Cannot locate config.example.json from ${File(".").absolutePath}")

        val source = ApplicationConfigurationSource()
        val loaded = source.decode(file.readText(), file.toPath())

        assertTrue(loaded.isSuccess, "config.example.json must validate: ${loaded.diagnostics}")
        val document = assertNotNull(loaded.value).application
        assertNotNull(document)
        assertTrue(
            document.ims.isEmpty(), "The example ships without IM connections; the operator adds their own",
        )
        val chatAgent = document.agents.first { it.preset == AgentPreset.NORMAL }
        assertFalse(
            chatAgent.instructions.contains("Route each request", ignoreCase = true),
            "The example chat Agent must answer requests itself, not claim a routing role it has no tool for",
        )
        assertTrue(
            chatAgent.execution.maxSteps >= 20,
            "The example chat Agent must permit a multi-step tool workflow, was ${chatAgent.execution.maxSteps}",
        )
        assertTrue(
            chatAgent.context.compression.maxTokens >= 16_384,
            "The example chat Agent must have a window that fits an assembled request, was ${chatAgent.context.compression.maxTokens}",
        )

        // The example must also show the task preset actually configured for real work, not just named.
        val taskAgent = document.agents.first { it.preset == AgentPreset.DEEPSEEK_HARNESS }
        assertTrue(
            taskAgent.execution.maxSteps > chatAgent.execution.maxSteps,
            "The example task Agent must out-budget the chat Agent, was ${taskAgent.execution.maxSteps}",
        )
        assertTrue(
            taskAgent.context.compression.maxTokens > chatAgent.context.compression.maxTokens,
            "The example task Agent must out-window the chat Agent",
        )
        assertEquals(
            "llm_summarization",
            taskAgent.context.compression.strategy,
            "The example task Agent must select the summarization strategy explicitly: a preset does not default it yet",
        )
        assertNotEquals(
            chatAgent.configDirectory,
            taskAgent.configDirectory,
            "Each Agent needs its own configuration directory for its instruction document",
        )
    }
}
