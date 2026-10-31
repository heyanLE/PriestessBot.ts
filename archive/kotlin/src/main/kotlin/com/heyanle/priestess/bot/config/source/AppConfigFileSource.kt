package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.RawConfigState
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** File source with non-destructive passive reads and explicit first-run bootstrap. */
class AppConfigFileSource(
    private val decoder: AppConfigDocumentDecoder = AppConfigDocumentDecoder(),
    private val store: RevisionedConfigFileStore = RevisionedConfigFileStore(),
    private val json: Json = Json { prettyPrint = true; encodeDefaults = true },
) {
    fun load(path: Path): ConfigurationSourceResult<RawConfigState> {
        val normalized = path.toAbsolutePath().normalize()
        if (!Files.isRegularFile(normalized)) {
            return failure("CONFIG_FILE_MISSING", "Global configuration file does not exist", normalized)
        }
        val content = runCatching { Files.readString(normalized) }.getOrElse { cause ->
            return failure("CONFIG_FILE_READ_FAILED", cause.message ?: "Failed to read global configuration", normalized)
        }
        val decoded = decoder.decode(content, normalized.toString())
        val document = decoded.value ?: return ConfigurationSourceResult(diagnostics = decoded.diagnostics)
        return ConfigurationSourceResult(
            value = RawConfigState(
                document = document,
                sourcePath = normalized.toString(),
                revision = checkNotNull(store.revision(normalized)),
            ),
            diagnostics = decoded.diagnostics,
        )
    }

    fun bootstrap(path: Path, document: AppConfigDocument = AppConfigDocument()): ConfigurationSourceResult<RawConfigState> {
        val normalized = path.toAbsolutePath().normalize()
        val existing = normalized.takeIf(Files::isRegularFile)?.let(Files::readString)
        if (existing != null && existing.isNotBlank()) {
            return failure(
                "CONFIG_BOOTSTRAP_TARGET_NOT_EMPTY",
                "Bootstrap refuses to overwrite a non-empty configuration file",
                normalized,
            )
        }
        val result = store.persist(
            path = normalized,
            content = json.encodeToString(document),
            expectedRevision = store.revision(normalized),
            isValidExisting = { false },
        )
        if (result is PersistResult.Conflict) {
            return failure("CONFIG_REVISION_CONFLICT", "Configuration file changed during bootstrap", normalized)
        }
        return load(normalized)
    }

    private fun failure(code: String, message: String, path: Path) = ConfigurationSourceResult<RawConfigState>(
        diagnostics = listOf(
            ConfigurationDiagnostic(
                code = code,
                severity = DiagnosticSeverity.ERROR,
                message = message,
                source = path.toString(),
            ),
        ),
    )
}
