package com.heyanle.priestess.bot.knowledge

import com.heyanle.priestess.bot.testkit.testKnowledgeCase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KnowledgeCaseTest {
    @Test
    fun `creates bases chunks documents and ranks keyword results`() {
        val knowledge = testKnowledgeCase()
        val base = knowledge.createBase("Priestess", "runtime docs")

        val chunks = knowledge.addTextDocument(
            base.id,
            "ops.md",
            """
            PriestessBot runs on the NAS with a Dashboard API.

            The unrelated paragraph talks about weather and music.

            Dashboard deployment packages the Vue frontend.
            """.trimIndent(),
        )

        assertTrue(chunks.size >= 3)
        assertEquals("Priestess", knowledge.listBases().single().name)

        val results = knowledge.search("Dashboard API", base.id, limit = 2)

        assertEquals(2, results.size)
        assertTrue(results.first().score > 0.0)
        assertTrue(results.first().chunk.content.contains("Dashboard", ignoreCase = true))
    }

    @Test
    fun `limits search results`() {
        val knowledge = testKnowledgeCase()
        val base = knowledge.createBase("Limit")
        knowledge.addTextDocument(base.id, "limit.txt", "alpha one\n\nalpha two\n\nalpha three")

        val results = knowledge.search("alpha", base.id, limit = 2)

        assertEquals(2, results.size)
    }
}
