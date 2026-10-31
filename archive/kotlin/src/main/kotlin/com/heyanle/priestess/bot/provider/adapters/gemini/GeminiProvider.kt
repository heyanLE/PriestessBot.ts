package com.heyanle.priestess.bot.provider.adapters.gemini

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
import io.ktor.client.request.parameter
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
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Gemini 模型提供者，负责调用 Google generateContent 和模型列表接口。
 */
class GeminiProvider(
    override val config: ProviderConfig,
    override val metadata: ProviderMetadata = ProviderMetadata(
        name = config.name.ifBlank { "gemini" },
        displayName = "Gemini",
        kind = LLMKind.GEMINI,
        supportToolCalling = false,
        supportVision = false,
        supportStreaming = false,
    ),
    private val client: HttpClient = defaultClient(),
) : ChatProvider {

    private val configuredUrl: String
        get() = config.baseUrl.ifBlank { "https://generativelanguage.googleapis.com/v1beta" }.trimEnd('/')

    override suspend fun textChat(request: LLMRequest): LLMResponse {
        val model = request.model.ifBlank { config.model }
        val response = client.post(generateContentUrl(model)) {
            contentType(ContentType.Application.Json)
            parameter("key", config.resolveApiKey())
            setBody(buildJsonObject {
                systemPrompt(request.messages)?.let { prompt ->
                    put("system_instruction", buildTextPartsObject(prompt))
                }
                put("contents", buildJsonArray {
                    request.messages
                        .filterNot { it.role == "system" }
                        .forEach { add(toGeminiContent(it)) }
                })
                put("generationConfig", buildJsonObject {
                    put("temperature", request.temperature)
                    request.maxTokens?.let { put("maxOutputTokens", it) }
                })
            })
        }
        return parseResponse(response.body())
    }

    override suspend fun getModels(): List<String> {
        val response = client.get(modelsUrl()) {
            parameter("key", config.resolveApiKey())
        }
        val body = response.body<JsonObject>()
        return body["models"]?.jsonArray
            ?.mapNotNull { model ->
                val name = model.jsonObject["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
                name.removePrefix("models/")
            }
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

    private fun generateContentUrl(model: String): String {
        if (configuredUrl.endsWith(":generateContent")) return configuredUrl
        val modelPath = if (model.startsWith("models/")) model else "models/${encode(model)}"
        return "$configuredUrl/$modelPath:generateContent"
    }

    private fun modelsUrl(): String {
        return configuredUrl.substringBefore("/models/").trimEnd('/') + "/models"
    }

    private fun systemPrompt(messages: List<ConversationMessage>): String? {
        return messages
            .filter { it.role == "system" }
            .mapNotNull { it.content }
            .joinToString("\n\n")
            .ifBlank { null }
    }

    private fun toGeminiContent(message: ConversationMessage): JsonObject {
        val role = if (message.role == "assistant") "model" else "user"
        val content = when (message.role) {
            "tool" -> "[tool:${message.name.orEmpty()}] ${message.content.orEmpty()}"
            else -> message.content.orEmpty()
        }
        return buildJsonObject {
            put("role", role)
            put("parts", buildJsonArray {
                add(buildJsonObject { put("text", content) })
            })
        }
    }

    private fun buildTextPartsObject(text: String): JsonObject {
        return buildJsonObject {
            put("parts", buildJsonArray {
                add(buildJsonObject { put("text", text) })
            })
        }
    }

    private fun parseResponse(body: JsonObject): LLMResponse {
        val candidate = body["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
        val parts = candidate
            ?.get("content")
            ?.jsonObject
            ?.get("parts") as? JsonArray
        val content = parts?.joinToString("") { part ->
            part.jsonObject["text"]?.jsonPrimitive?.content.orEmpty()
        }.orEmpty()
        val usage = body["usageMetadata"]?.jsonObject
        val promptTokens = usage?.get("promptTokenCount")?.jsonPrimitive?.int ?: 0
        val completionTokens = usage?.get("candidatesTokenCount")?.jsonPrimitive?.int ?: 0
        val totalTokens = usage?.get("totalTokenCount")?.jsonPrimitive?.int ?: promptTokens + completionTokens
        return LLMResponse(
            content = content,
            finishReason = candidate?.get("finishReason")?.jsonPrimitive?.content.orEmpty(),
            tokenUsage = TokenUsage(
                promptTokens = promptTokens,
                completionTokens = completionTokens,
                totalTokens = totalTokens,
            ),
        )
    }

    private fun encode(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
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
