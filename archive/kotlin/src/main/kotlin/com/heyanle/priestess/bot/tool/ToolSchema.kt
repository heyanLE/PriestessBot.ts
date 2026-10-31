package com.heyanle.priestess.bot.tool

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * JSON Schema definition for a tool's parameters.
 * Describes the name, description, and parameter structure that LLMs use for tool calling.
 */
@Serializable
data class ToolSchema @JvmOverloads constructor(
    val name: String,
    val description: String = "",
    val parameters: ToolParameters = ToolParameters(),
    val riskLevel: ToolRiskLevel = ToolRiskLevel.SAFE_READ,
    val requiredCapabilities: List<String> = emptyList(),
    val defaultEnabled: Boolean = true,
    val auditLog: Boolean = false,
    val requiredPermissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    /**
     * Short behavioural guidance rendered into the Agent's prompt as its own block. Use it for how to
     * operate the tool — when to prefer it, what it cannot do — never to restate the parameter schema,
     * which reaches the model as a native function definition.
     *
     * Declared last on purpose: plugins are compiled against this constructor, so inserting a parameter
     * ahead of an existing one would break every positional Java call (the demo plugin test covers this).
     */
    val guidance: String = "",
    /**
     * Whether this tool may run concurrently with adjacent parallel-safe calls in one step. Opting in is
     * an explicit claim: leave it false for anything that mutates state, so exclusive calls stay ordered.
     *
     * Declared last for the same ABI reason as [guidance].
     */
    val parallelSafe: Boolean = false,
) {
    /**
     * Converts this schema to OpenAI function-calling format.
     * Returns a JsonObject matching the OpenAI tool definition structure:
     * { "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} } }
     */
    fun toOpenAIFormat(descriptionOverride: String = description): JsonObject {
        return buildJsonObject {
            put("type", "function")
            putJsonObject("function") {
                put("name", name)
                put("description", descriptionOverride)
                put("parameters", buildJsonObject {
                    put("type", "object")
                    put("properties", parameters.toJsonProperties())
                    if (parameters.required.isNotEmpty()) {
                        putJsonArray("required") {
                            for (req in parameters.required) {
                                add(JsonPrimitive(req))
                            }
                        }
                    }
                })
            }
        }
    }

    /**
     * Converts to Anthropic tool format.
     */
    fun toAnthropicFormat(): JsonObject {
        return buildJsonObject {
            put("name", name)
            put("description", description)
            put("input_schema", buildJsonObject {
                put("type", "object")
                put("properties", parameters.toJsonProperties())
                if (parameters.required.isNotEmpty()) {
                    putJsonArray("required") {
                        for (req in parameters.required) {
                            add(JsonPrimitive(req))
                        }
                    }
                }
            })
        }
    }
}

@Serializable
enum class ToolRiskLevel {
    SAFE_READ,
    SESSION_ACTION,
    EXTERNAL_READ,
    STATE_WRITE,
    HIGH_RISK,
}

object ToolCapabilities {
    const val PLATFORM = "platform"
    const val SESSION = "session"
    const val NETWORK = "network"
    const val CONVERSATION_HISTORY = "conversation_history"
    const val MEMORY = "memory"
    const val REMINDER = "reminder"
    const val PROVIDER_SEARCH = "provider_search"
    const val PLUGIN = "plugin"
    const val MCP = "mcp"
    const val KNOWLEDGE = "knowledge"
}

/**
 * Defines the parameters a tool accepts.
 */
@Serializable
data class ToolParameters(
    val properties: List<ParameterDef> = emptyList(),
    val required: List<String> = emptyList(),
) {
    fun toJsonProperties(): JsonObject {
        return buildJsonObject {
            for (prop in properties) {
                putJsonObject(prop.name) {
                    put("type", prop.type)
                    put("description", prop.description)
                    if (prop.enumValues.isNotEmpty()) {
                        putJsonArray("enum") {
                            for (v in prop.enumValues) {
                                add(JsonPrimitive(v))
                            }
                        }
                    }
                    if (prop.items != null) {
                        putJsonObject("items") {
                            put("type", prop.items)
                        }
                    }
                }
            }
        }
    }
}

/**
 * A single parameter definition within a tool's schema.
 */
@Serializable
data class ParameterDef(
    val name: String,
    val type: String = "string",
    val description: String = "",
    val required: Boolean = false,
    val enumValues: List<String> = emptyList(),
    val items: String? = null,
)
