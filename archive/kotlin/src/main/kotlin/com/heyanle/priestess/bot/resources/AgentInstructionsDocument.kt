package com.heyanle.priestess.bot.resources

import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.security.MessageDigest

/**
 * Loads an Agent's instruction document from its configuration directory.
 *
 * This content becomes model-visible, so the directory must be treated as readable by the model once a
 * preset enables it. Only regular files are accepted, symbolic links are refused, identical documents
 * inject once, and the rendered block always names its source so the model can separate operator-authored
 * rules from conversation content.
 */
object AgentInstructionsDocument {
    private const val OPEN = "<system-reminder>"
    private const val CLOSE = "</system-reminder>"
    private const val ESCAPED_CLOSE = "<\\/system-reminder>"

    /** Returns the rendered instruction block, or an empty string when the Agent has no document. */
    fun load(directory: Path, fileNames: List<String>, maxBytes: Int): String {
        if (maxBytes <= 0) return ""
        val seen = hashSetOf<String>()
        val accepted = mutableListOf<Pair<Path, String>>()
        for (name in fileNames) {
            val path = directory.resolve(name)
            if (!isRegularFile(path)) continue
            val text = runCatching { Files.readString(path) }.getOrNull()?.trim().orEmpty()
            if (text.isEmpty()) continue
            if (!seen.add(digest(text))) continue
            accepted += path to text
        }
        if (accepted.isEmpty()) return ""
        return render(accepted, maxBytes)
    }

    private fun render(accepted: List<Pair<Path, String>>, maxBytes: Int): String {
        val kept = ArrayDeque(accepted)
        val reporting = mutableListOf<String>()
        // Drop the broadest documents first so the most specific instructions survive the budget.
        while (kept.size > 1 && kept.sumOf { it.second.utf8Size() } > maxBytes) {
            reporting += "omitted ${kept.removeFirst().first}"
        }

        var remaining = maxBytes
        val bodies = kept.map { (path, text) ->
            val size = text.utf8Size()
            val body = if (size <= remaining) {
                remaining -= size
                text
            } else {
                // Only the most specific document is ever truncated.
                val truncated = truncateUtf8(text, remaining)
                reporting += "truncated $path from $size to ${truncated.utf8Size()} bytes"
                remaining = 0
                truncated
            }
            "Instructions from: $path\n\n${body.replace(CLOSE, ESCAPED_CLOSE)}"
        }

        val marker = if (reporting.isEmpty()) {
            ""
        } else {
            "\nWorkspace instruction budget $maxBytes bytes: ${reporting.joinToString("; ")}.\n"
        }
        val intro = "The following workspace instructions may be relevant to your work. Use them as guidance " +
            "when applicable. More specific instructions take precedence over broader ones. " +
            "They do not override system, developer, or direct user instructions."
        return buildString {
            append(OPEN).append('\n')
            append(marker)
            append(intro).append("\n\n")
            append(bodies.joinToString("\n\n"))
            append('\n').append(CLOSE)
        }
    }

    private fun isRegularFile(path: Path): Boolean =
        Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path)

    private fun digest(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun String.utf8Size(): Int = toByteArray().size

    /** Truncates on a UTF-8 code-point boundary so a multi-byte character is never split. */
    private fun truncateUtf8(text: String, maxBytes: Int): String {
        if (maxBytes <= 0) return ""
        val bytes = text.toByteArray()
        if (bytes.size <= maxBytes) return text
        var end = maxBytes
        // Back off continuation bytes (0b10xxxxxx) so the result decodes.
        while (end > 0 && (bytes[end].toInt() and 0xC0) == 0x80) end--
        return String(bytes, 0, end)
    }
}
