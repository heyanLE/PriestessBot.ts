package com.heyanle.priestess.bot.config.runtime

import com.heyanle.priestess.bot.config.CommandConfig
import com.heyanle.priestess.bot.config.DatabaseConfig
import com.heyanle.priestess.bot.config.PermissionConfig
import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.config.PlatformConfig
import com.heyanle.priestess.bot.config.PluginConfig
import com.heyanle.priestess.bot.config.ServerConfig
import com.heyanle.priestess.bot.config.model.EffectivePlatformConnection
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot
import com.heyanle.priestess.bot.config.model.PipelineRuntimeDocument
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flow

/** The only runtime configuration boundary. Every value comes from an activated v2 snapshot. */
class RuntimeConfigurationCase(
    private val effectiveStore: EffectiveConfigStore,
    private val ensureStarted: () -> Unit,
) {
    private val startupLock = Any()
    @Volatile private var startupChecked = false

    val updates: Flow<EffectiveRuntimeSnapshot> = flow {
        ensureConfigurationStarted()
        emitAll(effectiveStore.snapshots.filterNotNull())
    }

    fun current(): EffectiveRuntimeSnapshot {
        ensureConfigurationStarted()
        return effectiveStore.requireCurrent()
    }

    private fun ensureConfigurationStarted() {
        if (startupChecked) return
        synchronized(startupLock) {
            if (startupChecked) return
            ensureStarted()
            startupChecked = true
        }
    }
}

fun EffectiveRuntimeSnapshot.databaseConfig(): DatabaseConfig = DatabaseConfig(runtime.database.path)

fun EffectiveRuntimeSnapshot.pipelineConfig(): PipelineConfig = runtime.pipeline.toLegacy()

fun EffectiveRuntimeSnapshot.commandConfig(): CommandConfig = CommandConfig(runtime.command.prefix)

fun EffectiveRuntimeSnapshot.permissionConfig(): PermissionConfig = PermissionConfig(
    superAdminIds = runtime.permission.superAdminIds,
    adminIds = runtime.permission.adminIds,
)

fun EffectiveRuntimeSnapshot.pluginConfig(): PluginConfig = PluginConfig(
    enabled = runtime.plugins.enabled,
    directory = runtime.plugins.directory,
    autoDiscover = runtime.plugins.autoDiscover,
)

fun EffectiveRuntimeSnapshot.serverConfig(): ServerConfig = ServerConfig(
    enabled = runtime.server.enabled,
    host = runtime.server.host,
    port = runtime.server.port,
    corsEnabled = runtime.server.corsEnabled,
    configWatchEnabled = runtime.reload.enabled,
    configWatchIntervalMillis = runtime.reload.intervalMillis,
    apiToken = serverApiCredential?.reveal().orEmpty(),
)

fun PipelineRuntimeDocument.toLegacy(): PipelineConfig = PipelineConfig(
    wakingPrefix = wakingPrefix,
    whitelistEnabled = whitelistEnabled,
    whitelistUsers = whitelistUsers,
    whitelistGroups = whitelistGroups,
    rateLimitEnabled = rateLimitEnabled,
    rateLimitPerMinute = rateLimitPerMinute,
    maxHistoryMessages = maxHistoryMessages,
)

fun EffectivePlatformConnection.toLegacy(): PlatformConfig = PlatformConfig(
    name = id,
    type = type,
    enabled = enabled,
    host = settings["host"] ?: "127.0.0.1",
    port = settings["port"]?.toIntOrNull() ?: 3000,
    wsPort = settings["wsPort"]?.toIntOrNull() ?: 3001,
    token = credentials["token"]?.reveal().orEmpty(),
    baseUrl = settings["baseUrl"].orEmpty(),
    useWs = settings["useWs"]?.toBooleanStrictOrNull() ?: true,
    config = settings - setOf("host", "port", "wsPort", "baseUrl", "useWs"),
)
