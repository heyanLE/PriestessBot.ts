package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

/**
 * 数据库配置，描述本地持久化文件的位置。
 */
@Serializable
data class DatabaseConfig(
    val path: String = "data/priestess.db",
)
