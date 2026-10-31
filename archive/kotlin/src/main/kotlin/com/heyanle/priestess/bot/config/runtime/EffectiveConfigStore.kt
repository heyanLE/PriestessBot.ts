package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.EffectiveConfigVersion
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot
import com.heyanle.priestess.bot.config.model.PendingRestart
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Thread-safe atomic store for immutable effective configuration generations. */
class EffectiveConfigStore(
    private val nowProvider: () -> Long = System::currentTimeMillis,
) : AutoCloseable {
    private val lock = Any()
    private val versions = AtomicLong(0)
    private var active: EffectiveRuntimeSnapshot? = null
    private val references = linkedMapOf<Long, Int>()
    private val retired = linkedMapOf<Long, EffectiveRuntimeSnapshot>()
    private val closed = linkedSetOf<Long>()
    private val _snapshots = MutableStateFlow<EffectiveRuntimeSnapshot?>(null)

    /** Observable atomic generations for long-lived runtime consumers. */
    val snapshots: StateFlow<EffectiveRuntimeSnapshot?> = _snapshots.asStateFlow()

    fun current(): EffectiveRuntimeSnapshot? = synchronized(lock) { active }

    fun requireCurrent(): EffectiveRuntimeSnapshot = current() ?: error("No effective configuration snapshot is active")

    /** Queue a resource-store relocation without publishing mixed old/new resource dependencies. */
    fun pendingRestart(pending: List<PendingRestart>): EffectiveRuntimeSnapshot {
        val updated = synchronized(lock) {
            checkNotNull(active).copy(pendingRestart = pending.toList()).also { active = it }
        }
        _snapshots.value = updated
        return updated
    }

    fun publish(desired: DesiredConfig, pendingRestart: List<PendingRestart> = emptyList()): EffectiveRuntimeSnapshot {
        val version = versions.incrementAndGet()
        val workspaces = desired.workspaces.mapValues { (_, workspace) ->
            workspace.copy(version = EffectiveConfigVersion(version))
        }
        val candidate = EffectiveRuntimeSnapshot(
            version = EffectiveConfigVersion(version),
            desiredRevision = desired.rawRevision,
            sourceFingerprint = desired.sourceFingerprint,
            loadedAtEpochMillis = nowProvider(),
            runtime = desired.runtime,
            serverApiCredential = desired.serverApiCredential,
            platforms = desired.platforms.toMap(),
            providers = desired.providers.toMap(),
            workspaceCatalog = desired.document.workspaces,
            workspaces = workspaces.toMap(),
            provenance = desired.provenance.toMap(),
            diagnostics = desired.diagnostics.toList(),
            pendingRestart = pendingRestart.toList(),
            application = desired.application,
        )
        synchronized(lock) {
            val previous = active
            active = candidate
            if (previous != null) {
                retired[previous.version.value] = previous
                closeIfUnusedLocked(previous.version.value)
            }
        }
        _snapshots.value = candidate
        return candidate
    }

    fun acquire(): EffectiveConfigLease = synchronized(lock) {
        val snapshot = active ?: error("No effective configuration snapshot is active")
        val version = snapshot.version.value
        references[version] = (references[version] ?: 0) + 1
        EffectiveConfigLease(this, snapshot)
    }

    internal fun release(snapshot: EffectiveRuntimeSnapshot) {
        synchronized(lock) {
            val version = snapshot.version.value
            val count = references[version] ?: return
            if (count <= 1) references.remove(version) else references[version] = count - 1
            closeIfUnusedLocked(version)
        }
    }

    override fun close() {
        val snapshots = synchronized(lock) {
            buildList {
                active?.let(::add)
                addAll(retired.values)
            }.distinctBy { it.version.value }.also {
                active = null
                retired.clear()
                references.clear()
            }
        }
        snapshots.forEach(::closeResourcesOnce)
        _snapshots.value = null
    }

    private fun closeIfUnusedLocked(version: Long) {
        if ((references[version] ?: 0) > 0) return
        retired.remove(version)?.let(::closeResourcesOnce)
    }

    private fun closeResourcesOnce(snapshot: EffectiveRuntimeSnapshot) {
        val shouldClose = synchronized(lock) { closed.add(snapshot.version.value) }
        if (!shouldClose) return
        snapshot.workspaces.values
            .flatMap { it.resourceHandles }
            .distinct()
            .forEach { handle -> runCatching { handle.close() } }
    }
}

class EffectiveConfigLease internal constructor(
    private val store: EffectiveConfigStore,
    val snapshot: EffectiveRuntimeSnapshot,
) : AutoCloseable {
    private val closed = AtomicBoolean(false)

    override fun close() {
        if (closed.compareAndSet(false, true)) store.release(snapshot)
    }
}
