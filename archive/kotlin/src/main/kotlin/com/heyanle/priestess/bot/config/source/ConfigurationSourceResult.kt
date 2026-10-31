package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity

data class ConfigurationSourceResult<T>(
    val value: T? = null,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
) {
    val isSuccess: Boolean
        get() = value != null && diagnostics.none { it.severity == DiagnosticSeverity.ERROR }
}
