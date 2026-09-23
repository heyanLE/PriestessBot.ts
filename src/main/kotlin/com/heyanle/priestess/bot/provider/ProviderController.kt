package com.heyanle.priestess.bot.provider

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.core.controller.BaseController
import kotlinx.coroutines.flow.collectLatest

/**
 * 模型提供者控制器，负责根据配置维护可用的运行时模型提供者。
 */
class ProviderController(
    private val runtimeConfig: RuntimeConfigurationCase,
) : BaseController("ProviderController") {

    private val configProviders = mutableMapOf<String, ChatProvider>()
    private val runtimeProviders = mutableMapOf<String, ChatProvider>()
    private val effectiveProviders = mutableMapOf<EffectiveProviderConnection, ChatProvider>()

    init {
        registerBuiltinProviders()
        refreshConfigProviders(runtimeConfig.current().providers.values)
        launchTask("provider-config-refresh") {
            runtimeConfig.updates.collectLatest { config ->
                val configs = config.providers.values
                refreshConfigProviders(configs)
            }
        }
    }

    @Synchronized
    fun register(provider: ChatProvider) {
        runtimeProviders[provider.metadata.name] = provider
    }

    @Synchronized
    fun unregister(name: String) {
        runtimeProviders.remove(name)
    }

    @Synchronized
    fun getByName(name: String): ChatProvider? = runtimeProviders[name] ?: configProviders[name]

    @Synchronized
    fun getAll(): List<ChatProvider> {
        return (configProviders + runtimeProviders).values.toList()
    }

    fun getMetaList(): List<ProviderMetadata> = getAll().map { it.metadata }

    /** Creates an exact v2 provider connection. No name, model, or first-provider fallback is applied. */
    @Synchronized
    fun getEffective(connection: EffectiveProviderConnection): ChatProvider? {
        if (!connection.enabled) return null
        return effectiveProviders.getOrPut(connection) {
            val config = ProviderConfig(
                name = connection.id,
                type = connection.type,
                model = "",
                baseUrl = connection.endpoint,
                apiKey = connection.credential?.reveal().orEmpty(),
                enabled = connection.enabled,
                config = connection.settings,
                credentialResolved = true,
            )
            ProviderRegistry.createByType(connection.type, config)
                ?: return null
        }
    }

    suspend fun testAll(): Map<String, Boolean> {
        return getAll().associate { provider ->
            provider.metadata.name to try {
                provider.test()
            } catch (e: Exception) {
                logger.warn(e) { "Provider '${provider.metadata.name}' test failed" }
                false
            }
        }
    }

    @Synchronized
    private fun refreshConfigProviders(configs: Collection<EffectiveProviderConnection>) {
        configProviders.clear()
        effectiveProviders.keys.retainAll(configs.toSet())
        for (connection in configs) {
            if (!connection.enabled) continue
            val config = ProviderConfig(
                name = connection.id,
                type = connection.type,
                model = "",
                baseUrl = connection.endpoint,
                apiKey = connection.credential?.reveal().orEmpty(),
                enabled = true,
                config = connection.settings,
                credentialResolved = true,
            )
            val provider = ProviderRegistry.createByType(connection.type, config) ?: continue
            configProviders[provider.metadata.name] = provider
        }
    }
}
