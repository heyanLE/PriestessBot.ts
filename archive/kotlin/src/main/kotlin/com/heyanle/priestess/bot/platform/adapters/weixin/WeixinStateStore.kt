package com.heyanle.priestess.bot.platform.adapters.weixin

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission
import java.util.UUID

@Serializable
internal data class WeixinPersistentState(
    val getUpdatesBuf: String = "",
    val contextTokens: Map<String, String> = emptyMap(),
)

internal class WeixinStateStore(
    directory: Path,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    private val lock = Any()
    private val directory = directory.toAbsolutePath().normalize()
    private val stateFile = this.directory.resolve("state.json")
    private var state = WeixinPersistentState()
    private var initialized = false

    fun initialize() = synchronized(lock) {
        if (initialized) return@synchronized
        Files.createDirectories(directory)
        state = if (Files.exists(stateFile)) {
            try {
                json.decodeFromString(Files.readString(stateFile))
            } catch (error: Exception) {
                throw IllegalStateException("Weixin state file is unreadable: $stateFile", error)
            }
        } else {
            WeixinPersistentState()
        }
        initialized = true
    }

    fun cursor(): String = synchronized(lock) {
        requireInitialized()
        state.getUpdatesBuf
    }

    fun contextToken(peerId: String): String? = synchronized(lock) {
        requireInitialized()
        state.contextTokens[peerId]
    }

    fun updateCursor(cursor: String) = synchronized(lock) {
        requireInitialized()
        if (cursor == state.getUpdatesBuf) return@synchronized
        persist(state.copy(getUpdatesBuf = cursor))
    }

    fun updateContextToken(peerId: String, token: String) = synchronized(lock) {
        requireInitialized()
        if (peerId.isBlank() || token.isBlank() || state.contextTokens[peerId] == token) return@synchronized
        persist(state.copy(contextTokens = state.contextTokens + (peerId to token)))
    }

    fun removeContextToken(peerId: String) = synchronized(lock) {
        requireInitialized()
        if (peerId !in state.contextTokens) return@synchronized
        persist(state.copy(contextTokens = state.contextTokens - peerId))
    }

    internal fun snapshot(): WeixinPersistentState = synchronized(lock) {
        requireInitialized()
        state
    }

    private fun persist(next: WeixinPersistentState) {
        val temporary = directory.resolve("state.json.tmp-${UUID.randomUUID()}")
        try {
            Files.writeString(temporary, json.encodeToString(next))
            setOwnerOnlyPermissions(temporary)
            try {
                Files.move(
                    temporary,
                    stateFile,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary, stateFile, StandardCopyOption.REPLACE_EXISTING)
            }
            setOwnerOnlyPermissions(stateFile)
            state = next
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    private fun setOwnerOnlyPermissions(path: Path) {
        runCatching {
            Files.setPosixFilePermissions(
                path,
                setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE),
            )
        }
    }

    private fun requireInitialized() {
        check(initialized) { "Weixin state store is not initialized" }
    }
}
