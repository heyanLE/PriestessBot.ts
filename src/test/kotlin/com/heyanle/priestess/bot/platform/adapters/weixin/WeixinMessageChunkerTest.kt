package com.heyanle.priestess.bot.platform.adapters.weixin

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WeixinMessageChunkerTest {
    @Test
    fun `chunking preserves unicode and prefers paragraph boundaries`() {
        val text = "第一段\n\n第二段😀😀"
        val chunks = WeixinMessageChunker.split(text, 6)

        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.codePointCount(0, it.length) <= 6 })
        assertEquals("第一段\n\n", chunks.first())
        assertEquals(listOf("😀😀", "😀"), WeixinMessageChunker.split("😀😀😀", 2))
    }

    @Test
    fun `empty content produces no chunks`() {
        assertEquals(emptyList(), WeixinMessageChunker.split("", 2_000))
    }
}
