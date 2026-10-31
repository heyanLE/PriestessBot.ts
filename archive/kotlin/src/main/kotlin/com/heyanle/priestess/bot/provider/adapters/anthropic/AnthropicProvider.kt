package com.heyanle.priestess.bot.provider.adapters.anthropic

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.LLMKind
import com.heyanle.priestess.bot.provider.ProviderMetadata
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.TokenUsage
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Anthropic 模型提供者，负责将通用请求转换为 Claude messages API 调用。
 */
class AnthropicProvider(
    override val config: ProviderConfig,
    override val metadata: ProviderMetadata = ProviderMetadata(
        name = config.name.ifBlank { "anthropic" },
        displayName = "Anthropic",
        kind = LLMKind.ANTHROPIC,
        supportToolCalling = false,
        supportVision = false,
        supportStreaming = false,
    ),
    private val client: HttpClient = defaultClient(),
) : ChatProvider {

    private val configuredUrl: String
        get() = config.baseUrl.ifBlank { "https://api.anthropic.com/v1" }.trimEnd('/')

    private val messagesUrl: String
        get() = if (configuredUrl.endsWith("/messages")) configuredUrl else "$configuredUrl/messages"

    private val modelsUrl: String
        get() = if (configuredUrl.endsWith("/messages")) {
            configuredUrl.removeSuffix("/messages") + "/models"
        } else {
            "$configuredUrl/models"
        }

    private val anthropicVersion: String
        get() = config.config["anthropicVersion"] ?: "2023-06-01"

    override suspend fun textChat(request: LLMRequest): LLMResponse {
        val model = request.model.ifBlank { config.model }
        val response = client.post(messagesUrl) {
            contentType(ContentType.Application.Json)
            header("x-api-key", config.resolveApiKey())
            header("anthropic-version", anthropicVersion)
            setBody(buildJsonObject {
                put("model", model)
                put("max_tokens", request.maxTokens ?: config.config["maxTokens"]?.toIntOrNull() ?: 4096)
                put("temperature", request.temperature)
                systemPrompt(request.messages)?.let { put("system", it) }
                put("messages", buildJsonArray {
                    request.messages
                        .filterNot { it.role == "system" }
                        .forEach { add(toAnthropicMessage(it)) }
                })
            })
        }
        return parseResponse(response.body())
    }

    override suspend fun getModels(): List<String> {
        val response = client.get(modelsUrl) {
            header("x-api-key", config.resolveApiKey())
            header("anthropic-version", anthropicVersion)
        }
        val body = response.body<JsonObject>()
        return body["data"]?.jsonArray
            ?.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }
            ?: emptyList()
    }

    override suspend fun test(): Boolean {
        return try {
            getModels()
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun systemPrompt(messages: List<ConversationMessage>): String? {
        return messages
            .filter { it.role == "system" }
            .mapNotNull { it.content }
            .joinToString("\n\n")
            .ifBlank { null }
    }

    private fun toAnthropicMessage(message: ConversationMessage): JsonObject {
        val role = if (message.role == "assistant") "assistant" else "user"
        val content = when (message.role) {
            "tool" -> "[tool:${message.name.orEmpty()}] ${message.content.orEmpty()}"
            else -> message.content.orEmpty()
        }
        return buildJsonObject {
            put("role", role)
            put("content", content)
        }
    }

    private fun parseResponse(body: JsonObject): LLMResponse {
        val content = when (val value = body["content"]) {
            is JsonArray -> value.joinToString("") { block ->
                val obj = block.jsonObject
                if (obj["type"]?.jsonPrimitive?.content == "text") {
                    obj["text"]?.jsonPrimitive?.content.orEmpty()
                } else {
                    ""
                }
            }
            else -> ""
        }
        val usage = body["usage"]?.jsonObject
        val promptTokens = usage?.get("input_tokens")?.jsonPrimitive?.int ?: 0
        val completionTokens = usage?.get("output_tokens")?.jsonPrimitive?.int ?: 0
        return LLMResponse(
            content = content,
            finishReason = body["stop_reason"]?.jsonPrimitive?.content.orEmpty(),
            tokenUsage = TokenUsage(
                promptTokens = promptTokens,
                completionTokens = completionTokens,
                totalTokens = promptTokens + completionTokens,
            ),
        )
    }

    companion object {
        private fun defaultClient(): HttpClient {
            return HttpClient(CIO) {
                install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
                install(HttpTimeout) {
                    requestTimeoutMillis = 180_000
                    connectTimeoutMillis = 15_000
                }
            }
        }
    }
}
