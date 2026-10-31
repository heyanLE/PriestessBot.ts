package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.ActivationPlan
import com.heyanle.priestess.bot.config.model.ConfigurationApplyMode
import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot
import com.heyanle.priestess.bot.config.model.PendingRestart
import com.heyanle.priestess.bot.config.model.RawConfigRevision

data class ConfigActivationResult(
    val success: Boolean,
    val desiredRevision: RawConfigRevision,
    val activeVersion: Long?,
    val plan: ActivationPlan,
    val pendingRestart: List<PendingRestart>,
)

data class ConfigRuntimeState(
    val desiredRevision: RawConfigRevision? = null,
    val activeVersion: Long? = null,
    val pendingRestart: List<PendingRestart> = emptyList(),
    val lastActivation: ConfigActivationResult? = null,
)

class ConfigActivationCoordinator(
    private val store: EffectiveConfigStore,
    private val classifier: ConfigurationDiffClassifier = ConfigurationDiffClassifier(),
) {
    private val lock = Any()
    private var state = ConfigRuntimeState()

    fun state(): ConfigRuntimeState = synchronized(lock) { state }

    fun activate(desired: DesiredConfig): ConfigActivationResult = synchronized(lock) {
        val current = store.current()
        val plan = classifier.classify(current, desired)
        val restartChanges = plan.changes.filter { it.mode == ConfigurationApplyMode.RESTART_REQUIRED }
        val pending = restartChanges.map { PendingRestart(it.path, it.summary.ifBlank { "Process restart required" }) }
        if (current != null && pending.any { it.path == "platformDirectory" }) {
            val liveHandles = current.workspaces.values.flatMap { it.resourceHandles }
            desired.workspaces.values.flatMap { it.resourceHandles }.distinct()
                .filter { candidate -> liveHandles.none { it === candidate } }
                .forEach { runCatching { it.close() } }
            val active = store.pendingRestart(pending)
            val result = ConfigActivationResult(true, desired.rawRevision, active.version.value, plan, pending)
            state = ConfigRuntimeState(desired.rawRevision, active.version.value, pending, result)
            return@synchronized result
        }
        val activeDesired = if (current == null || restartChanges.isEmpty()) desired else {
            retainRestartBoundValues(desired, current, restartChanges.map { it.path }.toSet())
        }
        val snapshot = store.publish(activeDesired, pending)
        val result = ConfigActivationResult(
            success = true,
            desiredRevision = desired.rawRevision,
            activeVersion = snapshot.version.value,
            plan = plan,
            pendingRestart = pending,
        )
        state = ConfigRuntimeState(desired.rawRevision, snapshot.version.value, pending, result)
        result
    }

    private fun retainRestartBoundValues(
        desired: DesiredConfig,
        active: EffectiveRuntimeSnapshot,
        restartPaths: Set<String>,
    ): DesiredConfig {
        return desired.copy(
            runtime = desired.runtime.copy(
                server = if ("runtime.server" in restartPaths) active.runtime.server else desired.runtime.server,
                database = if ("runtime.database" in restartPaths) active.runtime.database else desired.runtime.database,
                plugins = if ("runtime.plugins" in restartPaths) active.runtime.plugins else desired.runtime.plugins,
            ),
            platforms = if ("platforms" in restartPaths) active.platforms else desired.platforms,
        )
    }
}
