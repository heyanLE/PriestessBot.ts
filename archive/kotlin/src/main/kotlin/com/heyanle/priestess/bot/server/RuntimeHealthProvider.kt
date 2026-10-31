package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.source.ProcessConfigurationPath
import com.heyanle.priestess.bot.plugin.PluginCase
import com.heyanle.priestess.bot.platform.PlatformCase
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.tool.ToolCase

/**
 * 运行时健康快照提供者，汇总配置、平台、模型、工具和插件的当前状态。
 */
class RuntimeHealthProvider(
    private val platformCase: PlatformCase,
    private val providerCase: ProviderCase,
    private val toolCase: ToolCase,
    private val pluginCase: PluginCase,
    private val startedAtMillis: Long = System.currentTimeMillis(),
    private val availableProvidersProvider: (() -> Int)? = null,
    private val configurationRuntime: ConfigurationRuntimeService,
    private val runtimeConfig: RuntimeConfigurationCase,
) {
    fun snapshot(): HealthResponse {
        val components = linkedMapOf(
            "config" to "UP",
            "database" to "UP",
            "server" to "UP",
            "providers" to "UP",
            "platforms" to "UP",
            "plugins" to "UP",
            "tools" to "UP",
            "workspaceReload" to "UP",
        )
        val diagnostics = linkedMapOf<String, String>()

        inspect(components, "config") {
            val config = runtimeConfig.current()
            diagnostics["configPath"] = configurationRuntime.sourcePath().toString()
            diagnostics["databasePath"] = config.runtime.database.path
            diagnostics["configuredPlatforms"] = config.platforms.size.toString()
            diagnostics["configuredProviders"] = config.providers.size.toString()
            diagnostics["workspaceReloadEnabled"] = config.runtime.reload.enabled.toString()
            diagnostics["workspaceReloadIntervalMillis"] = config.runtime.reload.intervalMillis.toString()
            val selection = ProcessConfigurationPath.current()
            diagnostics["configPathSelector"] = selection.selector
            diagnostics["configPathSource"] = selection.sourceKind.name
            configurationRuntime.currentSnapshot()?.let { effective ->
                diagnostics["configMode"] = if (effective.application == null) "v2" else "v3"
                effective.application?.let { app ->
                    diagnostics["configuredAgents"] = app.agents.count { it.enabled }.toString()
                    diagnostics["configuredIms"] = app.ims.count { it.enabled }.toString()
                    diagnostics["configuredLlms"] = app.llms.count { it.enabled }.toString()
                    diagnostics["platformDirectory"] = com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
                        .resolveDirectory(configurationRuntime.sourcePath(), app.platformDirectory).toString()
                }
                diagnostics["rawRevision"] = effective.desiredRevision.value
                diagnostics["activeSnapshotVersion"] = effective.version.value.toString()
                diagnostics["sourceFingerprint"] = effective.sourceFingerprint.value
                diagnostics["workspaceSnapshotVersions"] = effective.workspaces.entries
                    .sortedBy { it.key }
                    .joinToString(",") { (id, workspace) -> "$id:${workspace.version.value}" }
                diagnostics["configurationDiagnostics"] = effective.diagnostics
                    .groupingBy { it.severity.name }
                    .eachCount()
                    .entries
                    .sortedBy { it.key }
                    .joinToString(",") { "${it.key}:${it.value}" }
                diagnostics["pendingRestartCount"] = effective.pendingRestart.size.toString()
            } ?: run {
                diagnostics["configMode"] = "legacy"
            }
        }

        inspect(components, "platforms") {
            diagnostics["runningPlatforms"] = platformCase.runningPlatformCount().toString()
        }

        inspect(components, "providers") {
            val availableProviders = availableProvidersProvider?.invoke() ?: providerCase.getMetaList().size
            diagnostics["availableProviders"] = availableProviders.toString()
        }

        inspect(components, "tools") {
            diagnostics["registeredTools"] = toolCase.getAll().size.toString()
        }

        inspect(components, "plugins") {
            diagnostics["configuredPlugins"] = pluginCase.list().size.toString()
            diagnostics["loadedPluginExtensions"] = pluginCase.extensions().size.toString()
        }

        return HealthResponse(
            status = if (components.values.any { it == "DEGRADED" }) "DEGRADED" else "UP",
            components = components,
            uptimeMillis = (System.currentTimeMillis() - startedAtMillis).coerceAtLeast(0),
            diagnostics = diagnostics,
        )
    }

    private fun inspect(
        components: MutableMap<String, String>,
        component: String,
        block: () -> Unit,
    ) {
        try {
            block()
        } catch (e: Exception) {
            components[component] = "DEGRADED"
            components["${component}Error"] = e::class.simpleName ?: "Exception"
        }
    }
}
