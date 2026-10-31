package com.heyanle.priestess.bot.config

import kotlinx.serialization.Serializable

@Serializable
data class CommandConfig(
    val prefix: String = "/",
)

@Serializable
data class PermissionConfig(
    val superAdminIds: List<String> = emptyList(),
    val adminIds: List<String> = emptyList(),
)
