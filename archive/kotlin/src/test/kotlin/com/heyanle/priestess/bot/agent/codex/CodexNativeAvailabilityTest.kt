package com.heyanle.priestess.bot.agent.codex

import java.nio.file.Files
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class CodexNativeAvailabilityTest {
    @Test
    fun `experimental Codex requires an existing library with a matching checksum`() {
        val library = Files.createTempFile("priestess-codex-", ".dylib")
        Files.writeString(library, "fake-native-library")
        val sha = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(library))
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
        val base = mapOf(
            "PRIESTESS_CODEX_EXPERIMENTAL" to "true",
            "PRIESTESS_CODEX_JNI_LIB" to library.toString(),
            "PRIESTESS_CODEX_JNI_SHA256" to sha,
        )
        assertNull(CodexNativeAvailability.inspect(emptyMap(), "Mac OS X", "aarch64").path)
        assertEquals(library, CodexNativeAvailability.inspect(base, "Mac OS X", "aarch64").path)
        assertNotNull(CodexNativeAvailability.inspect(base + ("PRIESTESS_CODEX_JNI_SHA256" to "0".repeat(64)), "Mac OS X", "aarch64").problem)
        assertNotNull(CodexNativeAvailability.inspect(base, "Linux", "x86_64").problem)
    }
}
