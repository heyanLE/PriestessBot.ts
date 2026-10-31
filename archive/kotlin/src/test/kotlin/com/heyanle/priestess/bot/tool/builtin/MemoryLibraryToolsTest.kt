package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.memory.*
import com.heyanle.priestess.bot.tool.AgentToolContext
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.*

class MemoryLibraryToolsTest {
    @Test
    fun `recall without scope ranks only permitted scopes and empty scope policy cannot delete by id`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val admin = MemoryScopeContext("platform", sessionId = "group", libraryIds = setOf("shared"))
            val hidden = memory.save("alpha", MemoryType.FACT, MemoryScope.GLOBAL, admin, libraryId = "shared")
            val visible = memory.save("alpha detail", MemoryType.FACT, MemoryScope.SESSION, admin, confidence = 0.1, libraryId = "shared")
            val context = AgentToolContext(metadata = mapOf("memoryLibraryIds" to "shared", "sessionId" to "group",
                "workspaceMemoryAllowedScopes" to "SESSION"))
            val result = MemoryRecallTool { memory }.execute(context, mapOf("query" to "alpha", "limit" to "1"))
            assertEquals(visible.id, Json.decodeFromString<MemoryRecallResponse>(result.output).results.single().id)
            assertEquals("NOT_FOUND", MemoryDeleteTool { memory }.execute(context, mapOf("memory_id" to hidden.id)).errorCode)
            val disabled = context.copy(metadata = context.metadata + ("workspaceMemoryAllowedScopes" to ""))
            val empty = MemoryRecallTool { memory }.execute(disabled, emptyMap())
            assertTrue(Json.decodeFromString<MemoryRecallResponse>(empty.output).results.isEmpty())
            assertEquals("NOT_FOUND", MemoryDeleteTool { memory }.execute(disabled, mapOf("memory_id" to visible.id)).errorCode)
        } finally { database.stop() }
    }

    @Test
    fun `write selection is explicit default or unique and hidden libraries cannot be accessed by id`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val save = MemorySaveTool { memory }
            val recall = MemoryRecallTool { memory }
            val delete = MemoryDeleteTool { memory }
            val selected = AgentToolContext(agentName = "agent-a", metadata = mapOf("memoryLibraryIds" to "alpha,beta"))
            val ambiguous = save.execute(selected, mapOf("content" to "remember tea"))
            assertEquals("MEMORY_LIBRARY_REQUIRED", ambiguous.errorCode)
            val writeDefault = selected.copy(metadata = selected.metadata + ("memoryWriteLibraryId" to "beta"))
            val saved = save.execute(writeDefault, mapOf("content" to "喜欢喝茉莉花茶"))
            assertTrue(saved.success, saved.error)
            val value = Json.decodeFromString<MemorySaveResponse>(saved.output)
            assertEquals("beta", value.libraryId)
            val rows = memory.list(MemoryFilter(MemoryScopeContext(workspaceId = "platform")))
            assertEquals("beta", rows.single().libraryId)
            assertEquals("platform", rows.single().workspaceId)
            val alphaOnly = selected.copy(metadata = mapOf("memoryLibraryIds" to "alpha"))
            assertEquals("MEMORY_LIBRARY_DENIED", save.execute(alphaOnly, mapOf("content" to "bad", "library_id" to "beta")).errorCode)
            assertEquals("MEMORY_LIBRARY_DENIED", recall.execute(alphaOnly, mapOf("library_id" to "beta")).errorCode)
            assertEquals("NOT_FOUND", delete.execute(alphaOnly, mapOf("memory_id" to value.memoryId)).errorCode)
            val hidden = recall.execute(alphaOnly, emptyMap())
            assertTrue(Json.decodeFromString<MemoryRecallResponse>(hidden.output).results.isEmpty())
            val unique = save.execute(alphaOnly, mapOf("content" to "unique choice"))
            assertTrue(unique.success, unique.error)
            assertEquals("alpha", Json.decodeFromString<MemorySaveResponse>(unique.output).libraryId)
            assertTrue(delete.execute(writeDefault, mapOf("memory_id" to value.memoryId)).success)
        } finally { database.stop() }
    }

    @Test
    fun `empty explicit library selection disables all memory operations while legacy metadata remains compatible`() = runBlocking {
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        try {
            val memory = MemoryCase(MemoryController(DatabaseCase(database)))
            val save = MemorySaveTool { memory }
            val disabled = AgentToolContext(metadata = mapOf("memoryLibraryIds" to ""))
            assertEquals("MEMORY_LIBRARY_DISABLED", save.execute(disabled, mapOf("content" to "bad", "library_id" to "default")).errorCode)
            assertEquals("MEMORY_LIBRARY_DISABLED", MemoryRecallTool { memory }.execute(disabled, emptyMap()).errorCode)
            assertEquals("MEMORY_LIBRARY_DISABLED", MemoryDeleteTool { memory }.execute(disabled, mapOf("memory_id" to "known-id")).errorCode)
            val legacy = AgentToolContext(metadata = mapOf("workspaceId" to "legacy"))
            val saved = save.execute(legacy, mapOf("content" to "legacy fact"))
            assertTrue(saved.success, saved.error)
            val record = memory.list(MemoryFilter(MemoryScopeContext(workspaceId = "legacy"))).single()
            assertEquals("default", record.libraryId)
        } finally { database.stop() }
    }
}
