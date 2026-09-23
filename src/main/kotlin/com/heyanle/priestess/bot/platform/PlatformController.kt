package com.heyanle.priestess.bot.platform

import com.heyanle.priestess.bot.config.PlatformConfig
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.runtime.toLegacy
import com.heyanle.priestess.bot.core.controller.BaseController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * 平台控制器，负责维护平台适配器实例、监听平台配置变化并承接平台模块生命周期。
 */
class PlatformController(
    private val runtimeConfig: RuntimeConfigurationCase,
    private val platformCase: PlatformCase,
) : BaseController("PlatformController") {

    private val lock = Any()
    private val platforms = LinkedHashMap<String, Platform>()
    private val jobs = LinkedHashMap<String, Job>()
    private val activeConfigs = LinkedHashMap<String, PlatformConfig>()
    private val configListenerJob: Job
    private val syncMutex = Mutex()

    init {
        registerBuiltinPlatforms()
        configListenerJob = launchTask("platform-config-listener") {
            runtimeConfig.updates.collect { config ->
                sync(config.platforms.values.map { it.toLegacy() })
            }
        }
    }

    fun get(name: String): Platform? = synchronized(lock) { platforms[name] }

    fun getAll(): List<Platform> = synchronized(lock) { platforms.values.toList() }

    fun getRunning(): List<Platform> = synchronized(lock) {
        platforms.mapNotNull { (key, platform) -> platform.takeIf { jobs[key]?.isActive == true } }
    }

    private suspend fun sync(configs: List<PlatformConfig>) = syncMutex.withLock {
        val enabledConfigs = configs.filter { it.enabled }
            .associateBy { it.name.ifBlank { it.type } }

        val existingKeys = synchronized(lock) { platforms.keys.toList() }
        for (key in existingKeys) {
            val desired = enabledConfigs[key]
            val unchangedAndRunning = synchronized(lock) {
                desired != null && activeConfigs[key] == desired && jobs[key]?.isActive == true
            }
            if (!unchangedAndRunning) stopPlatform(key)
        }

        for ((configuredName, cfg) in enabledConfigs) {
            val alreadyRunning = synchronized(lock) {
                platforms.containsKey(configuredName) && jobs[configuredName]?.isActive == true
            }
            if (alreadyRunning) continue

            startPlatform(configuredName, cfg)
        }
    }

    suspend fun restart(name: String): Boolean = syncMutex.withLock {
        val connection = runtimeConfig.current().platforms[name] ?: return@withLock false
        stopPlatform(name)
        startPlatform(name, connection.toLegacy())
    }

    private suspend fun startPlatform(configuredName: String, cfg: PlatformConfig): Boolean {
        return try {
            val platform = PlatformRegistry.createFromConfig(cfg) ?: return false
            platform.setMessageHandler { event -> platformCase.handleIncomingMessage(event) }
            val job = platform.run()
            synchronized(lock) {
                platforms[configuredName] = platform
                jobs[configuredName] = job
                activeConfigs[configuredName] = cfg
            }
            logger.info { "Platform '$configuredName' started as '${platform.metadata.name}'" }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: PlatformSetupRequiredException) {
            logger.warn { "Platform '$configuredName' is waiting for setup: ${e.message}" }
            false
        } catch (e: Exception) {
            logger.error(e) { "Failed to start platform '$configuredName'" }
            false
        }
    }

    private suspend fun stopPlatform(name: String) = withContext(NonCancellable) {
        val platform: Platform?
        val job: Job?
        synchronized(lock) {
            platform = platforms.remove(name)
            job = jobs.remove(name)
            activeConfigs.remove(name)
        }

        try {
            platform?.terminate()
        } catch (e: Exception) {
            logger.error(e) { "Failed to terminate platform '$name'" }
        }
        try {
            job?.cancelAndJoin()
        } catch (e: Exception) {
            logger.error(e) { "Failed to stop platform job '$name'" }
        }
    }

    override suspend fun stop() {
        configListenerJob.cancelAndJoin()
        val names = synchronized(lock) { platforms.keys.toList() }
        for (name in names) {
            stopPlatform(name)
        }
        super.stop()
    }
}
