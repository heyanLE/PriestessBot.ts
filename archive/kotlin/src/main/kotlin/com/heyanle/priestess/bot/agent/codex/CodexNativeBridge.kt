package com.heyanle.priestess.bot.agent.codex

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Thin native boundary. JSON keeps Codex protocol types out of the Agent and pipeline layers. */
internal object CodexNativeBridge {
    private var loadedPath: Path? = null

    @Synchronized
    fun load(library: Path) {
        val path = library.toAbsolutePath().normalize()
        loadedPath?.let { loaded ->
            require(loaded == path) { "Codex JNI library is already loaded from $loaded" }
            return
        }
        require(Files.isRegularFile(path)) { "Codex JNI library is unavailable: $path" }
        System.load(path.toString())
        loadedPath = path
    }

    external fun create(optionsJson: String): Long
    external fun startThread(handle: Long, paramsJson: String): String
    external fun resumeThread(handle: Long, paramsJson: String): String
    external fun submitTurn(handle: Long, threadId: String, requestJson: String): String
    external fun threadUsage(handle: Long, threadId: String): String
    external fun pollEvent(handle: Long, threadId: String, timeoutMillis: Int): String
    external fun ackEvent(handle: Long, threadId: String, sequence: Long)
    external fun dynamicToolResponse(handle: Long, threadId: String, callId: String, responseJson: String)
    external fun reviewDecision(handle: Long, threadId: String, requestJson: String)
    external fun interrupt(handle: Long, threadId: String)
    external fun close(handle: Long)
}

/** An explicit opt-in native session; callers own its lifecycle and serialize turns per thread. */
internal interface CodexNativePort : AutoCloseable {
    suspend fun startThread(paramsJson: String): String
    suspend fun resumeThread(paramsJson: String): String
    suspend fun submitTurn(threadId: String, requestJson: String): String
    suspend fun threadUsage(threadId: String): String = """{"total_token_usage":null}"""
    suspend fun pollEvent(threadId: String, timeoutMillis: Int = 1000): String
    suspend fun ackEvent(threadId: String, sequence: Long)
    suspend fun dynamicToolResponse(threadId: String, callId: String, responseJson: String)
    suspend fun reviewDecision(threadId: String, requestJson: String)
    suspend fun interrupt(threadId: String)
}

internal class CodexNativeSession private constructor(handle: Long) : CodexNativePort {
    private val nativeHandle = AtomicLong(handle)

    companion object {
        fun open(library: Path, optionsJson: String): CodexNativeSession {
            CodexNativeBridge.load(library)
            val handle = CodexNativeBridge.create(optionsJson)
            check(handle != 0L) { "Codex JNI returned an invalid handle" }
            return CodexNativeSession(handle)
        }
    }

    private fun handle(): Long = nativeHandle.get().takeIf { it != 0L }
        ?: error("Codex native session is closed")

    override suspend fun startThread(paramsJson: String): String = withContext(Dispatchers.IO) {
        CodexNativeBridge.startThread(handle(), paramsJson)
    }

    override suspend fun resumeThread(paramsJson: String): String = withContext(Dispatchers.IO) {
        CodexNativeBridge.resumeThread(handle(), paramsJson)
    }

    override suspend fun submitTurn(threadId: String, requestJson: String): String = withContext(Dispatchers.IO) {
        CodexNativeBridge.submitTurn(handle(), threadId, requestJson)
    }

    override suspend fun threadUsage(threadId: String): String = withContext(Dispatchers.IO) {
        CodexNativeBridge.threadUsage(handle(), threadId)
    }

    /** A result repeats until acked, so coroutine cancellation after JNI returns cannot lose an event. */
    override suspend fun pollEvent(threadId: String, timeoutMillis: Int): String = withContext(Dispatchers.IO) {
        CodexNativeBridge.pollEvent(handle(), threadId, timeoutMillis)
    }

    override suspend fun ackEvent(threadId: String, sequence: Long) = withContext(Dispatchers.IO) {
        CodexNativeBridge.ackEvent(handle(), threadId, sequence)
    }

    override suspend fun dynamicToolResponse(threadId: String, callId: String, responseJson: String) = withContext(Dispatchers.IO) {
        CodexNativeBridge.dynamicToolResponse(handle(), threadId, callId, responseJson)
    }

    override suspend fun reviewDecision(threadId: String, requestJson: String) = withContext(Dispatchers.IO) {
        CodexNativeBridge.reviewDecision(handle(), threadId, requestJson)
    }

    override suspend fun interrupt(threadId: String) = withContext(Dispatchers.IO) {
        CodexNativeBridge.interrupt(handle(), threadId)
    }

    override fun close() {
        val handle = nativeHandle.getAndSet(0)
        if (handle != 0L) CodexNativeBridge.close(handle)
    }
}
