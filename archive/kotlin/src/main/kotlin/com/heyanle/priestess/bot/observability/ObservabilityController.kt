package com.heyanle.priestess.bot.observability

import com.heyanle.priestess.bot.core.controller.BaseController

/**
 * 可观测性模块控制器，集中管理运行时指标并承接系统生命周期。
 */
class ObservabilityController(
    private val registry: MetricsRegistry = MetricsRegistry(),
) : BaseController("ObservabilityController") {

    fun recordPipelineMessage(platform: String, status: String, durationMillis: Long) {
        registry.incrementCounter(
            PIPELINE_MESSAGES_TOTAL,
            mapOf("platform" to platform, "status" to status),
        )
        registry.recordDuration(
            PIPELINE_DURATION_MILLISECONDS,
            mapOf("platform" to platform, "status" to status),
            durationMillis,
        )
    }

    fun recordLlmRequest(provider: String, status: String, durationMillis: Long) {
        registry.incrementCounter(
            LLM_REQUESTS_TOTAL,
            mapOf("provider" to provider, "status" to status),
        )
        registry.recordDuration(
            LLM_REQUEST_DURATION_MILLISECONDS,
            mapOf("provider" to provider, "status" to status),
            durationMillis,
        )
    }

    fun recordToolCall(tool: String, status: String) {
        registry.incrementCounter(
            TOOL_CALLS_TOTAL,
            mapOf("tool" to tool, "status" to status),
        )
    }

    fun renderPrometheus(): String = registry.renderPrometheus()

    private companion object {
        const val PIPELINE_MESSAGES_TOTAL = "priestess_pipeline_messages_total"
        const val PIPELINE_DURATION_MILLISECONDS = "priestess_pipeline_duration_milliseconds"
        const val LLM_REQUESTS_TOTAL = "priestess_llm_requests_total"
        const val LLM_REQUEST_DURATION_MILLISECONDS = "priestess_llm_request_duration_milliseconds"
        const val TOOL_CALLS_TOTAL = "priestess_tool_calls_total"
    }
}
