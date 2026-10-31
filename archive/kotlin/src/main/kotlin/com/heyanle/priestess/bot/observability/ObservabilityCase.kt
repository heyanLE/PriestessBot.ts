package com.heyanle.priestess.bot.observability

/**
 * 可观测性模块门面，向其他模块提供指标记录和 Prometheus 渲染能力。
 */
class ObservabilityCase(
    private val controller: ObservabilityController,
) {
    fun recordPipelineMessage(platform: String, status: String, durationMillis: Long) {
        controller.recordPipelineMessage(platform, status, durationMillis)
    }

    fun recordLlmRequest(provider: String, status: String, durationMillis: Long) {
        controller.recordLlmRequest(provider, status, durationMillis)
    }

    fun recordToolCall(tool: String, status: String) {
        controller.recordToolCall(tool, status)
    }

    fun renderPrometheus(): String = controller.renderPrometheus()
    suspend fun stop() {
        controller.stop()
    }

    companion object {
        fun standalone(registry: MetricsRegistry = MetricsRegistry()): ObservabilityCase {
            return ObservabilityCase(ObservabilityController(registry))
        }
    }
}
