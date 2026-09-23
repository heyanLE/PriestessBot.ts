package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.CredentialReference
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.GuardedSecret

data class EnvironmentOverrides(
    val serverEnabled: Boolean? = null,
    val serverHost: String? = null,
    val serverPort: Int? = null,
    val serverCorsEnabled: Boolean? = null,
    val reloadEnabled: Boolean? = null,
    val reloadIntervalMillis: Long? = null,
    val databasePath: String? = null,
    val pluginsEnabled: Boolean? = null,
    val pluginsDirectory: String? = null,
    val pluginsAutoDiscover: Boolean? = null,
)

data class EnvironmentOverrideResult(
    val overrides: EnvironmentOverrides,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

data class CredentialResolution(
    val credential: GuardedSecret? = null,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

/** Reads only explicitly supported deployment overrides. */
class EnvironmentOverrideSource(
    private val environment: (String) -> String? = System::getenv,
) {
    fun read(): EnvironmentOverrideResult {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        return EnvironmentOverrideResult(
            overrides = EnvironmentOverrides(
                serverEnabled = boolean("PRIESTESS_SERVER_ENABLED", diagnostics),
                serverHost = string("PRIESTESS_SERVER_HOST"),
                serverPort = integer("PRIESTESS_SERVER_PORT", diagnostics) { it in 1..65_535 },
                serverCorsEnabled = boolean("PRIESTESS_SERVER_CORS_ENABLED", diagnostics),
                reloadEnabled = boolean("PRIESTESS_CONFIG_WATCH_ENABLED", diagnostics),
                reloadIntervalMillis = long("PRIESTESS_CONFIG_WATCH_INTERVAL_MILLIS", diagnostics) { it >= 250L },
                databasePath = string("PRIESTESS_DATABASE_PATH"),
                pluginsEnabled = boolean("PRIESTESS_PLUGINS_ENABLED", diagnostics),
                pluginsDirectory = string("PRIESTESS_PLUGINS_DIRECTORY"),
                pluginsAutoDiscover = boolean("PRIESTESS_PLUGINS_AUTO_DISCOVER", diagnostics),
            ),
            diagnostics = diagnostics,
        )
    }

    fun resolveCredential(reference: CredentialReference, path: String): CredentialResolution {
        val value = environment(reference.key)?.takeIf { it.isNotBlank() }
        if (value == null) {
            return CredentialResolution(
                diagnostics = listOf(
                    ConfigurationDiagnostic(
                        code = "CONFIG_CREDENTIAL_MISSING",
                        severity = DiagnosticSeverity.ERROR,
                        message = "Credential environment variable '${reference.key}' is missing or blank",
                        source = "environment:${reference.key}",
                        path = path,
                    ),
                ),
            )
        }
        return CredentialResolution(credential = GuardedSecret.of(value))
    }

    private fun string(name: String): String? = environment(name)?.takeIf { it.isNotBlank() }

    private fun boolean(name: String, diagnostics: MutableList<ConfigurationDiagnostic>): Boolean? {
        val value = environment(name)?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        return when (value) {
            "true", "1", "yes", "y" -> true
            "false", "0", "no", "n" -> false
            else -> invalid(name, value, diagnostics).let { null }
        }
    }

    private fun integer(
        name: String,
        diagnostics: MutableList<ConfigurationDiagnostic>,
        valid: (Int) -> Boolean,
    ): Int? {
        val raw = environment(name)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val value = raw.toIntOrNull()
        if (value == null || !valid(value)) return invalid(name, raw, diagnostics).let { null }
        return value
    }

    private fun long(
        name: String,
        diagnostics: MutableList<ConfigurationDiagnostic>,
        valid: (Long) -> Boolean,
    ): Long? {
        val raw = environment(name)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val value = raw.toLongOrNull()
        if (value == null || !valid(value)) return invalid(name, raw, diagnostics).let { null }
        return value
    }

    private fun invalid(name: String, value: String, diagnostics: MutableList<ConfigurationDiagnostic>) {
        diagnostics += ConfigurationDiagnostic(
            code = "CONFIG_ENV_OVERRIDE_INVALID",
            severity = DiagnosticSeverity.ERROR,
            message = "Environment override '$name' has unsupported value '$value'",
            source = "environment:$name",
        )
    }
}
