package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.testkit.testKnowledgeCase
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KnowledgeSearchToolTest {
    @Test
    fun `knowledge search tool returns snippets`() = runBlocking {
        val knowledge = testKnowledgeCase()
        val base = knowledge.createBase("Docs")
        knowledge.addTextDocument(base.id, "dashboard.md", "Dashboard can test Agent responses.")
        val tool = KnowledgeSearchTool { knowledge }

        val result = tool.execute(AgentToolContext(), mapOf("query" to "Agent Dashboard"))

        assertTrue(result.success)
        assertTrue(result.output.contains("dashboard.md"))
        assertTrue(result.output.contains("Agent"))
    }

    @Test
    fun `knowledge search tool reports empty results successfully`() = runBlocking {
        val knowledge = testKnowledgeCase()
        knowledge.createBase("Docs")
        val tool = KnowledgeSearchTool { knowledge }

        val result = tool.execute(AgentToolContext(), mapOf("query" to "missing"))

        assertTrue(result.success)
        assertTrue(result.output.contains("No knowledge results"))
    }

    @Test
    fun `workspace memory policy restricts knowledge base access`() = runBlocking {
        val knowledge = testKnowledgeCase()
        val allowed = knowledge.createBase("Allowed")
        val denied = knowledge.createBase("Denied")
        knowledge.addTextDocument(allowed.id, "allowed.md", "alpha allowed workspace content")
        knowledge.addTextDocument(denied.id, "denied.md", "alpha denied workspace content")
        val tool = KnowledgeSearchTool { knowledge }
        val context = AgentToolContext(
            metadata = mapOf("workspace_memory_knowledge_base_ids" to allowed.id),
        )

        val scoped = tool.execute(context, mapOf("query" to "alpha"))
        assertTrue(scoped.success)
        assertTrue(scoped.output.contains("allowed.md"))
        assertFalse(scoped.output.contains("denied.md"))

        val rejected = tool.execute(context, mapOf("query" to "alpha", "knowledgeBaseId" to denied.id))
        assertFalse(rejected.success)
        assertEquals("WORKSPACE_KNOWLEDGE_BASE_DENIED", rejected.errorCode)
    }
}
