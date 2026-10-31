package com.heyanle.priestess.bot.plugin

/**
 * 插件扩展注册表，记录插件贡献的工具、提供者和平台等扩展元数据。
 */
class PluginExtensionRegistry {
    private val extensions = mutableListOf<PluginExtensionMetadata>()

    fun register(metadata: PluginExtensionMetadata) {
        extensions.removeAll { it.pluginId == metadata.pluginId && it.type == metadata.type && it.name == metadata.name }
        extensions.add(metadata)
    }

    fun unregisterPlugin(pluginId: String) {
        extensions.removeAll { it.pluginId == pluginId }
    }

    fun list(type: String? = null): List<PluginExtensionMetadata> {
        return extensions
            .filter { type == null || it.type == type }
            .sortedWith(compareBy<PluginExtensionMetadata> { it.type }.thenBy { it.name })
    }
}
