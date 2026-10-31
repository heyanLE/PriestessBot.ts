package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.memory.MemoryScope
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.testMemoryCase
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class MemoryToolsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `save recall and delete memory through tools`() = runBlocking {
        val memory = testMemoryCase("memory-tools-flow")
        val context = AgentToolContext(
            platform = FakePlatform(),
            session = FakePlatform.fakeSession(id = "session-1"),
            agentName = "assistant",
            metadata = mapOf("workspace_id" to "workspace-a", "user_id" to "user-1"),
        )
        val saveTool = MemorySaveTool { memory }
        val recallTool = MemoryRecallTool { memory }
        val deleteTool = MemoryDeleteTool { memory }

        val saved = saveTool.execute(
            context,
            mapOf(
                "content" to "User likes concise Kotlin examples",
                "type" to "preference",
                "scope" to "session",
                "tags" to """["kotlin","style"]""",
                "ttl_seconds" to "60",
            ),
        )

        assertTrue(saved.success)
        val savedResponse = json.decodeFromString<MemorySaveResponse>(saved.output)
        assertNotNull(savedResponse.expiresAt)

        val recalled = recallTool.execute(context, mapOf("query" to "Kotlin", "limit" to "3"))
        val recallResponse = json.decodeFromString<MemoryRecallResponse>(recalled.output)
        assertEquals(listOf(savedResponse.memoryId), recallResponse.results.map { it.id })
        assertEquals("preference", recallResponse.results.single().type)

        val deleted = deleteTool.execute(context, mapOf("memory_id" to savedResponse.memoryId))
        assertTrue(deleted.success)

        val afterDelete = json.decodeFromString<MemoryRecallResponse>(
            recallTool.execute(context, mapOf("query" to "Kotlin")).output,
        )
        assertTrue(afterDelete.results.isEmpty())
    }

    @Test
    fun `save validates required scope key`() = runBlocking {
        val saveTool = MemorySaveTool { testMemoryCase("memory-tools-validation") }

        val result = saveTool.execute(
            AgentToolContext(metadata = mapOf("workspace_id" to "workspace-a")),
            mapOf("content" to "session memory", "scope" to "session"),
        )

        assertFalse(result.success)
        assertEquals("VALIDATION_ERROR", result.errorCode)
    }

    @Test
    fun `memory tools declare permission metadata`() {
        val memory = { testMemoryCase("memory-tools-metadata") }
        val save = MemorySaveTool(memory).schema
        val recall = MemoryRecallTool(memory).schema
        val delete = MemoryDeleteTool(memory).schema

        assertEquals(ToolRiskLevel.STATE_WRITE, save.riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), save.requiredCapabilities)
        assertFalse(save.defaultEnabled)
        assertTrue(save.auditLog)

        assertEquals(ToolRiskLevel.SAFE_READ, recall.riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), recall.requiredCapabilities)
        assertTrue(recall.defaultEnabled)
        assertFalse(recall.auditLog)

        assertEquals(ToolRiskLevel.STATE_WRITE, delete.riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), delete.requiredCapabilities)
        assertFalse(delete.defaultEnabled)
        assertTrue(delete.auditLog)
    }

    @Test
    fun `recall can filter by scope`() = runBlocking {
        val memory = testMemoryCase("memory-tools-scope-filter")
        val context = AgentToolContext(
            session = FakePlatform.fakeSession(id = "session-1"),
            metadata = mapOf("workspace_id" to "workspace-a"),
        )
        MemorySaveTool { memory }.execute(context, mapOf("content" to "global alpha", "scope" to "global"))
        MemorySaveTool { memory }.execute(context, mapOf("content" to "session alpha", "scope" to "session"))

        val response = json.decodeFromString<MemoryRecallResponse>(
            MemoryRecallTool { memory }.execute(context, mapOf("query" to "alpha", "scope" to MemoryScope.SESSION.name)).output,
        )

        assertEquals(listOf("session alpha"), response.results.map { it.content })
    }

    @Test
    fun `workspace memory policy can disable memory tools`() = runBlocking {
        val memory = testMemoryCase("memory-tools-policy-disabled")
        val context = AgentToolContext(
            metadata = mapOf(
                "workspace_id" to "workspace-a",
                "workspace_memory_enabled" to "false",
            ),
        )

        val result = MemorySaveTool { memory }.execute(
            context,
            mapOf("content" to "blocked memory", "scope" to "global"),
        )

        assertFalse(result.success)
        assertEquals("WORKSPACE_MEMORY_DISABLED", result.errorCode)
    }

    @Test
    fun `workspace memory policy restricts scopes and recall limit`() = runBlocking {
        val memory = testMemoryCase("memory-tools-policy-scope")
        val context = AgentToolContext(
            session = FakePlatform.fakeSession(id = "session-1"),
            metadata = mapOf(
                "workspace_id" to "workspace-a",
                "workspace_memory_allowed_scopes" to "SESSION",
                "workspace_memory_max_injected" to "1",
            ),
        )
        val save = MemorySaveTool { memory }
        save.execute(context, mapOf("content" to "session alpha one", "scope" to "session"))
        save.execute(context, mapOf("content" to "session alpha two", "scope" to "session"))

        val denied = save.execute(context, mapOf("content" to "global alpha", "scope" to "global"))
        assertFalse(denied.success)
        assertEquals("WORKSPACE_MEMORY_SCOPE_DENIED", denied.errorCode)

        val response = json.decodeFromString<MemoryRecallResponse>(
            MemoryRecallTool { memory }.execute(context, mapOf("query" to "alpha", "limit" to "10")).output,
        )
        assertEquals(1, response.results.size)
        assertEquals("session", response.results.single().scope)
    }
}
