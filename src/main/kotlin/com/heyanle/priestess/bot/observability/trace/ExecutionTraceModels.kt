package com.heyanle.priestess.bot.observability.trace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
enum class ExecutionStatus { RUNNING, SUCCEEDED, FAILED, CANCELLED, SKIPPED }

@Serializable
enum class TraceCategory { IM, AGENT, LLM, TOOL }

data class ExecutionTraceInput(
    val platform: String,
    val sessionId: String,
    val messageId: String = "",
    val senderId: String = "",
    val input: String = "",
    val workspaceId: String = "",
    val agent: String = "",
    val provider: String = "",
    val model: String = "",
)

@Serializable
data class ExecutionSummary(
    val id: String,
    val status: ExecutionStatus,
    val platform: String,
    val sessionId: String,
    val messageId: String,
    val senderId: String,
    val workspaceId: String,
    val agent: String,
    val provider: String,
    val model: String,
    val inputPreview: String,
    val outputPreview: String = "",
    val startedAt: Long,
    val finishedAt: Long? = null,
    val durationMillis: Long? = null,
    val eventCount: Int = 0,
    val promptTokens: Long = 0,
    val completionTokens: Long = 0,
    val totalTokens: Long = 0,
    val error: String? = null,
    val truncated: Boolean = false,
)

@Serializable
data class ExecutionTraceEvent(
    val executionId: String,
    val seq: Int,
    val category: TraceCategory,
    val type: String,
    val step: Int? = null,
    val timestamp: Long,
    val durationMillis: Long? = null,
    val data: JsonObject,
    val truncated: Boolean = false,
)

data class ExecutionTraceFilter(
    val platform: String? = null,
    val provider: String? = null,
    val agent: String? = null,
    val status: ExecutionStatus? = null,
    val sessionId: String? = null,
    val limit: Int = 50,
    val offset: Int = 0,
)

@Serializable
data class ExecutionTracePage(val items: List<ExecutionSummary>, val total: Long, val limit: Int, val offset: Int)

@Serializable
data class ExecutionTraceDetail(
    val execution: ExecutionSummary,
    val events: List<ExecutionTraceEvent>,
    val nextSeq: Int,
    val hasMore: Boolean,
)
