package com.heyanle.priestess.bot.config.source

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.McpServerDefinitionDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings

/** Strict YAML/JSON decoder for current Workspace authoring files. */
class WorkspaceConfigDocumentDecoder(
    private val json: Json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        explicitNulls = false
    },
) {
    fun decodeWorkspace(yaml: String, source: String): ConfigurationSourceResult<WorkspaceConfigDocument> {
        if (yaml.isBlank()) return workspaceFailure("WORKSPACE_DOCUMENT_EMPTY", "Workspace configuration document is empty", source)
        return try {
            val settings = LoadSettings.builder()
                .setLabel(source)
                .setAllowDuplicateKeys(false)
                .build()
            val loaded = Load(settings).loadFromString(yaml)
            val element = toJsonElement(loaded)
            val version = element.jsonObject["schemaVersion"]?.jsonPrimitive?.content?.toIntOrNull()
            if (version == null) {
                workspaceFailure("WORKSPACE_SCHEMA_VERSION_MISSING", "Workspace configuration requires integer schemaVersion", source, "schemaVersion")
            } else if (version != WorkspaceConfigDocument.CURRENT_SCHEMA_VERSION) {
                workspaceFailure(
                    "WORKSPACE_SCHEMA_VERSION_UNSUPPORTED",
                    "Unsupported Workspace schemaVersion $version; expected ${WorkspaceConfigDocument.CURRENT_SCHEMA_VERSION}",
                    source,
                    "schemaVersion",
                )
            } else {
                ConfigurationSourceResult(value = json.decodeFromJsonElement(WorkspaceConfigDocument.serializer(), element))
            }
        } catch (cause: Exception) {
            workspaceFailure("WORKSPACE_YAML_INVALID", cause.message ?: "Invalid Workspace YAML", source)
        }
    }

    fun decodeMcpServers(jsonText: String, source: String): ConfigurationSourceResult<McpServerFileDocument> {
        if (jsonText.isBlank()) return mcpFailure("MCP_DOCUMENT_EMPTY", "MCP declaration document is empty", source)
        return try {
            val normalized = jsonText.removePrefix("\uFEFF")
            StrictJsonPreflight.requireNoDuplicateKeys(normalized, source)
            val element = json.parseToJsonElement(normalized)
            val version = element.jsonObject["schemaVersion"]?.jsonPrimitive?.content?.toIntOrNull()
            if (version == null) {
                mcpFailure("MCP_SCHEMA_VERSION_MISSING", "MCP declaration document requires integer schemaVersion", source, "schemaVersion")
            } else if (version != McpServerFileDocument.CURRENT_SCHEMA_VERSION) {
                mcpFailure(
                    "MCP_SCHEMA_VERSION_UNSUPPORTED",
                    "Unsupported MCP schemaVersion $version; expected ${McpServerFileDocument.CURRENT_SCHEMA_VERSION}",
                    source,
                    "schemaVersion",
                )
            } else {
                ConfigurationSourceResult(value = json.decodeFromJsonElement(McpServerFileDocument.serializer(), element))
            }
        } catch (cause: SerializationException) {
            mcpFailure("MCP_JSON_INVALID", cause.message ?: "Invalid MCP declaration JSON", source)
        } catch (cause: IllegalArgumentException) {
            mcpFailure("MCP_JSON_INVALID", cause.message ?: "Invalid MCP declaration JSON", source)
        } catch (cause: Exception) {
            mcpFailure("MCP_JSON_INVALID", cause.message ?: "Invalid MCP declaration JSON", source)
        }
    }

    private fun toJsonElement(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is JsonElement -> value
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(value.entries.associate { (key, nested) -> key.toString() to toJsonElement(nested) })
        is Iterable<*> -> JsonArray(value.map(::toJsonElement))
        is Array<*> -> JsonArray(value.map(::toJsonElement))
        else -> JsonPrimitive(value.toString())
    }

    private fun workspaceFailure(code: String, message: String, source: String, path: String = "") = ConfigurationSourceResult<WorkspaceConfigDocument>(
        diagnostics = listOf(error(code, message, source, path)),
    )

    private fun mcpFailure(code: String, message: String, source: String, path: String = "") = ConfigurationSourceResult<McpServerFileDocument>(
        diagnostics = listOf(error(code, message, source, path)),
    )

    private fun error(code: String, message: String, source: String, path: String) = ConfigurationDiagnostic(
        code = code,
        severity = DiagnosticSeverity.ERROR,
        message = message,
        source = source,
        path = path,
    )
}

@Serializable
data class McpServerFileDocument(
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val mcpServers: List<McpServerDefinitionDocument> = emptyList(),
) {
    companion object {
        const val CURRENT_SCHEMA_VERSION = 2
    }
}
