package com.heyanle.priestess.bot.plugin

import java.io.Closeable
import java.net.URL
import java.net.URLClassLoader

/**
 * 插件运行时句柄，聚合插件实例、类加载器和上下文。
 */
internal data class PluginRuntime(
    val descriptor: PluginDescriptor,
    val classLoader: CloseablePluginClassLoader,
    val instance: Plugin,
    val context: DefaultPluginContext,
)

/**
 * 可关闭的插件类加载器，负责隔离并释放插件 jar 资源。
 */
class CloseablePluginClassLoader(
    urls: Array<URL>,
    parent: ClassLoader,
) : URLClassLoader(urls, parent), Closeable
