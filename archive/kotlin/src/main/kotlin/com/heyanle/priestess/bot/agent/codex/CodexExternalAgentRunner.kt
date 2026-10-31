package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.ExternalAgentRunner
import com.heyanle.priestess.bot.agent.ExternalAgentTurn
import com.heyanle.priestess.bot.agent.ManagedExternalAgentRunner
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.ToolInjectionMode
import com.heyanle.priestess.bot.config.model.WireProtocol
import com.heyanle.priestess.bot.tool.ToolCase
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** A disabled-by-default CODEX implementation. Registration and activation are separate P5 gates. */
internal class CodexExternalAgentRunner(
    private val library: Path,
    private val toolCase: ToolCase? = null,
    private val nativeFactory: (Path, String) -> CodexNativePort = CodexNativeSession::open,
) : ManagedExternalAgentRunner {
    private val slots = ConcurrentHashMap<String, AgentSlot>()

    override suspend fun run(turn: ExternalAgentTurn): AgentResponse = withContext(Dispatchers.IO) {
        if (turn.toolInjectionMode !in setOf(ToolInjectionMode.NONE, ToolInjectionMode.MULTI)) {
            return@withContext AgentResponse.Error("Codex route tool mode is not supported")
        }
        if (turn.toolInjectionMode == ToolInjectionMode.MULTI && toolCase == null) {
            return@withContext AgentResponse.Error("Codex tool dispatcher is unavailable")
        }
        if (turn.provider.protocol != WireProtocol.OPENAI_RESPONSES) {
            return@withContext AgentResponse.Error("Codex requires an OPENAI_RESPONSES connection")
        }
        val configDirectory = turn.context.metadata["agentConfigDirectory"]?.takeIf(String::isNotBlank)
            ?: return@withContext AgentResponse.Error("Codex Agent configuration directory is unavailable")
        val tempDirectory = turn.context.metadata["agentTempDirectory"]?.takeIf(String::isNotBlank)
            ?: return@withContext AgentResponse.Error("Codex Agent temporary directory is unavailable")
        val home = Path.of(configDirectory).toAbsolutePath().normalize().resolve("codex-home")
        val workspace = Path.of(tempDirectory).toAbsolutePath().normalize()
        val slotKey = "${turn.context.agent.name}\u0000$home"
        val slot = slots.computeIfAbsent(slotKey) { AgentSlot(home) }
        val workspaceId = turn.context.metadata["workspaceId"]?.takeIf(String::isNotBlank)
            ?: return@withContext AgentResponse.Error("Codex workspace identity is unavailable")
        val platformId = turn.context.platform?.metadata?.name?.takeIf(String::isNotBlank)
            ?: return@withContext AgentResponse.Error("Codex IM identity is unavailable")
        val sessionId = turn.context.session?.id?.takeIf(String::isNotBlank)
            ?: return@withContext AgentResponse.Error("Codex session identity is unavailable")
        val conversationKey = digest(JsonArray(listOf(
            JsonPrimitive(workspaceId),
            JsonPrimitive(turn.context.agent.name),
            JsonPrimitive(platformId),
            JsonPrimitive(sessionId),
        )).toString())
        val conversationLock = slot.conversations.computeIfAbsent(conversationKey) { Mutex() }
        conversationLock.withLock {
            val providerFingerprint = providerFingerprint(turn.provider)
            val generation = try {
                acquire(slot, providerFingerprint, turn.provider)
            } catch (_: Exception) {
                return@withLock AgentResponse.Error("Codex native engine could not start")
            }
            try {
                val dispatcher = if (turn.toolInjectionMode == ToolInjectionMode.MULTI) {
                    CodexToolDispatcher(turn.context, checkNotNull(toolCase))
                } else null
                val instructions = instructions(turn, dispatcher)
                val agentFingerprint = digest(listOf(turn.context.agent.model, instructions).joinToString("\u0000"))
                val params = CodexProviderBootstrap.threadParams(workspace, turn.context.agent.model, instructions)
                val stored = if (conversationKey in slot.quarantinedConversations) null else slot.store.get(conversationKey)
                val opened = generation.loadedThreads[conversationKey]
                    ?.takeIf { it.agentFingerprint == agentFingerprint }
                    ?.let { OpenedThread(it.threadId, null) }
                    ?: openThread(generation, slot, conversationKey, stored, providerFingerprint, agentFingerprint, params)
                val resetReason = slot.resetNotices.remove(conversationKey) ?: opened.resetReason
                val response = CodexTurnExecutor(generation.native, tools = dispatcher, trace = turn.context.executionTrace)
                    .run(opened.threadId, turn.userContent)
                if (response is AgentResponse.Error) invalidate(slot, generation, conversationKey)
                if (response is AgentResponse.Final && resetReason != null) {
                    response.copy(content = "$resetReason\n\n${response.content}")
                } else response
            } catch (cancelled: CancellationException) {
                invalidate(slot, generation, conversationKey)
                throw cancelled
            } catch (_: Exception) {
                invalidate(slot, generation, conversationKey)
                AgentResponse.Error("Codex native turn failed")
            } finally {
                release(slot, generation)
            }
        }
    }

    private fun instructions(turn: ExternalAgentTurn, dispatcher: CodexToolDispatcher?): String = buildString {
        append(turn.context.agent.instructions)
        if (dispatcher?.isAllowed("use_skill") == true) {
            val references = turn.context.skillState.authorizedReferences()
            if (references.isNotEmpty()) {
                append("\n\nAvailable skills (load one with use_skill before following it):")
                references.take(MAX_LISTED_SKILLS).forEach { skill ->
                    append("\n- ").append(skill.name)
                    skill.description.takeIf(String::isNotBlank)?.let { append(": ").append(it.take(256)) }
                }
                if (references.size > MAX_LISTED_SKILLS) append("\n- Additional authorized skills can be loaded by exact name.")
            }
        }
    }

    private suspend fun openThread(
        generation: Generation,
        slot: AgentSlot,
        conversationKey: String,
        stored: StoredThread?,
        providerFingerprint: String,
        agentFingerprint: String,
        params: String,
    ): OpenedThread {
        val canResume = stored != null && stored.providerFingerprint == providerFingerprint &&
            stored.agentFingerprint == agentFingerprint && Files.isRegularFile(Path.of(stored.rolloutPath))
        val request = if (canResume) {
            val original = Json.parseToJsonElement(params).jsonObject
            JsonObject(original + ("rollout_path" to JsonPrimitive(stored.rolloutPath))).toString()
        } else params
        var resetReason = if (stored != null && !canResume) "之前的会话配置已变化，已开始新会话。" else null
        val infoJson = if (canResume) {
            try {
                generation.native.resumeThread(request)
            } catch (_: Exception) {
                resetReason = "之前的会话无法恢复，已开始新会话。"
                generation.native.startThread(params)
            }
        } else generation.native.startThread(request)
        val info = Json.parseToJsonElement(infoJson).jsonObject
        val threadId = info["thread_id"]?.jsonPrimitive?.content
            ?: error("Codex returned no thread id")
        val rolloutPath = info["rollout_path"]?.jsonPrimitive?.content?.takeIf(String::isNotBlank)
            ?: error("Codex returned no persistent rollout path")
        slot.store.put(conversationKey, StoredThread(threadId, rolloutPath, providerFingerprint, agentFingerprint))
        slot.quarantinedConversations.remove(conversationKey)
        generation.loadedThreads[conversationKey] = LoadedThread(threadId, agentFingerprint)
        return OpenedThread(threadId, resetReason)
    }

    private suspend fun acquire(slot: AgentSlot, fingerprint: String, provider: EffectiveProviderConnection): Generation {
        while (true) {
            var waiter: CompletableDeferred<Unit>? = null
            val ready = slot.guard.withLock {
                val current = slot.generation
                if (current != null && current.fingerprint == fingerprint && !current.poisoned) {
                    current.activeTurns++
                    current
                } else if (current != null && current.activeTurns > 0) {
                    waiter = CompletableDeferred()
                    current.waiters += checkNotNull(waiter)
                    null
                } else {
                    slot.generation = null
                    current?.native?.close()
                    Files.createDirectories(slot.home)
                    val native = nativeFactory(library, CodexProviderBootstrap.engineOptions(slot.home, provider))
                    Generation(fingerprint, native).also { next ->
                        next.activeTurns = 1
                        slot.generation = next
                    }
                }
            }
            if (ready != null) return ready
            checkNotNull(waiter).await()
        }
    }

    private suspend fun release(slot: AgentSlot, generation: Generation) {
        slot.guard.withLock {
            generation.activeTurns--
            check(generation.activeTurns >= 0)
            if (generation.activeTurns == 0) {
                generation.waiters.forEach { it.complete(Unit) }
                generation.waiters.clear()
            }
        }
    }

    /** A failed turn may leave native work and queued events behind; never feed its thread to a later turn. */
    private suspend fun invalidate(slot: AgentSlot, generation: Generation, conversationKey: String) = withContext(NonCancellable) {
        slot.guard.withLock {
            generation.poisoned = true
            generation.loadedThreads.remove(conversationKey)
        }
        slot.quarantinedConversations.add(conversationKey)
        runCatching { slot.store.remove(conversationKey) }
        slot.resetNotices[conversationKey] = "上一轮 Codex 执行未正常结束，已开始新会话。"
    }

    /** Called after the message pipeline has drained. Never replay a turn during shutdown. */
    override suspend fun stop() = withContext(Dispatchers.IO) {
        slots.values.forEach { slot ->
            slot.guard.withLock {
                check(slot.generation?.activeTurns == 0) { "Codex shutdown requires a drained pipeline" }
                slot.generation?.native?.close()
                slot.generation = null
            }
        }
        slots.clear()
    }

    private fun providerFingerprint(provider: EffectiveProviderConnection): String = digest(listOf(
        provider.id, provider.endpoint, provider.protocol?.name.orEmpty(), provider.credential?.reveal().orEmpty(),
    ).joinToString("\u0000"))

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private class AgentSlot(val home: Path) {
        val guard = Mutex()
        val conversations = ConcurrentHashMap<String, Mutex>()
        val store = CodexThreadStore(home.resolve("priestess-threads.json"))
        val quarantinedConversations = ConcurrentHashMap.newKeySet<String>()
        val resetNotices = ConcurrentHashMap<String, String>()
        var generation: Generation? = null
    }

    private class Generation(val fingerprint: String, val native: CodexNativePort) {
        var activeTurns = 0
        var poisoned = false
        val waiters = mutableListOf<CompletableDeferred<Unit>>()
        val loadedThreads = ConcurrentHashMap<String, LoadedThread>()
    }

    private data class LoadedThread(val threadId: String, val agentFingerprint: String)
    private data class OpenedThread(val threadId: String, val resetReason: String?)

    private companion object { const val MAX_LISTED_SKILLS = 100 }
}

@Serializable
private data class StoredThread(
    val threadId: String,
    val rolloutPath: String,
    val providerFingerprint: String,
    val agentFingerprint: String,
)

/** Atomic, per-Agent mapping. It stores fingerprints and rollout paths, never credentials. */
private class CodexThreadStore(private val path: Path) {
    private val guard = Mutex()
    private val json = Json { encodeDefaults = true }

    suspend fun get(key: String): StoredThread? = guard.withLock { read()[key] }

    suspend fun put(key: String, value: StoredThread) = guard.withLock {
        write(read() + (key to value))
    }

    suspend fun remove(key: String) = guard.withLock {
        val old = read()
        if (key in old) write(old - key)
    }

    private fun write(updated: Map<String, StoredThread>) {
        Files.createDirectories(path.parent)
        val temp = Files.createTempFile(path.parent, ".priestess-threads-", ".tmp")
        try {
            Files.writeString(temp, json.encodeToString(updated))
            try {
                Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    private fun read(): Map<String, StoredThread> = if (Files.isRegularFile(path)) {
        json.decodeFromString(Files.readString(path))
    } else emptyMap()
}
