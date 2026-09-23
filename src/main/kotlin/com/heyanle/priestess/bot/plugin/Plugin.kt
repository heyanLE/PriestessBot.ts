package com.heyanle.priestess.bot.plugin

import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.config.PlatformConfig
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.PlatformRegistry
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase

/**
 * 插件生命周期接口，插件实现通过这些回调接入系统运行流程。
 */
interface Plugin {
    fun onLoad(context: PluginContext) = Unit
    fun onEnable(context: PluginContext) = Unit
    fun onDisable(context: PluginContext) = Unit
    fun onUnload(context: PluginContext) = Unit
}

/**
 * 插件运行上下文，向插件暴露扩展、工具、提供者和平台注册能力。
 */
interface PluginContext {
    val manifest: PluginManifest
    val pluginPath: String

    fun registerExtension(type: String, name: String)
    fun extensions(type: String? = null): List<PluginExtensionMetadata>
    fun registerTool(tool: FunctionTool)
    fun registeredTools(): List<String>
    fun registerProvider(provider: ChatProvider)
    fun registeredProviders(): List<String>
    fun registerPlatform(metadata: PlatformMetadata, factory: (PlatformConfig?) -> Platform)
    fun registerPlatform(
        metadata: PlatformMetadata,
        toolFactory: () -> List<FunctionTool>,
        factory: (PlatformConfig?) -> Platform,
    )
    fun registeredPlatforms(): List<String>
}

/**
 * 默认插件上下文，记录单个插件的运行时贡献并负责在卸载时清理。
 */
class DefaultPluginContext(
    override val manifest: PluginManifest,
    override val pluginPath: String,
    private val extensionRegistry: PluginExtensionRegistry,
    private val toolCase: ToolCase,
    private val providerCase: ProviderCase,
) : PluginContext {
    private val toolNames = linkedSetOf<String>()
    private val providerNames = linkedSetOf<String>()
    private val platformNames = linkedSetOf<String>()

    override fun registerExtension(type: String, name: String) {
        extensionRegistry.register(
            PluginExtensionMetadata(
                pluginId = manifest.id,
                type = type,
                name = name,
            ),
        )
    }

    override fun extensions(type: String?): List<PluginExtensionMetadata> {
        return extensionRegistry.list(type).filter { it.pluginId == manifest.id }
    }

    override fun registerTool(tool: FunctionTool) {
        val name = tool.schema.name
        toolCase.registerPluginTool(manifest.id, tool)
        toolNames.add(name)
        registerExtension("tool", name)
    }

    override fun registeredTools(): List<String> = toolNames.toList()

    override fun registerProvider(provider: ChatProvider) {
        val name = provider.metadata.name
        providerCase.registerPluginProvider(provider)
        providerNames.add(name)
        registerExtension("provider", name)
    }

    override fun registeredProviders(): List<String> = providerNames.toList()

    override fun registerPlatform(metadata: PlatformMetadata, factory: (PlatformConfig?) -> Platform) {
        registerPlatform(metadata, { emptyList() }, factory)
    }

    override fun registerPlatform(
        metadata: PlatformMetadata,
        toolFactory: () -> List<FunctionTool>,
        factory: (PlatformConfig?) -> Platform,
    ) {
        PlatformRegistry.unregister(metadata.name)
        PlatformRegistry.registerMeta(metadata, toolFactory, factory)
        platformNames.add(metadata.name)
        registerExtension("platform", metadata.name)
    }

    override fun registeredPlatforms(): List<String> = platformNames.toList()

    fun clearRuntimeContributions() {
        toolNames.forEach { toolCase.unregisterPluginTool(it) }
        toolNames.clear()
        providerNames.forEach { providerCase.unregisterPluginProvider(it) }
        providerNames.clear()
        platformNames.forEach { PlatformRegistry.unregister(it) }
        platformNames.clear()
        extensionRegistry.unregisterPlugin(manifest.id)
    }
}
