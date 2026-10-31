package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.ConfigurationSourceKind
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import java.nio.file.Path

data class ResolvedConfigPath(
    val path: Path,
    val sourceKind: ConfigurationSourceKind,
    val selector: String,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
)

/** Resolves the global document path once at process entry. */
class ConfigPathSelector(
    private val environment: (String) -> String? = System::getenv,
    private val baseDirectory: Path = Path.of("").toAbsolutePath().normalize(),
    private val defaultPath: String = DEFAULT_CONFIG_PATH,
) {
    fun resolve(arguments: List<String> = emptyList()): ConfigurationSourceResult<ResolvedConfigPath> {
        val cli = parseCommandLine(arguments)
        if (cli.diagnostics.any { it.severity == DiagnosticSeverity.ERROR }) {
            return ConfigurationSourceResult(diagnostics = cli.diagnostics)
        }

        val environmentPath = environment(CONFIG_PATH_ENV)?.takeIf { it.isNotBlank() }
        val selected = when {
            cli.path != null -> Selection(cli.path, ConfigurationSourceKind.COMMAND_LINE, "--config")
            environmentPath != null -> Selection(environmentPath, ConfigurationSourceKind.ENVIRONMENT, CONFIG_PATH_ENV)
            else -> Selection(defaultPath, ConfigurationSourceKind.DEFAULT, "default")
        }
        val diagnostics = cli.diagnostics.toMutableList()
        val candidate = Path.of(selected.path)
        val normalized = (if (candidate.isAbsolute) candidate else baseDirectory.resolve(candidate))
            .toAbsolutePath()
            .normalize()
        return ConfigurationSourceResult(
            value = ResolvedConfigPath(
                path = normalized,
                sourceKind = selected.sourceKind,
                selector = selected.selector,
                diagnostics = diagnostics,
            ),
            diagnostics = diagnostics,
        )
    }

    private fun parseCommandLine(arguments: List<String>): CliSelection {
        val values = mutableListOf<String>()
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        var index = 0
        while (index < arguments.size) {
            val argument = arguments[index]
            when {
                argument == "--config" -> {
                    val value = arguments.getOrNull(index + 1)
                    if (value.isNullOrBlank() || value.startsWith("--")) {
                        diagnostics += cliError("--config requires a non-blank path")
                    } else {
                        values += value
                        index += 1
                    }
                }
                argument.startsWith("--config=") -> {
                    val value = argument.substringAfter('=')
                    if (value.isBlank()) diagnostics += cliError("--config requires a non-blank path") else values += value
                }
            }
            index += 1
        }
        if (values.size > 1) diagnostics += cliError("--config may be specified only once")
        return CliSelection(path = values.singleOrNull(), diagnostics = diagnostics)
    }

    private fun cliError(message: String) = ConfigurationDiagnostic(
        code = "CONFIG_PATH_ARGUMENT_INVALID",
        severity = DiagnosticSeverity.ERROR,
        message = message,
        source = "command-line",
        path = "--config",
    )

    private data class Selection(
        val path: String,
        val sourceKind: ConfigurationSourceKind,
        val selector: String,
    )

    private data class CliSelection(
        val path: String?,
        val diagnostics: List<ConfigurationDiagnostic>,
    )

    companion object {
        const val CONFIG_PATH_ENV = "PRIESTESS_CONFIG_PATH"
        const val DEFAULT_CONFIG_PATH = "config.json"
    }
}
