package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.model.ActivationPlan
import com.heyanle.priestess.bot.config.model.ConfigurationApplyMode
import com.heyanle.priestess.bot.config.model.ConfigurationChange
import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot

/** Conservative hot-activation policy. Unproven controller swaps require restart. */
class ConfigurationDiffClassifier {
    fun classify(active: EffectiveRuntimeSnapshot?, desired: DesiredConfig): ActivationPlan {
        if (active == null) return ActivationPlan(listOf(ConfigurationChange("*", ConfigurationApplyMode.LIVE, "initial activation")))
        val changes = mutableListOf<ConfigurationChange>()
        if (active.runtime.server != desired.runtime.server) changes.restart("runtime.server", "Dashboard listener changes require restart")
        if (active.runtime.database != desired.runtime.database) changes.restart("runtime.database", "Database changes require restart")
        if (active.runtime.plugins != desired.runtime.plugins) changes.restart("runtime.plugins", "Plugin loader changes require restart")
        if (active.platforms != desired.platforms) changes.restart("platforms", "Platform connection hot-swap is not yet proven safe")
        if (active.application?.platformDirectory != desired.application?.platformDirectory) changes.restart("platformDirectory", "Platform resource database relocation requires restart")
        if (active.application != desired.application) changes.live("application")
        if (active.runtime.reload != desired.runtime.reload) changes.live("runtime.reload")
        if (active.runtime.pipeline != desired.runtime.pipeline) changes.live("runtime.pipeline")
        if (active.runtime.command != desired.runtime.command) changes.live("runtime.command")
        if (active.runtime.permission != desired.runtime.permission) changes.live("runtime.permission")
        if (active.providers != desired.providers) changes.live("providers")
        if (!workspaceBehaviorEqual(active, desired)) changes.live("workspaces")
        return ActivationPlan(changes)
    }

    private fun workspaceBehaviorEqual(active: EffectiveRuntimeSnapshot, desired: DesiredConfig): Boolean {
        if (active.workspaces.keys != desired.workspaces.keys) return false
        return active.workspaces.all { (id, current) ->
            val next = desired.workspaces.getValue(id)
            current.fingerprint == next.fingerprint &&
                current.config == next.config &&
                current.agents == next.agents &&
                current.availableToolIds == next.availableToolIds
        }
    }

    private fun MutableList<ConfigurationChange>.restart(path: String, summary: String) {
        add(ConfigurationChange(path, ConfigurationApplyMode.RESTART_REQUIRED, summary))
    }

    private fun MutableList<ConfigurationChange>.live(path: String) {
        add(ConfigurationChange(path, ConfigurationApplyMode.LIVE))
    }
}
