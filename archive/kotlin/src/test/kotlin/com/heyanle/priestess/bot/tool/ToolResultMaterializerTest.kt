package com.heyanle.priestess.bot.tool

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ToolResultMaterializerTest {
    @Test
    fun `keeps small success and failure payloads unchanged`() {
        val root = Files.createTempDirectory("tool-result-materializer-small-")
        val store = ToolResultOverflowStore(root)
        try {
            val materializer = ToolResultMaterializer(store)
            val config = config(inlineTokens = 100)

            assertEquals("small output", materializer.materialize("conversation", ToolResult.success("small output"), config))
            assertEquals("small error", materializer.materialize("conversation", ToolResult.error("small error", "SMALL"), config))
            assertTrue(Files.list(root).use { it.findAny().isEmpty })
        } finally {
            store.close()
        }
    }

    @Test
    fun `stores oversized success and failure with recoverable metadata`() {
        val root = Files.createTempDirectory("tool-result-materializer-large-")
        val store = ToolResultOverflowStore(root)
        try {
            val materializer = ToolResultMaterializer(store)
            val config = config()
            val successContent = "😀success".repeat(40)
            val failureContent = "失败详情".repeat(40)

            val successObservation = materializer.materialize("conversation", ToolResult.success(successContent), config)
            val failureObservation = materializer.materialize(
                "conversation",
                ToolResult.error(failureContent, "UPSTREAM FAILURE"),
                config,
            )

            val successId = assertNotNull(resultId(successObservation))
            val failureId = assertNotNull(resultId(failureObservation))
            assertEquals(successContent, store.read("conversation", successId)?.content)
            assertEquals(failureContent, store.read("conversation", failureId)?.content)
            assertTrue(successObservation.contains("status=success"))
            assertTrue(failureObservation.contains("status=error"))
            assertTrue(failureObservation.contains("error_code=UPSTREAM_FAILURE"))
            assertTrue(successObservation.contains("next_offset="))
            assertFalse(successObservation.substringBefore("\n\n[TOOL_RESULT").endsWith("\uD83D"))
        } finally {
            store.close()
        }
    }

    @Test
    fun `preserves source truncation and bounds unavailable results`() {
        val root = Files.createTempDirectory("tool-result-materializer-unavailable-")
        val store = ToolResultOverflowStore(root)
        try {
            val materializer = ToolResultMaterializer(store)
            val content = """{"truncated":true,"text":"${"x".repeat(200)}"}"""
            val observation = materializer.materialize(
                "conversation",
                ToolResult.success(content),
                config(maxResultBytes = 8, maxTotalBytes = 8),
            )

            assertTrue(observation.contains("TOOL_RESULT_OVERFLOW_UNAVAILABLE"))
            assertTrue(observation.contains("source_truncated=true"))
            assertFalse(observation.contains(content))
            assertTrue(Files.list(root).use { it.findAny().isEmpty })
        } finally {
            store.close()
        }
    }

    private fun config(
        inlineTokens: Int = 5,
        maxResultBytes: Long = 4096,
        maxTotalBytes: Long = 8192,
    ) = ToolResultMaterializationConfig(
        inlineTokens = inlineTokens,
        previewTokens = 2,
        ttlSeconds = 60,
        maxResultBytes = maxResultBytes,
        maxTotalBytes = maxTotalBytes,
    )

    private fun resultId(observation: String): String? = Regex("result_id=([A-Za-z0-9-]+)")
        .find(observation)
        ?.groupValues
        ?.get(1)
}
