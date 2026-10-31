package com.heyanle.priestess.bot.agent.codex

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest

/** Explicit, pinned local opt-in. A missing or mismatched library never enables CODEX. */
object CodexNativeAvailability {
    data class Selection(val path: Path? = null, val problem: String? = null)

    val selection: Selection by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        inspect(System.getenv(), System.getProperty("os.name"), System.getProperty("os.arch"))
    }

    internal fun inspect(environment: Map<String, String>, osName: String, architecture: String): Selection {
        if (environment["PRIESTESS_CODEX_EXPERIMENTAL"] != "true") return Selection()
        val rawPath = environment["PRIESTESS_CODEX_JNI_LIB"]?.takeIf(String::isNotBlank)
            ?: return Selection(problem = "PRIESTESS_CODEX_JNI_LIB is required")
        val expected = environment["PRIESTESS_CODEX_JNI_SHA256"]?.trim()?.lowercase()
            ?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
            ?: return Selection(problem = "PRIESTESS_CODEX_JNI_SHA256 must be a 64-digit hex digest")
        val path = runCatching { Path.of(rawPath).toAbsolutePath().normalize() }.getOrNull()
            ?: return Selection(problem = "Codex JNI path is invalid")
        if (!Files.isRegularFile(path)) return Selection(problem = "Codex JNI library does not exist")
        val os = osName.lowercase()
        val arch = architecture.lowercase()
        val suffix = when {
            "mac" in os -> ".dylib"
            "linux" in os -> ".so"
            else -> return Selection(problem = "Codex JNI is unsupported on this OS")
        }
        if (arch !in setOf("aarch64", "arm64", "amd64", "x86_64")) {
            return Selection(problem = "Codex JNI is unsupported on this CPU architecture")
        }
        if (!path.fileName.toString().endsWith(suffix)) return Selection(problem = "Codex JNI library has the wrong OS suffix")
        val actual = runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            Files.newInputStream(path).use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            digest.digest().joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
        }.getOrNull() ?: return Selection(problem = "Codex JNI checksum could not be read")
        if (actual != expected) return Selection(problem = "Codex JNI checksum does not match")
        return Selection(path = path)
    }
}
