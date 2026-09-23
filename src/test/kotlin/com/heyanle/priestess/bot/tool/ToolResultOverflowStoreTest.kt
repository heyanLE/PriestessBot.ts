package com.heyanle.priestess.bot.tool

import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ToolResultOverflowStoreTest {
    @Test
    fun `stores UTF-8 metadata and enforces conversation ownership`() {
        val root = Files.createTempDirectory("tool-result-store-test-")
        val clock = MutableClock(Instant.parse("2026-09-08T00:00:00Z"))
        val store = ToolResultOverflowStore(root, clock)
        try {
            val first = assertNotNull(store.store("conversation-a", "A😀中", 60, 1024, 2048, estimatedTokens = 7))
            val second = assertNotNull(store.store("conversation-a", "other", 60, 1024, 2048))

            assertNotEquals(first.id, second.id)
            assertEquals(3, first.totalCodePoints)
            assertEquals("A😀中".toByteArray().size.toLong(), first.totalBytes)
            assertEquals(7, first.estimatedTokens)
            assertEquals(clock.millis(), first.createdAtMillis)
            assertEquals(clock.millis() + 60_000, first.expiresAtMillis)
            assertEquals("A😀中", store.read("conversation-a", first.id)?.content)
            assertNull(store.read("conversation-b", first.id))
            assertTrue(Files.exists(root.resolve("${first.id}.txt")))

            runCatching { Files.getPosixFilePermissions(root.resolve("${first.id}.txt")) }
                .getOrNull()
                ?.let { permissions ->
                    assertEquals(
                        setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
                        permissions,
                    )
                }
        } finally {
            store.close()
        }
        assertFalse(Files.exists(root))
    }

    @Test
    fun `evicts expired and oldest entries while enforcing capacities`() {
        val root = Files.createTempDirectory("tool-result-capacity-test-")
        val clock = MutableClock(Instant.parse("2026-09-08T00:00:00Z"))
        val store = ToolResultOverflowStore(root, clock)
        try {
            val oldest = assertNotNull(store.store("conversation", "12345", 60, 5, 8))
            val newest = assertNotNull(store.store("conversation", "67890", 60, 5, 8))
            assertNull(store.read("conversation", oldest.id))
            assertEquals("67890", store.read("conversation", newest.id)?.content)
            assertNull(store.store("conversation", "too-large", 60, 5, 100))

            val expiring = assertNotNull(store.store("conversation", "ttl", 1, 5, 8))
            clock.advanceSeconds(2)
            assertNull(store.read("conversation", expiring.id))
            assertFalse(Files.exists(root.resolve("${expiring.id}.txt")))
        } finally {
            store.close()
        }
    }

    private class MutableClock(
        private var current: Instant,
        private val zone: ZoneId = ZoneOffset.UTC,
    ) : Clock() {
        override fun getZone(): ZoneId = zone
        override fun withZone(zone: ZoneId): Clock = MutableClock(current, zone)
        override fun instant(): Instant = current
        fun advanceSeconds(seconds: Long) {
            current = current.plusSeconds(seconds)
        }
    }
}
