package com.heyanle.priestess.bot.platform.adapters.weixin

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class WeixinStateStoreTest {
    @Test
    fun `cursor and context tokens survive store recreation without credential fields`() {
        val directory = Files.createTempDirectory("weixin-state")
        val first = WeixinStateStore(directory)
        first.initialize()
        first.updateCursor("cursor-2")
        first.updateContextToken("peer-a", "context-a")

        val second = WeixinStateStore(directory)
        second.initialize()

        assertEquals("cursor-2", second.cursor())
        assertEquals("context-a", second.contextToken("peer-a"))
        val raw = Files.readString(directory.resolve("state.json"))
        assertFalse("bot-secret" in raw)
    }

    @Test
    fun `removing one peer token keeps other peer state`() {
        val directory = Files.createTempDirectory("weixin-state-remove")
        val store = WeixinStateStore(directory)
        store.initialize()
        store.updateContextToken("peer-a", "context-a")
        store.updateContextToken("peer-b", "context-b")

        store.removeContextToken("peer-a")

        assertEquals(null, store.contextToken("peer-a"))
        assertEquals("context-b", store.contextToken("peer-b"))
    }

    @Test
    fun `corrupt state fails startup instead of silently advancing`() {
        val directory = Files.createTempDirectory("weixin-state-corrupt")
        Files.writeString(directory.resolve("state.json"), "{broken")

        assertFailsWith<IllegalStateException> {
            WeixinStateStore(directory).initialize()
        }
    }
}
