package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.RawConfigRevision
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

sealed interface PersistResult {
    data class Success(
        val revision: RawConfigRevision,
        val backupPath: Path? = null,
    ) : PersistResult

    data class Conflict(
        val expected: RawConfigRevision?,
        val actual: RawConfigRevision?,
    ) : PersistResult
}

/** Revision-aware atomic text persistence used by global and Workspace authoring files. */
class RevisionedConfigFileStore(
    private val clock: Clock = Clock.systemUTC(),
) {
    fun revision(path: Path): RawConfigRevision? {
        if (!Files.isRegularFile(path)) return null
        return revisionOf(Files.readAllBytes(path))
    }

    fun revisionOf(content: String): RawConfigRevision = revisionOf(content.toByteArray(StandardCharsets.UTF_8))

    fun persist(
        path: Path,
        content: String,
        expectedRevision: RawConfigRevision?,
        isValidExisting: (String) -> Boolean = { it.isNotBlank() },
    ): PersistResult {
        val normalized = path.toAbsolutePath().normalize()
        val actual = revision(normalized)
        if (actual != expectedRevision) return PersistResult.Conflict(expectedRevision, actual)

        val parent = normalized.parent ?: error("Configuration path '$normalized' has no parent")
        Files.createDirectories(parent)
        val existing = normalized.takeIf(Files::isRegularFile)?.let(Files::readString)
        val backup = existing?.takeIf(isValidExisting)?.let { createBackup(normalized, it) }
        val temporary = Files.createTempFile(parent, ".${normalized.fileName}.", ".tmp")
        try {
            val bytes = content.toByteArray(StandardCharsets.UTF_8)
            FileChannel.open(temporary, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING).use { channel ->
                var buffer = ByteBuffer.wrap(bytes)
                while (buffer.hasRemaining()) channel.write(buffer)
                channel.force(true)
            }
            try {
                Files.move(temporary, normalized, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (cause: AtomicMoveNotSupportedException) {
                throw IllegalStateException("Atomic configuration replacement is not supported for '$normalized'", cause)
            }
            return PersistResult.Success(checkNotNull(revision(normalized)), backup)
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    private fun createBackup(path: Path, content: String): Path {
        val directory = path.parent.resolve("backups").resolve(path.fileName.toString())
        Files.createDirectories(directory)
        val timestamp = BACKUP_FORMATTER.format(Instant.now(clock))
        val extension = path.fileName.toString().substringAfterLast('.', missingDelimiterValue = "bak")
        var candidate = directory.resolve("$timestamp.$extension")
        var suffix = 1
        while (Files.exists(candidate)) {
            candidate = directory.resolve("$timestamp-$suffix.$extension")
            suffix += 1
        }
        Files.writeString(candidate, content, StandardOpenOption.CREATE_NEW)
        return candidate
    }

    private fun sha256(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { byte -> "%02x".format(byte) }
    }

    private fun revisionOf(bytes: ByteArray): RawConfigRevision = RawConfigRevision(sha256(bytes))

    companion object {
        private val BACKUP_FORMATTER = DateTimeFormatter
            .ofPattern("yyyyMMdd-HHmmss-SSS")
            .withZone(ZoneOffset.UTC)
    }
}
