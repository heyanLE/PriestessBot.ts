package com.heyanle.priestess.bot.memory

import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlin.test.*

class MemoryLibrariesTest {
    @Test
    fun `scope policy is applied before ranking and also guards writes and deletes`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val admin = MemoryScopeContext("platform", sessionId = "group", libraryIds = setOf("shared"))
            val hidden = memory.save("alpha", MemoryType.FACT, MemoryScope.GLOBAL, admin, libraryId = "shared")
            val visible = memory.save("alpha detail", MemoryType.FACT, MemoryScope.SESSION, admin, confidence = 0.1, libraryId = "shared")
            val restricted = admin.copy(allowedScopes = setOf(MemoryScope.SESSION))
            assertEquals(visible.id, memory.search(MemorySearchQuery("alpha", restricted, limit = 1)).single().record.id)
            assertEquals(listOf(visible.id), memory.list(MemoryFilter(restricted)).map { it.id })
            assertFalse(memory.delete(hidden.id, restricted))
            assertFailsWith<IllegalArgumentException> {
                memory.save("no", MemoryType.FACT, MemoryScope.GLOBAL, restricted, libraryId = "shared")
            }
            assertTrue(memory.search(MemorySearchQuery("alpha", admin.copy(allowedScopes = emptySet()))).isEmpty())
            assertFalse(memory.delete(visible.id, admin.copy(allowedScopes = emptySet())))
        } finally { database.stop() }
    }

    @Test
    fun `selected libraries restrict list ranking writes and exact id deletion`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val admin = MemoryScopeContext(workspaceId = "platform")
            val visible = memory.save("shared tea", MemoryType.FACT, MemoryScope.GLOBAL, admin, libraryId = "shared")
            val hidden = memory.save("secret tea tea tea", MemoryType.FACT, MemoryScope.GLOBAL, admin, libraryId = "secret")
            val selected = admin.copy(libraryIds = setOf("shared"))
            assertEquals(listOf(visible.id), memory.list(MemoryFilter(selected)).map { it.id })
            assertEquals(listOf(visible.id), memory.search(MemorySearchQuery("tea", selected, limit = 1)).map { it.record.id })
            assertFalse(memory.delete(hidden.id, selected))
            assertFailsWith<IllegalArgumentException> {
                memory.save("forbidden", MemoryType.FACT, MemoryScope.GLOBAL, selected, libraryId = "secret")
            }
            assertEquals(2, memory.list(MemoryFilter(admin)).size)
            val disabled = admin.copy(libraryIds = emptySet())
            assertTrue(memory.list(MemoryFilter(disabled)).isEmpty())
            assertTrue(memory.search(MemorySearchQuery("", disabled)).isEmpty())
            assertFalse(memory.delete(visible.id, disabled))
            assertTrue(memory.delete(visible.id, selected))
        } finally { database.stop() }
    }

    @Test
    fun `Chinese query finds older relevant records before applying result limit`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val context = MemoryScopeContext(workspaceId = "platform", libraryIds = setOf("preferences"))
            val target = memory.save("我喜欢喝茉莉花茶，回答请简洁", MemoryType.PREFERENCE, MemoryScope.GLOBAL, context,
                libraryId = "preferences")
            repeat(105) { memory.save("unrelated record number $it", MemoryType.FACT, MemoryScope.GLOBAL, context, libraryId = "preferences") }
            val result = memory.search(MemorySearchQuery("下次请记住茉莉花茶偏好", context, limit = 1))
            assertEquals(target.id, result.single().record.id)
            assertTrue(result.single().matchReason.contains("content"))
            assertEquals(result, memory.search(MemorySearchQuery("下次请记住茉莉花茶偏好", context, limit = 1)))
        } finally { database.stop() }
    }

    @Test
    fun `library access does not bypass user group platform or agent scope`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val current = MemoryScopeContext("platform", "qq", "123", "456", "agent-a", setOf("shared"))
            val user = memory.save("user preference", MemoryType.PREFERENCE, MemoryScope.USER, current, libraryId = "shared")
            val session = memory.save("group fact", MemoryType.FACT, MemoryScope.SESSION, current, libraryId = "shared")
            val agent = memory.save("agent fact", MemoryType.FACT, MemoryScope.AGENT, current, libraryId = "shared")
            assertFalse(memory.delete(user.id, current.copy(userId = "other")))
            assertFalse(memory.delete(session.id, current.copy(sessionId = "other")))
            assertFalse(memory.delete(agent.id, current.copy(agentName = "agent-b")))
            assertFalse(memory.delete(user.id, current.copy(platformId = "telegram")))
            assertFalse(memory.delete(session.id, current.copy(platformId = "telegram")))
            assertEquals(setOf(user.id, session.id, agent.id), memory.list(MemoryFilter(current)).map { it.id }.toSet())
        } finally { database.stop() }
    }
}
