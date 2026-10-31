package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.provider.model.TokenUsage
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceRecorder
import com.heyanle.priestess.bot.observability.trace.TraceCategory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** One Codex turn over an existing thread. The first integration advertises no dynamic tools. */
internal class CodexTurnExecutor(
    private val native: CodexNativePort,
    private val timeoutMillis: Long = 180_000,
    private val tools: CodexToolDispatcher? = null,
    private val trace: ExecutionTraceRecorder? = null,
) {
    suspend fun run(threadId: String, userContent: String): AgentResponse {
        val request = buildJsonObject {
            put("mode", "start_if_idle")
            put("input", buildJsonArray {
                add(buildJsonObject { put("type", "text"); put("text", userContent) })
            })
            put("dynamic_tools", tools?.dynamicTools ?: JsonArray(emptyList()))
        }.toString()
        // A brand-new Codex thread has no token-usage snapshot until its first response.
        val usageBefore = if (trace != null) readUsage(threadId) ?: NativeUsage(0, 0, 0) else null
        val submission = Json.parseToJsonElement(native.submitTurn(threadId, request)).jsonObject
        if (submission["status"]?.jsonPrimitive?.content != "started") {
            return AgentResponse.Error("Codex thread did not accept the turn")
        }
        val turnId = submission["turn_id"]?.jsonPrimitive?.content
            ?: return AgentResponse.Error("Codex did not return a turn id")
        trace?.record(TraceCategory.AGENT, "codex.turn.started", buildJsonObject {
            put("threadId", threadId); put("turnId", turnId)
            put("toolCount", tools?.dynamicTools?.size ?: 0)
        })

        return try {
            withTimeout(timeoutMillis) { consume(threadId, turnId, mutableSetOf()) }.also { result ->
                if (result is AgentResponse.Error) interruptSafely(threadId)
                trace?.record(TraceCategory.AGENT, "codex.turn.finished", buildJsonObject {
                    put("threadId", threadId); put("turnId", turnId)
                    put("success", result is AgentResponse.Final)
                    put("contentLength", (result as? AgentResponse.Final)?.content?.length ?: 0)
                })
            }
        } catch (_: TimeoutCancellationException) {
            interruptSafely(threadId)
            trace?.record(TraceCategory.AGENT, "codex.turn.timeout", buildJsonObject {
                put("threadId", threadId); put("turnId", turnId)
            })
            AgentResponse.Error("Codex turn timed out")
        } catch (cancelled: CancellationException) {
            interruptSafely(threadId)
            trace?.record(TraceCategory.AGENT, "codex.turn.cancelled", buildJsonObject {
                put("threadId", threadId); put("turnId", turnId)
            })
            throw cancelled
        } catch (_: Exception) {
            interruptSafely(threadId)
            trace?.record(TraceCategory.AGENT, "codex.turn.failed", buildJsonObject {
                put("threadId", threadId); put("turnId", turnId)
            })
            AgentResponse.Error("Codex native turn failed")
        } finally {
            if (trace != null && usageBefore != null) withContext(NonCancellable) {
                readUsage(threadId)?.let { usageAfter ->
                    fun delta(after: Long, before: Long): Int = (after - before).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
                    val usage = TokenUsage(
                        promptTokens = delta(usageAfter.input, usageBefore.input),
                        completionTokens = delta(usageAfter.output, usageBefore.output),
                        totalTokens = delta(usageAfter.total, usageBefore.total),
                    )
                    if (usage.totalTokens > 0) trace.codexUsage(usage)
                }
            }
        }
    }

    private suspend fun readUsage(threadId: String): NativeUsage? = runCatching {
        val body = Json.parseToJsonElement(native.threadUsage(threadId)).jsonObject
        val usage = body["total_token_usage"] as? JsonObject ?: return@runCatching null
        NativeUsage(
            input = usage["input_tokens"]?.jsonPrimitive?.longOrNull ?: 0,
            output = usage["output_tokens"]?.jsonPrimitive?.longOrNull ?: 0,
            total = usage["total_tokens"]?.jsonPrimitive?.longOrNull ?: 0,
        )
    }.getOrNull()

    private suspend fun consume(threadId: String, turnId: String, seenCalls: MutableSet<String>): AgentResponse {
        while (true) {
            val envelope = Json.parseToJsonElement(native.pollEvent(threadId)).jsonObject
            val status = envelope["status"]?.jsonPrimitive?.content
            if (status == "timeout") continue
            val sequence = envelope["sequence"]?.jsonPrimitive?.longOrNull
                ?: return AgentResponse.Error("Codex event has no acknowledgement sequence")
            val outcome = try {
                when (status) {
                    "event" -> {
                        val event = envelope["event"]?.jsonObject
                        val kind = (event?.get("msg") as? JsonObject)?.get("type")?.jsonPrimitive?.content
                        if (kind in TRACED_EVENT_TYPES) trace?.record(TraceCategory.LLM, "codex.event", buildJsonObject {
                            put("threadId", threadId); put("turnId", turnId)
                            put("eventType", kind.orEmpty()); put("sequence", sequence)
                        })
                        processEvent(threadId, turnId, event, seenCalls)
                    }
                    "closed" -> AgentResponse.Error("Codex thread closed before completing the turn")
                    "failed" -> AgentResponse.Error("Codex event stream failed")
                    else -> AgentResponse.Error("Codex returned an unknown event status")
                }
            } finally {
                // Tool execution can be cancelled at the turn deadline. Ack must still reach
                // the native inbox, or the next turn will replay this event as a stale call.
                withContext(NonCancellable) { native.ackEvent(threadId, sequence) }
            }
            if (outcome != null) return outcome
        }
    }

    private suspend fun processEvent(threadId: String, turnId: String, event: JsonObject?, seenCalls: MutableSet<String>): AgentResponse? {
        val message = event?.get("msg") as? JsonObject ?: return AgentResponse.Error("Codex event is malformed")
        return when (message["type"]?.jsonPrimitive?.content) {
            "task_complete" -> {
                if (message["turn_id"]?.jsonPrimitive?.content != turnId) {
                    AgentResponse.Error("Codex completed a different turn")
                } else if (message["error"]?.let { it !is JsonNull } == true) {
                    AgentResponse.Error("Codex turn failed")
                } else {
                    message["last_agent_message"]?.jsonPrimitive?.content?.takeIf(String::isNotBlank)
                        ?.let(AgentResponse::Final)
                        ?: AgentResponse.Error("Codex turn completed without an answer")
                }
            }
            "dynamic_tool_call_request" -> {
                val callId = message["callId"]?.jsonPrimitive?.content
                    ?: return AgentResponse.Error("Codex tool request has no call id")
                val toolName = message["tool"]?.jsonPrimitive?.content.orEmpty()
                val arguments = message["arguments"] as? JsonObject
                val rejection = when {
                    message["turnId"]?.jsonPrimitive?.content != turnId -> "stale_turn"
                    message["namespace"]?.let { it !is JsonNull } == true -> "unexpected_namespace"
                    !seenCalls.add(callId) -> "duplicate_call"
                    arguments == null -> "invalid_arguments"
                    tools?.isAllowed(toolName) != true -> "tool_not_allowed"
                    else -> null
                }
                if (rejection != null) {
                    trace?.record(TraceCategory.TOOL, "codex.tool.rejected", buildJsonObject {
                        put("reason", rejection); put("name", toolName); put("turnId", turnId)
                    })
                    // A request from a completed turn has no valid response target in this turn.
                    if (rejection != "stale_turn") sendToolResponse(threadId, callId, false, "Tool unavailable for this turn")
                    AgentResponse.Error("Codex requested an unauthorized or stale tool")
                } else {
                    val result = checkNotNull(tools).execute(callId, toolName, checkNotNull(arguments))
                    sendToolResponse(threadId, callId, result.success, if (result.success) result.output else result.error)
                    null
                }
            }
            "exec_approval_request", "apply_patch_approval_request" -> {
                val kind = if (message["type"]?.jsonPrimitive?.content == "exec_approval_request") "exec" else "patch"
                val id = message["call_id"]?.jsonPrimitive?.content ?: message["id"]?.jsonPrimitive?.content
                if (id != null) native.reviewDecision(threadId, buildJsonObject {
                    put("kind", kind); put("id", id); put("turn_id", turnId)
                    put("approved", false); put("reason", "Native operation is unavailable for this route")
                }.toString())
                AgentResponse.Error("Codex requested an unavailable native operation")
            }
            "error" -> AgentResponse.Error("Codex engine reported an error")
            else -> null
        }
    }

    private suspend fun sendToolResponse(threadId: String, callId: String, success: Boolean, content: String) {
        val response = buildJsonObject {
            put("success", success)
            put("contentItems", buildJsonArray {
                add(buildJsonObject { put("type", "inputText"); put("text", content.take(MAX_TOOL_RESULT_CHARS)) })
            })
        }
        native.dynamicToolResponse(threadId, callId, response.toString())
    }

    private suspend fun interruptSafely(threadId: String) {
        withContext(NonCancellable) { runCatching { native.interrupt(threadId) } }
    }

    private companion object {
        const val MAX_TOOL_RESULT_CHARS = 65_536
        val TRACED_EVENT_TYPES = setOf("agent_message", "task_complete", "dynamic_tool_call_request", "dynamic_tool_call_response", "error")
    }

    private data class NativeUsage(val input: Long, val output: Long, val total: Long)
}
