package com.heyanle.priestess.bot.plugin

import kotlinx.serialization.Serializable

/**
 * 插件清单，描述插件身份、入口点和声明能力。
 */
@Serializable
data class PluginManifest(
    val id: String,
    val name: String = id,
    val version: String = "0.0.0",
    val description: String = "",
    val entrypoint: String = "",
    val dependencies: List<String> = emptyList(),
    val capabilities: List<String> = emptyList(),
)

/**
 * 插件运行状态，用于展示发现、加载、启用和失败等生命周期阶段。
 */
@Serializable
enum class PluginState {
    DISCOVERED,
    LOADED,
    ENABLED,
    DISABLED,
    FAILED,
}

/**
 * 插件描述信息，记录清单、状态、路径和最近一次错误。
 */
@Serializable
data class PluginDescriptor(
    val manifest: PluginManifest,
    val state: PluginState,
    val path: String,
    val error: String? = null,
)

/**
 * 插件扩展元数据，标识插件贡献的扩展类型和名称。
 */
@Serializable
data class PluginExtensionMetadata(
    val pluginId: String,
    val type: String,
    val name: String,
)
