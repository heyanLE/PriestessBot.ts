package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.ToolResultMaterialization
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReadToolResultToolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `reads Unicode-safe windows with offsets and metadata`() = runBlocking {
        val root = Files.createTempDirectory("read-tool-result-test-")
        val store = ToolResultOverflowStore(root)
        try {
            val stored = requireNotNull(store.store("conversation", "A😀BC中D", 60, 1024, 2048))
            val tool = ReadToolResultTool(store)
            val result = tool.execute(
                AgentToolContext(conversationId = "conversation"),
                mapOf("result_id" to stored.id, "offset" to "1", "limit" to "3"),
            )
            val response = json.decodeFromString<ReadToolResultResponse>(result.output)

            assertTrue(result.success)
            assertEquals("😀BC", response.content)
            assertEquals(1, response.offset)
            assertEquals(4, response.nextOffset)
            assertEquals(6, response.totalCodePoints)
            assertEquals(stored.totalBytes, response.totalBytes)
            assertTrue(response.truncated)
            assertEquals(ToolResultMaterialization.INLINE, tool.resultMaterialization)
        } finally {
            store.close()
        }
    }

    @Test
    fun `clamps limits and hides foreign result identifiers`() = runBlocking {
        val root = Files.createTempDirectory("read-tool-result-limit-test-")
        val store = ToolResultOverflowStore(root)
        try {
            val stored = requireNotNull(store.store("owner", "x".repeat(3_000), 60, 10_000, 20_000))
            val tool = ReadToolResultTool(store)
            val bounded = tool.execute(
                AgentToolContext(conversationId = "owner"),
                mapOf("result_id" to stored.id, "limit" to "999999"),
            )
            val response = json.decodeFromString<ReadToolResultResponse>(bounded.output)
            val foreign = tool.execute(
                AgentToolContext(conversationId = "other"),
                mapOf("result_id" to stored.id),
            )

            assertEquals(ReadToolResultTool.MAX_WINDOW_CODE_POINTS, response.content.codePointCount(0, response.content.length))
            assertEquals(ReadToolResultTool.MAX_WINDOW_CODE_POINTS, response.nextOffset)
            assertTrue(response.truncated)
            assertFalse(foreign.success)
            assertEquals("RESULT_NOT_FOUND", foreign.errorCode)
        } finally {
            store.close()
        }
    }
}
