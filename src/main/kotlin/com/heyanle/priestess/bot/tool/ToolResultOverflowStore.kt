package com.heyanle.priestess.bot.tool

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import java.time.Clock
import java.util.UUID
import kotlin.io.path.deleteIfExists

data class StoredToolResult(
    val id: String,
    val conversationId: String,
    val content: String,
    val totalCodePoints: Int,
    val totalBytes: Long,
    val estimatedTokens: Int,
    val createdAtMillis: Long,
    val expiresAtMillis: Long,
)

class ToolResultOverflowStore(
    private val root: Path = Files.createTempDirectory("priestess-tool-results-"),
    private val clock: Clock = Clock.systemUTC(),
) : AutoCloseable {
    private data class Entry(
        val conversationId: String,
        val path: Path,
        val bytes: Long,
        val estimatedTokens: Int,
        val createdAtMillis: Long,
        val expiresAtMillis: Long,
    )
    private val entries = linkedMapOf<String, Entry>()

    init {
        setPermissions(
            root,
            setOf(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE,
            ),
        )
    }

    @Synchronized
    fun store(
        conversationId: String,
        content: String,
        ttlSeconds: Long,
        maxResultBytes: Long,
        maxTotalBytes: Long,
        estimatedTokens: Int = 0,
    ): StoredToolResult? {
        evictExpired()
        val bytes = content.toByteArray(Charsets.UTF_8)
        if (conversationId.isBlank() || maxResultBytes <= 0 || maxTotalBytes <= 0 || bytes.size.toLong() > maxResultBytes) return null
        while (entries.values.sumOf { it.bytes } + bytes.size > maxTotalBytes && entries.isNotEmpty()) delete(entries.entries.first().key)
        if (entries.values.sumOf { it.bytes } + bytes.size > maxTotalBytes) return null
        val id = UUID.randomUUID().toString()
        val createdAt = clock.millis()
        val ttlMillis = ttlSeconds.coerceIn(1, Long.MAX_VALUE / 1000) * 1000
        val expiresAt = if (createdAt > Long.MAX_VALUE - ttlMillis) Long.MAX_VALUE else createdAt + ttlMillis
        val path = root.resolve("$id.txt")
        Files.writeString(path, content, Charsets.UTF_8)
        setPermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
        entries[id] = Entry(
            conversationId = conversationId,
            path = path,
            bytes = bytes.size.toLong(),
            estimatedTokens = estimatedTokens,
            createdAtMillis = createdAt,
            expiresAtMillis = expiresAt,
        )
        return StoredToolResult(
            id = id,
            conversationId = conversationId,
            content = content,
            totalCodePoints = content.codePointCount(0, content.length),
            totalBytes = bytes.size.toLong(),
            estimatedTokens = estimatedTokens,
            createdAtMillis = createdAt,
            expiresAtMillis = expiresAt,
        )
    }

    @Synchronized
    fun read(conversationId: String, id: String): StoredToolResult? {
        evictExpired()
        val entry = entries[id] ?: return null
        if (entry.conversationId != conversationId) return null
        val content = runCatching { Files.readString(entry.path, Charsets.UTF_8) }.getOrNull() ?: run { delete(id); return null }
        return StoredToolResult(
            id = id,
            conversationId = conversationId,
            content = content,
            totalCodePoints = content.codePointCount(0, content.length),
            totalBytes = entry.bytes,
            estimatedTokens = entry.estimatedTokens,
            createdAtMillis = entry.createdAtMillis,
            expiresAtMillis = entry.expiresAtMillis,
        )
    }

    @Synchronized
    private fun evictExpired() { entries.filterValues { it.expiresAtMillis <= clock.millis() }.keys.toList().forEach(::delete) }
    private fun delete(id: String) { entries.remove(id)?.path?.deleteIfExists() }
    @Synchronized override fun close() { entries.keys.toList().forEach(::delete); root.toFile().deleteRecursively() }

    private fun setPermissions(path: Path, permissions: Set<PosixFilePermission>) {
        runCatching { Files.setPosixFilePermissions(path, permissions) }
    }
}
