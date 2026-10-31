package com.heyanle.priestess.bot.provider.adapters.openai

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.config.model.WireProtocol
import com.heyanle.priestess.bot.provider.*
import com.heyanle.priestess.bot.provider.model.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.*

/**
 * OpenAI 兼容模型提供者，负责调用 chat completions 和 models 接口。
 */
class OpenAIProvider(
    override val config: ProviderConfig,
    override val metadata: ProviderMetadata = ProviderMetadata(
        name = config.name.ifBlank { "openai" },
        displayName = "OpenAI",
        kind = LLMKind.OPENAI,
        supportToolCalling = true,
        supportVision = true,
        supportStreaming = true,
    ),
    private val client: HttpClient = defaultClient(),
) : ChatProvider {

    private val logger = KotlinLogging.logger {}

    private val wireProtocol: WireProtocol = config.config["wireProtocol"]?.let { declared ->
        WireProtocol.parse(declared) ?: error("Unknown OpenAI wire protocol '$declared'")
    } ?: WireProtocol.OPENAI_CHAT_COMPLETIONS

    init {
        require(wireProtocol in requireNotNull(WireProtocol.supportedFor("openai"))) {
            "OpenAI provider does not support ${wireProtocol.name}"
        }
    }

    private val configuredUrl: String
        get() = config.baseUrl.ifBlank { "https://api.openai.com/v1" }.trimEnd('/')

    private val chatCompletionsUrl: String
        get() = if (configuredUrl.endsWith("/chat/completions")) {
            configuredUrl
        } else {
            "$configuredUrl/chat/completions"
        }

    private val responsesUrl: String
        get() = when {
            configuredUrl.endsWith("/responses") -> configuredUrl
            configuredUrl.endsWith("/chat/completions") -> configuredUrl.removeSuffix("/chat/completions") + "/responses"
            else -> "$configuredUrl/responses"
        }

    private val modelsUrl: String
        get() = when {
            configuredUrl.endsWith("/chat/completions") -> configuredUrl.removeSuffix("/chat/completions") + "/models"
            configuredUrl.endsWith("/responses") -> configuredUrl.removeSuffix("/responses") + "/models"
            else -> "$configuredUrl/models"
        }

    override suspend fun textChat(request: LLMRequest): LLMResponse {
        if (wireProtocol == WireProtocol.OPENAI_RESPONSES) return textResponses(request)
        val model = request.model.ifBlank { config.model }
        logger.info {
            "[PIPELINE-230] OpenAIProvider request provider=${metadata.name}, model=$model, " +
                "url=$chatCompletionsUrl, messages=${request.messages.size}, tools=${request.tools.size}"
        }
        val response = client.post(chatCompletionsUrl) {
            contentType(ContentType.Application.Json)
            header("Authorization", "Bearer ${config.resolveApiKey()}")
            setBody(buildJsonObject {
                put("model", model)
                put("messages", buildJsonArray {
                    for (msg in request.messages) {
                        add(buildJsonObject {
                            put("role", msg.role)
                            msg.content?.let { put("content", it) }
                            msg.toolCallId?.let { put("tool_call_id", it) }
                            msg.name?.let { put("name", it) }
                            msg.toolCalls?.let { calls ->
                                put("tool_calls", buildJsonArray {
                                    for (call in calls) {
                                        add(buildJsonObject {
                                            put("id", call.id)
                                            put("type", "function")
                                            putJsonObject("function") {
                                                put("name", call.name)
                                                put("arguments", call.arguments)
                                            }
                                        })
                                    }
                                })
                            }
                        })
                    }
                })
                put("temperature", request.temperature)
                request.maxTokens?.let { put("max_tokens", it) }
                if (request.tools.isNotEmpty()) {
                    put("tools", JsonArray(request.tools))
                }
            })
        }
        val body = readJsonBody(response, "chat completions")
        val parsed = parseResponse(body)
        logger.info {
            "[PIPELINE-239] OpenAIProvider response provider=${metadata.name}, " +
                "finish=${parsed.finishReason}, toolCalls=${parsed.toolCalls.size}, " +
                "contentLength=${parsed.content.length}, totalTokens=${parsed.tokenUsage.totalTokens}"
        }
        return parsed
    }

    private suspend fun textResponses(request: LLMRequest): LLMResponse {
        val model = request.model.ifBlank { config.model }
        val response = client.post(responsesUrl) {
            contentType(ContentType.Application.Json)
            header("Authorization", "Bearer ${config.resolveApiKey()}")
            setBody(buildResponsesRequest(request, model))
        }
        return parseResponsesResponse(readJsonBody(response, "responses"))
    }

    private fun buildResponsesRequest(request: LLMRequest, model: String): JsonObject = buildJsonObject {
        put("model", model)
        put("store", false)
        val instructions = request.messages.filter { it.role == "system" }.mapNotNull { it.content }.joinToString("\n\n")
        if (instructions.isNotEmpty()) put("instructions", instructions)
        put("input", buildJsonArray {
            request.messages.forEach { message ->
                when (message.role) {
                    "system" -> Unit
                    "tool" -> add(buildJsonObject {
                        put("type", "function_call_output")
                        put("call_id", requireNotNull(message.toolCallId) { "Tool result requires a call id" })
                        put("output", message.content.orEmpty())
                    })
                    "user", "assistant" -> {
                        message.content?.takeIf { message.role == "user" || it.isNotEmpty() }?.let { content ->
                            add(buildJsonObject {
                                put("type", "message")
                                put("role", message.role)
                                put("content", buildJsonArray {
                                    add(buildJsonObject {
                                        put("type", if (message.role == "assistant") "output_text" else "input_text")
                                        put("text", content)
                                    })
                                })
                            })
                        }
                        if (message.role == "assistant") message.toolCalls.orEmpty().forEach { call ->
                            add(buildJsonObject {
                                put("type", "function_call")
                                put("call_id", call.id)
                                put("name", call.name)
                                put("arguments", call.arguments)
                            })
                        }
                    }
                    else -> error("Unsupported Responses message role '${message.role}'")
                }
            }
        })
        put("temperature", request.temperature)
        request.maxTokens?.let { put("max_output_tokens", it) }
        if (request.tools.isNotEmpty()) put("tools", buildJsonArray {
            request.tools.forEach { wrapped ->
                val function = wrapped["function"]?.jsonObject
                    ?: error("Responses tool must contain a function definition")
                add(buildJsonObject {
                    put("type", "function")
                    put("name", requireNotNull(function["name"]))
                    function["description"]?.let { put("description", it) }
                    function["parameters"]?.let { put("parameters", it) }
                })
            }
        })
    }

    private fun parseResponsesResponse(body: JsonObject): LLMResponse {
        if (body["status"]?.jsonPrimitive?.contentOrNull == "failed") {
            error("OpenAI-compatible responses request returned a failed response")
        }
        val output = body["output"] as? JsonArray
            ?: error("OpenAI-compatible responses response has no output array")
        val content = buildList {
            output.forEach { item ->
                val obj = item as? JsonObject ?: return@forEach
                if (obj["type"]?.jsonPrimitive?.contentOrNull != "message") return@forEach
                (obj["content"] as? JsonArray)?.forEach { part ->
                    val text = part as? JsonObject ?: return@forEach
                    if (text["type"]?.jsonPrimitive?.contentOrNull == "output_text") {
                        text["text"]?.jsonPrimitive?.contentOrNull?.let(::add)
                    }
                }
            }
        }.joinToString("\n")
        val toolCalls = output.mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            if (obj["type"]?.jsonPrimitive?.contentOrNull != "function_call") return@mapNotNull null
            ToolCall(
                id = obj["call_id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                arguments = obj["arguments"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            )
        }
        val usage = body["usage"] as? JsonObject
        val promptTokens = usage?.get("input_tokens")?.jsonPrimitive?.intOrNull ?: 0
        val completionTokens = usage?.get("output_tokens")?.jsonPrimitive?.intOrNull ?: 0
        val reason = (body["incomplete_details"] as? JsonObject)?.get("reason")?.jsonPrimitive?.contentOrNull
        val status = body["status"]?.jsonPrimitive?.contentOrNull
        return LLMResponse(
            content = content,
            toolCalls = toolCalls,
            finishReason = when {
                status == "incomplete" && reason == "max_output_tokens" -> "length"
                status == "incomplete" -> "incomplete"
                toolCalls.isNotEmpty() -> "tool_calls"
                else -> "stop"
            },
            tokenUsage = TokenUsage(promptTokens, completionTokens,
                usage?.get("total_tokens")?.jsonPrimitive?.intOrNull ?: promptTokens + completionTokens),
        )
    }

    override suspend fun getModels(): List<String> {
        val response = client.get(modelsUrl) {
            header("Authorization", "Bearer ${config.resolveApiKey()}")
        }
        val body = readJsonBody(response, "models")
        return body["data"]?.jsonArray
            ?.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }
            ?: emptyList()
    }

    override suspend fun test(): Boolean {
        return try { getModels(); true } catch (e: Exception) { false }
    }

    private fun parseResponse(body: JsonObject): LLMResponse {
        val choices = body["choices"]?.jsonArray ?: return LLMResponse()
        val choice = choices.firstOrNull()?.jsonObject ?: return LLMResponse()
        val message = choice["message"]?.jsonObject
        val content = message?.get("content")?.jsonPrimitive?.content ?: ""
        val finishReason = choice["finish_reason"]?.jsonPrimitive?.content ?: ""

        val toolCalls = message?.get("tool_calls")?.jsonArray?.mapNotNull { tc ->
            val obj = tc.jsonObject
            val function = obj["function"]?.jsonObject
            ToolCall(
                id = obj["id"]?.jsonPrimitive?.content ?: "",
                name = function?.get("name")?.jsonPrimitive?.content ?: "",
                arguments = function?.get("arguments")?.jsonPrimitive?.content ?: "",
            )
        } ?: emptyList()

        val usage = body["usage"]?.jsonObject
        val tokenUsage = TokenUsage(
            promptTokens = usage?.get("prompt_tokens")?.jsonPrimitive?.int ?: 0,
            completionTokens = usage?.get("completion_tokens")?.jsonPrimitive?.int ?: 0,
            totalTokens = usage?.get("total_tokens")?.jsonPrimitive?.int ?: 0,
        )
        return LLMResponse(content, toolCalls, finishReason, tokenUsage)
    }

    private suspend fun readJsonBody(response: io.ktor.client.statement.HttpResponse, endpointName: String): JsonObject {
        val status = response.status
        val rawBody = response.bodyAsText()
        val body = runCatching { Json.parseToJsonElement(rawBody).jsonObject }.getOrNull()

        if (!status.isSuccess()) {
            val providerMessage = body?.let(::extractProviderErrorMessage)
            val fallback = rawBody.trim().take(500).ifBlank { "<empty body>" }
            throw IllegalStateException(
                "OpenAI-compatible $endpointName request failed: ${status.value} ${status.description}. " +
                    (providerMessage ?: fallback),
            )
        }

        return body ?: throw IllegalStateException(
            "OpenAI-compatible $endpointName response was not valid JSON " +
                "(status=${status.value}, contentType=${response.contentType() ?: "unknown"}). " +
                rawBody.trim().take(500),
        )
    }

    private fun extractProviderErrorMessage(body: JsonObject): String? {
        val error = body["error"]?.jsonObject ?: return null
        return error["message"]?.jsonPrimitive?.contentOrNull
            ?: error["type"]?.jsonPrimitive?.contentOrNull
            ?: error["code"]?.jsonPrimitive?.contentOrNull
    }

    companion object {
        private fun defaultClient(): HttpClient {
            return HttpClient(CIO) {
                install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
                install(HttpTimeout) {
                    requestTimeoutMillis = 180_000  // 3 分钟，LLM 复杂请求可能较慢
                    connectTimeoutMillis = 15_000   // 15 秒连接超时
                }
            }
        }
    }
}
