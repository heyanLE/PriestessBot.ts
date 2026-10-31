package com.heyanle.priestess.bot.plugin

import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.runtime.pluginConfig
import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.tool.ToolCase
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.net.URL

/**
 * 插件模块控制器，负责插件发现、加载生命周期和运行时上下文管理。
 */
class PluginController(
    private val runtimeConfig: RuntimeConfigurationCase,
    private val extensionRegistry: PluginExtensionRegistry,
    private val toolCase: ToolCase,
    private val providerCase: ProviderCase,
) : BaseController("PluginController") {

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }
    private val plugins = linkedMapOf<String, PluginDescriptor>()
    private val runtimes = linkedMapOf<String, PluginRuntime>()

    init {
        val cfg = runtimeConfig.current().pluginConfig()
        if (cfg.enabled && cfg.autoDiscover) {
            discover()
        }
    }

    fun discover(): List<PluginDescriptor> {
        val dir = File(runtimeConfig.current().pluginConfig().directory)
        if (!dir.exists()) {
            dir.mkdirs()
        }

        dir.listFiles()
            ?.forEach { candidate ->
                when {
                    candidate.isDirectory -> discoverDirectory(candidate)
                    candidate.isFile && candidate.extension.equals("jar", ignoreCase = true) -> discoverJar(candidate)
                }
            }

        return list()
    }

    fun list(): List<PluginDescriptor> = synchronized(plugins) {
        plugins.values.sortedBy { it.manifest.id }.toList()
    }

    fun get(id: String): PluginDescriptor? = synchronized(plugins) { plugins[id] }

    fun load(id: String): PluginDescriptor {
        val descriptor = synchronized(plugins) { plugins[id] } ?: error("Plugin '$id' not found")
        if (descriptor.state == PluginState.LOADED || descriptor.state == PluginState.ENABLED) return descriptor
        if (runtimes.containsKey(id)) return descriptor.copy(state = PluginState.LOADED, error = null).also {
            synchronized(plugins) { plugins[id] = it }
        }
        return runLifecycle(id) {
            val manifest = descriptor.manifest
            require(manifest.entrypoint.isNotBlank()) { "Plugin '${manifest.id}' has no entrypoint" }
            val urls = resolveArtifactUrls(File(descriptor.path))
            require(urls.isNotEmpty()) { "Plugin '${manifest.id}' has no jar artifacts" }
            val classLoader = CloseablePluginClassLoader(
                urls = urls.toTypedArray(),
                parent = Plugin::class.java.classLoader,
            )
            val context = DefaultPluginContext(
                manifest = manifest,
                pluginPath = descriptor.path,
                extensionRegistry = extensionRegistry,
                toolCase = toolCase,
                providerCase = providerCase,
            )
            val instance = instantiatePlugin(classLoader, manifest.entrypoint)
            val runtime = PluginRuntime(descriptor, classLoader, instance, context)
            runtimes[id] = runtime
            instance.onLoad(context)
            descriptor.copy(state = PluginState.LOADED, error = null)
        }
    }

    fun enable(id: String): PluginDescriptor {
        val loaded = load(id)
        if (loaded.state == PluginState.FAILED) return loaded
        return runLifecycle(id) {
            val runtime = runtimes[id] ?: error("Plugin '$id' is not loaded")
            runtime.instance.onEnable(runtime.context)
            runtime.descriptor.copy(state = PluginState.ENABLED, error = null)
        }
    }

    fun disable(id: String): PluginDescriptor {
        return runLifecycle(id) {
            val runtime = runtimes[id]
            if (runtime != null) {
                runtime.instance.onDisable(runtime.context)
                runtime.context.clearRuntimeContributions()
            } else {
                clearRuntimeContributions(id)
            }
            val current = plugins[id] ?: error("Plugin '$id' not found")
            current.copy(state = PluginState.DISABLED, error = null)
        }
    }

    fun unload(id: String): PluginDescriptor {
        return runLifecycle(id) {
            val runtime = runtimes.remove(id)
            if (runtime != null) {
                try {
                    runtime.instance.onUnload(runtime.context)
                } finally {
                    runtime.context.clearRuntimeContributions()
                    runtime.classLoader.close()
                }
            } else {
                clearRuntimeContributions(id)
            }
            val current = plugins[id] ?: error("Plugin '$id' not found")
            current.copy(state = PluginState.DISCOVERED, error = null)
        }
    }

    fun reload(): List<PluginDescriptor> {
        val ids = synchronized(plugins) { plugins.keys.toList() }
        ids.forEach { id ->
            runCatching { unload(id) }
        }
        synchronized(plugins) {
            plugins.clear()
        }
        return discover()
    }

    private fun discoverDirectory(pluginDir: File) {
        val manifestFile = pluginDir.resolve("plugin.json")
        if (!manifestFile.exists()) return
        discoverManifest(manifestFile, pluginDir)
    }

    private fun discoverJar(pluginJar: File) {
        val manifestFile = pluginJar.parentFile.resolve("${pluginJar.nameWithoutExtension}.json")
        if (!manifestFile.exists()) return
        discoverManifest(manifestFile, pluginJar)
    }

    private fun discoverManifest(manifestFile: File, pluginPath: File) {
        val descriptor = try {
            val manifest = json.decodeFromString<PluginManifest>(manifestFile.readText())
            PluginDescriptor(
                manifest = manifest,
                state = PluginState.DISCOVERED,
                path = pluginPath.absolutePath,
            )
        } catch (e: SerializationException) {
            PluginDescriptor(
                manifest = PluginManifest(id = pluginPath.nameWithoutExtension, name = pluginPath.nameWithoutExtension),
                state = PluginState.FAILED,
                path = pluginPath.absolutePath,
                error = e.message,
            )
        } catch (e: Exception) {
            PluginDescriptor(
                manifest = PluginManifest(id = pluginPath.nameWithoutExtension, name = pluginPath.nameWithoutExtension),
                state = PluginState.FAILED,
                path = pluginPath.absolutePath,
                error = e.message,
            )
        }

        synchronized(plugins) {
            plugins[descriptor.manifest.id] = descriptor
        }
    }

    private fun instantiatePlugin(classLoader: ClassLoader, entrypoint: String): Plugin {
        val clazz = Class.forName(entrypoint, true, classLoader)
        val instance = clazz.getDeclaredConstructor().newInstance()
        return instance as? Plugin
            ?: error("Entrypoint '$entrypoint' does not implement ${Plugin::class.qualifiedName}")
    }

    private fun resolveArtifactUrls(path: File): List<URL> {
        return when {
            path.isFile && path.extension.equals("jar", ignoreCase = true) -> listOf(path.toURI().toURL())
            path.isDirectory -> {
                val rootJars = path.listFiles()
                    ?.filter { it.isFile && it.extension.equals("jar", ignoreCase = true) }
                    .orEmpty()
                val libJars = path.resolve("lib").listFiles()
                    ?.filter { it.isFile && it.extension.equals("jar", ignoreCase = true) }
                    .orEmpty()
                (rootJars + libJars).map { it.toURI().toURL() }
            }
            else -> emptyList()
        }
    }

    private fun runLifecycle(id: String, block: () -> PluginDescriptor): PluginDescriptor {
        return try {
            val next = block()
            synchronized(plugins) {
                plugins[id] = next
            }
            next
        } catch (e: Exception) {
            runtimes.remove(id)?.let { runtime ->
                runCatching { runtime.context.clearRuntimeContributions() }
                runCatching { runtime.classLoader.close() }
            } ?: clearRuntimeContributions(id)
            synchronized(plugins) {
                val current = plugins[id] ?: PluginDescriptor(
                    manifest = PluginManifest(id = id, name = id),
                    state = PluginState.FAILED,
                    path = "",
                )
                val failed = current.copy(state = PluginState.FAILED, error = e.message ?: e::class.simpleName)
                plugins[id] = failed
                failed
            }
        }
    }

    private fun clearRuntimeContributions(id: String) {
        extensionRegistry.unregisterPlugin(id)
    }
}
