package com.heyanle.priestess.bot.observability.trace

import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.TokenUsage
import com.heyanle.priestess.bot.tool.ToolResult
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString

/** One recorder belongs to exactly one inbound execution; logging cannot fail the user's task. */
class ExecutionTraceRecorder internal constructor(val id: String, private val controller: ExecutionTraceController) {
    private val logger = KotlinLogging.logger {}
    private val json = Json { encodeDefaults = true }

    fun identify(workspaceId: String, agent: String, provider: String, model: String) = safely {
        controller.identify(id, workspaceId, agent, provider, model)
    }

    fun record(category: TraceCategory, type: String, data: JsonObject = buildJsonObject {}, step: Int? = null, durationMillis: Long? = null) = safely {
        controller.record(id, category, type, data, step, durationMillis)
    }

    fun llmRequest(step: Int, request: LLMRequest) = safely {
        controller.record(id, TraceCategory.LLM, "llm.request", json.encodeToJsonElement(request).jsonObject, step)
    }

    fun llmResponse(step: Int, response: LLMResponse, durationMillis: Long) = safely {
        controller.record(id, TraceCategory.LLM, "llm.response", json.encodeToJsonElement(response).jsonObject, step, durationMillis, response.tokenUsage)
    }

    /** Records a native engine's actual per-turn usage without fabricating a ChatProvider response. */
    fun codexUsage(usage: TokenUsage) = safely {
        controller.record(id, TraceCategory.LLM, "codex.usage", buildJsonObject {
            put("inputTokens", usage.promptTokens)
            put("outputTokens", usage.completionTokens)
            put("totalTokens", usage.totalTokens)
        }, usage = usage)
    }

    fun toolCall(step: Int, callId: String, name: String, arguments: String) = record(TraceCategory.TOOL, "tool.call", buildJsonObject {
        put("callId", callId); put("name", name); put("arguments", arguments)
    }, step)

    fun toolResult(step: Int, callId: String, name: String, result: ToolResult, observation: String, durationMillis: Long) = record(TraceCategory.TOOL, "tool.result", buildJsonObject {
        put("callId", callId); put("name", name)
        put("result", json.encodeToJsonElement(result)); put("observation", observation)
    }, step, durationMillis)

    fun complete(status: ExecutionStatus, output: String = "", error: String? = null) = safely {
        controller.complete(id, status, output, error)
    }

    private inline fun safely(block: () -> Unit) {
        try { block() } catch (_: Exception) {
            // Never include raw exceptions: a database driver can repeat the sensitive payload.
            logger.warn { "Execution trace storage failed executionId=$id" }
        }
    }
}
