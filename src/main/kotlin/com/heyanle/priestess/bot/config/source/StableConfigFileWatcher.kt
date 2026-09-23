package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.RawConfigRevision
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

data class StableFileRevision(
    val path: Path,
    val revision: RawConfigRevision,
)

/**
 * Debounces file-system changes by content revision. A candidate is emitted only
 * after the same revision remains visible for the complete stability window.
 */
class StableConfigFileWatcher(
    private val path: Path,
    private val stabilityWindowMillis: Long,
    private val revisionProvider: (Path) -> RawConfigRevision? = RevisionedConfigFileStore()::revision,
) {
    private var activeRevision: RawConfigRevision? = revisionProvider(path)
    private var candidateRevision: RawConfigRevision? = null
    private var candidateSinceMillis: Long? = null

    fun poll(nowMillis: Long): StableFileRevision? {
        val observed = path.takeIf(Files::isRegularFile)?.let(revisionProvider)
        if (observed == activeRevision) {
            candidateRevision = null
            candidateSinceMillis = null
            return null
        }
        if (observed == null) {
            candidateRevision = null
            candidateSinceMillis = null
            return null
        }
        if (observed != candidateRevision) {
            candidateRevision = observed
            candidateSinceMillis = nowMillis
            return null
        }
        val stableSince = candidateSinceMillis ?: nowMillis.also { candidateSinceMillis = it }
        if (nowMillis - stableSince < stabilityWindowMillis.coerceAtLeast(0)) return null

        activeRevision = observed
        candidateRevision = null
        candidateSinceMillis = null
        return StableFileRevision(path.toAbsolutePath().normalize(), observed)
    }

    suspend fun watch(
        pollIntervalMillis: Long,
        nowProvider: () -> Long = System::currentTimeMillis,
        compileStableRevision: suspend (StableFileRevision) -> Unit,
    ) {
        while (currentCoroutineContext().isActive) {
            delay(pollIntervalMillis.coerceAtLeast(50))
            poll(nowProvider())?.let { compileStableRevision(it) }
        }
    }
}
