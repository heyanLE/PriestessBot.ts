package com.heyanle.priestess.bot.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The persisted `compression.strategy` string is validated against the enum's own allowlist and parsed by
 * the enum's own parser. They were two hand-maintained lists, and adding a strategy to one without the
 * other made an otherwise valid configuration fail activation at startup.
 */
class CompressStrategyConfigNameTest {

    @Test
    fun `every declared config name parses back to its strategy`() {
        CompressStrategy.entries.forEach { strategy ->
            assertEquals(
                strategy,
                CompressStrategy.fromConfigName(strategy.configName),
                "'${strategy.configName}' must parse back to $strategy",
            )
        }
    }

    @Test
    fun `the allowlist equals the set of declared names`() {
        assertEquals(
            CompressStrategy.entries.map { it.configName }.toSet(),
            CompressStrategy.configNames,
        )
    }

    @Test
    fun `every strategy is accepted by validation`() {
        // Guards the exact failure this test exists for: a strategy the compiler supports but the
        // validator rejects.
        CompressStrategy.entries.forEach { strategy ->
            assertTrue(
                strategy.configName in CompressStrategy.configNames,
                "'${strategy.configName}' is compilable but would be rejected by validation",
            )
        }
    }

    @Test
    fun `parsing tolerates case and surrounding whitespace`() {
        assertEquals(CompressStrategy.TOKEN_WINDOW, CompressStrategy.fromConfigName(" Token_Window "))
        assertEquals(CompressStrategy.LLM_SUMMARIZATION, CompressStrategy.fromConfigName("LLM_SUMMARIZATION"))
    }

    @Test
    fun `an unknown name does not parse`() {
        assertNull(CompressStrategy.fromConfigName("semantic_magic"))
        assertNull(CompressStrategy.fromConfigName(""))
    }

    @Test
    fun `the summarization strategy is named in the configuration contract`() {
        assertNotNull(CompressStrategy.fromConfigName("llm_summarization"))
    }
}
