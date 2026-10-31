package com.heyanle.priestess.bot.memory

import com.heyanle.priestess.bot.testkit.testMemoryCase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MemoryControllerTest {
    @Test
    fun `saves and recalls visible scoped memory only`() {
        val memory = testMemoryCase("memory-scope")
        val current = MemoryScopeContext(
            workspaceId = "workspace-a",
            platformId = "fake",
            sessionId = "session-1",
            userId = "user-1",
            agentName = "assistant",
        )
        val otherSession = current.copy(sessionId = "session-2")

        val visible = memory.save(
            content = "User prefers concise Kotlin examples",
            type = MemoryType.PREFERENCE,
            scope = MemoryScope.SESSION,
            scopeContext = current,
            tags = listOf("kotlin"),
        )
        memory.save(
            content = "User prefers verbose Python examples",
            type = MemoryType.PREFERENCE,
            scope = MemoryScope.SESSION,
            scopeContext = otherSession,
            tags = listOf("python"),
        )

        val results = memory.search(
            MemorySearchQuery(
                query = "Kotlin examples",
                scopeContext = current,
                limit = 5,
            ),
        )

        assertEquals(listOf(visible.id), results.map { it.record.id })
        assertTrue(results.single().matchReason.contains("content"))
    }

    @Test
    fun `excludes expired memory from recall and list`() {
        val memory = testMemoryCase("memory-ttl")
        val context = MemoryScopeContext(workspaceId = "workspace-a")
        memory.save(
            content = "Expired alpha",
            type = MemoryType.FACT,
            scope = MemoryScope.GLOBAL,
            scopeContext = context,
            expiresAt = System.currentTimeMillis() - 1_000,
        )
        val active = memory.save(
            content = "Active alpha",
            type = MemoryType.FACT,
            scope = MemoryScope.GLOBAL,
            scopeContext = context,
            expiresAt = System.currentTimeMillis() + 60_000,
        )

        val listed = memory.list(MemoryFilter(scopeContext = context))
        val searched = memory.search(MemorySearchQuery(query = "alpha", scopeContext = context))

        assertEquals(listOf(active.id), listed.map { it.id })
        assertEquals(listOf(active.id), searched.map { it.record.id })
    }

    @Test
    fun `delete is exact id and respects visibility`() {
        val memory = testMemoryCase("memory-delete")
        val current = MemoryScopeContext(workspaceId = "workspace-a", sessionId = "session-1")
        val hidden = MemoryScopeContext(workspaceId = "workspace-a", sessionId = "session-2")
        val record = memory.save(
            content = "Delete me exactly",
            type = MemoryType.EVENT,
            scope = MemoryScope.SESSION,
            scopeContext = current,
        )

        assertFalse(memory.delete(record.id, hidden))
        assertTrue(memory.delete(record.id, current))
        assertTrue(memory.search(MemorySearchQuery(query = "Delete", scopeContext = current)).isEmpty())
    }
}
