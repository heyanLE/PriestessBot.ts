package com.heyanle.priestess.bot.config.source

import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings

/** Uses the YAML 1.2 parser's JSON-compatible mode to reject duplicate object keys before decoding. */
internal object StrictJsonPreflight {
    fun requireNoDuplicateKeys(text: String, source: String) {
        val settings = LoadSettings.builder()
            .setLabel(source)
            .setAllowDuplicateKeys(false)
            .build()
        Load(settings).loadFromString(text)
    }
}
