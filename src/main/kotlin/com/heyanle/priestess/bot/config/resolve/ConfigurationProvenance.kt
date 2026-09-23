package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationSourceKind
import com.heyanle.priestess.bot.config.model.FieldProvenance
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class ConfigurationProvenanceBuilder(
    private val json: Json = Json { encodeDefaults = true },
) {
    fun global(document: AppConfigDocument, source: String, revision: RawConfigRevision): Map<String, FieldProvenance> {
        return leafPaths(json.parseToJsonElement(json.encodeToString(document))).associateWith { path ->
            FieldProvenance(ConfigurationSourceKind.GLOBAL_DOCUMENT, source, revision.value, path)
        }
    }

    fun workspace(document: WorkspaceConfigDocument, source: String, revision: RawConfigRevision): Map<String, FieldProvenance> {
        return leafPaths(json.parseToJsonElement(json.encodeToString(document))).associate { path ->
            "workspaces[${document.id}].$path" to FieldProvenance(
                ConfigurationSourceKind.WORKSPACE_DOCUMENT,
                source,
                revision.value,
                path,
            )
        }
    }

    fun fingerprint(vararg sourceTexts: String): SourceFingerprint {
        val digest = MessageDigest.getInstance("SHA-256")
        sourceTexts.forEach { source ->
            digest.update(source.toByteArray(StandardCharsets.UTF_8))
            digest.update(0)
        }
        return SourceFingerprint(digest.digest().joinToString("") { byte -> "%02x".format(byte) })
    }

    private fun leafPaths(element: JsonElement, prefix: String = ""): List<String> = when (element) {
        is JsonObject -> element.entries.flatMap { (key, value) -> leafPaths(value, prefix.child(key)) }
        is JsonArray -> element.flatMapIndexed { index, value -> leafPaths(value, "$prefix[$index]") }
        else -> listOf(prefix)
    }

    private fun String.child(name: String): String = if (isEmpty()) name else "$this.$name"
}
