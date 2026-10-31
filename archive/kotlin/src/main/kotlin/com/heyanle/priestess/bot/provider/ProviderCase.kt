package com.heyanle.priestess.bot.provider

import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection

/**
 * 模型提供者模块门面，集中向其他模块暴露提供者查询、健康检查和插件贡献入口。
 */
class ProviderCase(
    private val controller: ProviderController,
) {
    fun getByName(name: String): ChatProvider? = controller.getByName(name)
    fun getAll(): List<ChatProvider> = controller.getAll()
    fun getEffective(connection: EffectiveProviderConnection): ChatProvider? = controller.getEffective(connection)
    fun getMetaList(): List<ProviderMetadata> = controller.getMetaList()
    suspend fun testAll(): Map<String, Boolean> = controller.testAll()

    fun registerPluginProvider(provider: ChatProvider) {
        val name = provider.metadata.name
        controller.unregister(name)
        controller.register(provider)
    }

    fun unregisterPluginProvider(name: String) {
        controller.unregister(name)
    }

    suspend fun stop() {
        controller.stop()
    }
}
