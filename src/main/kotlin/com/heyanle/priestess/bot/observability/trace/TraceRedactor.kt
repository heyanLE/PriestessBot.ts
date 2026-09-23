package com.heyanle.priestess.bot.observability.trace

import kotlinx.serialization.json.*

/** Redacts before persistence, including JSON encoded inside tool argument/result strings. */
class TraceRedactor(
    private val knownSecrets: Collection<String> = environmentSecrets(),
    private val maxStringCharacters: Int = 16_384,
    private val maxPayloadCharacters: Int = 131_072,
) {
    data class Result(val data: JsonObject, val truncated: Boolean)

    fun text(value: String, limit: Int = maxStringCharacters): String {
        var result = value
        knownSecrets.filter { it.length >= 4 }.sortedByDescending { it.length }.forEach {
            result = result.replace(it, REDACTED)
        }
        result = BEARER.replace(result) { "${it.groupValues[1]}$REDACTED" }
        result = ASSIGNMENT.replace(result) { "${it.groupValues[1]}$REDACTED" }
        result = URL_PASSWORD.replace(result) { "${it.groupValues[1]}$REDACTED@" }
        result = API_KEY.replace(result, REDACTED)
        result = BASE64.replace(result, "[binary content omitted]")
        val marker = "\n[truncated]".take(limit.coerceAtLeast(0))
        return if (result.length > limit) safePrefix(result, limit - marker.length) + marker else result
    }

    fun sanitize(data: JsonObject): Result {
        var truncated = false
        fun visit(value: JsonElement, depth: Int): JsonElement {
            if (depth > 20) {
                truncated = true
                return JsonPrimitive("[maximum nesting depth]")
            }
            return when (value) {
                is JsonObject -> JsonObject(value.entries.take(256).associate { (key, child) ->
                    key to if (SECRET_KEY.matches(key)) JsonPrimitive(REDACTED) else visit(child, depth + 1)
                }.also { if (value.size > 256) truncated = true })
                is JsonArray -> JsonArray(value.take(512).map { visit(it, depth + 1) }.also { if (value.size > 512) truncated = true })
                is JsonPrimitive -> if (value.isString) {
                    val original = value.content
                    val embedded = if (original.trimStart().startsWith("{") || original.trimStart().startsWith("[")) {
                        runCatching { Json.parseToJsonElement(original) }.getOrNull()
                    } else null
                    val clean = if (embedded is JsonObject || embedded is JsonArray) visit(embedded, depth + 1).toString() else original
                    if (clean.length > maxStringCharacters) truncated = true
                    JsonPrimitive(text(clean))
                } else value
            }
        }
        val clean = visit(data, 0) as JsonObject
        val serialized = clean.toString()
        if (serialized.length <= maxPayloadCharacters) return Result(clean, truncated)
        return Result(buildJsonObject {
            put("preview", safePrefix(serialized, maxPayloadCharacters / 2))
            put("omitted", "Payload exceeded trace storage limit")
        }, true)
    }

    private fun safePrefix(value: String, count: Int): String {
        val end = minOf(count.coerceAtLeast(0), value.length)
        return value.substring(0, if (end > 0 && value[end - 1].isHighSurrogate()) end - 1 else end)
    }

    companion object {
        private const val REDACTED = "[REDACTED]"
        private val SECRET_KEY = Regex("(?i)(?:authorization|proxy.authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|passwd|cookie|set.cookie|credential|credentials)")
        private val BEARER = Regex("(?i)((?:Bearer|Basic)\\s+)[A-Za-z0-9._~+/=-]+")
        private val ASSIGNMENT = Regex("(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|token|secret)[\"']?\\s*[=:]\\s*[\"']?)[^\\s\"'&,}]+")
        private val URL_PASSWORD = Regex("(https?://[^/:\\s]+:)[^@\\s]+@")
        private val API_KEY = Regex("\\bsk-[A-Za-z0-9_-]{8,}\\b")
        private val BASE64 = Regex("(?:base64://|data:[^;\\s]+;base64,)[A-Za-z0-9+/=]+")
        private fun environmentSecrets(): List<String> = System.getenv().filterKeys {
            Regex("(?i).*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|CREDENTIAL).*").matches(it)
        }.values.filter { it.length >= 8 }
    }
}
