package com.heyanle.priestess.bot.provider.adapters.ollama

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.provider.*
import com.heyanle.priestess.bot.provider.model.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.*
import java.util.UUID

/**
 * Ollama 本地模型提供者，负责调用本地 chat 和 tags 接口。
 */
class OllamaProvider(
    override val config: ProviderConfig,
    override val metadata: ProviderMetadata = ProviderMetadata(
        name = config.name.ifBlank { "ollama" },
        displayName = "Ollama",
        kind = LLMKind.OLLAMA,
        supportToolCalling = true,
        supportVision = false,
        supportStreaming = true,
    ),
) : ChatProvider {

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        install(HttpTimeout) {
            requestTimeoutMillis = 180_000
            connectTimeoutMillis = 10_000
        }
    }

    private val baseUrl: String
        get() = config.baseUrl.ifBlank { "http://127.0.0.1:11434" }

    override suspend fun textChat(request: LLMRequest): LLMResponse {
        val response = client.post("$baseUrl/api/chat") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("model", request.model.ifBlank { config.model })
                put("messages", buildJsonArray {
                    for (msg in request.messages) {
                        add(buildJsonObject {
                            put("role", msg.role)
                            msg.content?.let { put("content", it) }
                        })
                    }
                })
                put("stream", false)
                if (request.tools.isNotEmpty()) {
                    put("tools", JsonArray(request.tools))
                }
            })
        }
        val body = response.body<JsonObject>()
        val content = body["message"]?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""

        val toolCalls = body["message"]?.jsonObject?.get("tool_calls")?.jsonArray?.mapNotNull { tc ->
            val obj = tc.jsonObject
            val function = obj["function"]?.jsonObject
            ToolCall(
                id = obj["id"]?.jsonPrimitive?.content ?: UUID.randomUUID().toString(),
                name = function?.get("name")?.jsonPrimitive?.content ?: "",
                arguments = function?.get("arguments")?.jsonPrimitive?.content ?: "",
            )
        } ?: emptyList()

        return LLMResponse(content = content, toolCalls = toolCalls, finishReason = "stop")
    }

    override suspend fun getModels(): List<String> {
        val response = client.get("$baseUrl/api/tags")
        val body = response.body<JsonObject>()
        return body["models"]?.jsonArray
            ?.mapNotNull { it.jsonObject["name"]?.jsonPrimitive?.content }
            ?: emptyList()
    }

    override suspend fun test(): Boolean {
        return try { getModels(); true } catch (e: Exception) { false }
    }
}
