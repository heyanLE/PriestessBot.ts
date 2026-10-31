package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Strict JSON decoder for the current global source schema. */
class AppConfigDocumentDecoder(
    private val json: Json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        explicitNulls = false
    },
) {
    fun decode(text: String, source: String): ConfigurationSourceResult<AppConfigDocument> {
        val normalized = text.trimLeadingBom()
        if (normalized.isBlank()) {
            return failure("CONFIG_DOCUMENT_EMPTY", "Global configuration document is empty", source)
        }
        return try {
            StrictJsonPreflight.requireNoDuplicateKeys(normalized, source)
            val element = json.parseToJsonElement(normalized)
            val version = element.jsonObject["schemaVersion"]?.jsonPrimitive?.content?.toIntOrNull()
            if (version == null) {
                failure("CONFIG_SCHEMA_VERSION_MISSING", "Global configuration requires integer schemaVersion", source, "schemaVersion")
            } else if (version != AppConfigDocument.CURRENT_SCHEMA_VERSION) {
                failure(
                    "CONFIG_SCHEMA_VERSION_UNSUPPORTED",
                    "Unsupported global schemaVersion $version; expected ${AppConfigDocument.CURRENT_SCHEMA_VERSION}",
                    source,
                    "schemaVersion",
                )
            } else {
                ConfigurationSourceResult(value = json.decodeFromJsonElement(AppConfigDocument.serializer(), element))
            }
        } catch (cause: SerializationException) {
            val message = cause.message ?: "Invalid global configuration JSON"
            val unknown = Regex("unknown key ['\\\"]([^'\\\"]+)['\\\"]", RegexOption.IGNORE_CASE)
                .find(message)
                ?.groupValues
                ?.getOrNull(1)
            if (unknown == null) {
                failure("CONFIG_JSON_INVALID", message, source)
            } else {
                failure("CONFIG_JSON_UNKNOWN_FIELD", message, source, unknown)
            }
        } catch (cause: IllegalArgumentException) {
            failure("CONFIG_JSON_INVALID", cause.message ?: "Invalid global configuration JSON", source)
        } catch (cause: Exception) {
            failure("CONFIG_JSON_INVALID", cause.message ?: "Invalid global configuration JSON", source)
        }
    }

    private fun failure(code: String, message: String, source: String, path: String = "") = ConfigurationSourceResult<AppConfigDocument>(
        diagnostics = listOf(
            ConfigurationDiagnostic(
                code = code,
                severity = DiagnosticSeverity.ERROR,
                message = message,
                source = source,
                path = path,
            ),
        ),
    )

    private fun String.trimLeadingBom(): String = if (startsWith('\uFEFF')) drop(1) else this
}
