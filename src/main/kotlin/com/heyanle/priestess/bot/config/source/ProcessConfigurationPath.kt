package com.heyanle.priestess.bot.config.source

/** Process-entry holder ensuring every launcher and runtime module uses one normalized selection. */
object ProcessConfigurationPath {
    @Volatile
    private var configured: ResolvedConfigPath? = null

    fun configure(arguments: List<String>): ResolvedConfigPath {
        val result = ConfigPathSelector().resolve(arguments)
        val selection = result.value ?: error(
            result.diagnostics.joinToString(prefix = "Invalid configuration path: ") { "${it.code}: ${it.message}" },
        )
        configured = selection
        return selection
    }

    fun current(): ResolvedConfigPath {
        configured?.let { return it }
        return ConfigPathSelector().resolve().value ?: error("Unable to resolve the configuration path")
    }
}
