package com.heyanle.priestess.bot.observability

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.LongAdder

/**
 * 指标注册表，负责以线程安全方式累计计数器和耗时摘要并渲染 Prometheus 文本。
 */
class MetricsRegistry {
    private val counters = ConcurrentHashMap<MetricKey, LongAdder>()
    private val durations = ConcurrentHashMap<MetricKey, DurationValue>()

    fun incrementCounter(name: String, labels: Map<String, String> = emptyMap(), amount: Long = 1) {
        if (amount <= 0) return
        counters.computeIfAbsent(MetricKey(name, labels.toSortedMap())) { LongAdder() }.add(amount)
    }

    fun recordDuration(name: String, labels: Map<String, String> = emptyMap(), durationMillis: Long) {
        val value = durations.computeIfAbsent(MetricKey(name, labels.toSortedMap())) { DurationValue() }
        value.count.increment()
        value.sum.add(durationMillis.coerceAtLeast(0))
    }

    fun renderPrometheus(): String {
        val builder = StringBuilder()
        for (definition in definitions) {
            builder.append("# HELP ").append(definition.name).append(' ').append(definition.help).append('\n')
            builder.append("# TYPE ").append(definition.name).append(' ').append(definition.type).append('\n')
            when (definition.kind) {
                MetricKind.COUNTER -> appendCounters(builder, definition.name)
                MetricKind.DURATION -> appendDurations(builder, definition.name)
            }
        }
        return builder.toString()
    }

    private fun appendCounters(builder: StringBuilder, name: String) {
        counters.entries
            .filter { it.key.name == name }
            .sortedWith(compareBy({ it.key.name }, { it.key.labelText() }))
            .forEach { (key, value) ->
                builder.append(key.sampleName()).append(' ').append(value.sum()).append('\n')
            }
    }

    private fun appendDurations(builder: StringBuilder, name: String) {
        durations.entries
            .filter { it.key.name == name }
            .sortedWith(compareBy({ it.key.name }, { it.key.labelText() }))
            .forEach { (key, value) ->
                builder.append(key.sampleName("${name}_count")).append(' ').append(value.count.sum()).append('\n')
                builder.append(key.sampleName("${name}_sum")).append(' ').append(value.sum.sum()).append('\n')
            }
    }

    /**
     * 耗时摘要的累计值，分别记录样本数量和毫秒总和。
     */
    private data class DurationValue(
        val count: LongAdder = LongAdder(),
        val sum: LongAdder = LongAdder(),
    )

    /**
     * 指标样本键，包含指标名和排序后的标签集合。
     */
    private data class MetricKey(
        val name: String,
        val labels: Map<String, String>,
    ) {
        fun sampleName(sampleName: String = name): String {
            if (labels.isEmpty()) return sampleName
            return "$sampleName{${labelText()}}"
        }

        fun labelText(): String {
            return labels.entries.joinToString(",") { (key, value) ->
                "$key=\"${value.escapeLabelValue()}\""
            }
        }
    }

    /**
     * 指标定义，描述 Prometheus 输出中的名称、说明、类型和内部类别。
     */
    private data class MetricDefinition(
        val name: String,
        val help: String,
        val type: String,
        val kind: MetricKind,
    )

    /**
     * 指标内部类别，用于选择计数器或耗时摘要的渲染方式。
     */
    private enum class MetricKind {
        COUNTER,
        DURATION,
    }

    private companion object {
        val definitions = listOf(
            MetricDefinition(
                name = "priestess_pipeline_messages_total",
                help = "Total platform messages processed by the pipeline.",
                type = "counter",
                kind = MetricKind.COUNTER,
            ),
            MetricDefinition(
                name = "priestess_pipeline_duration_milliseconds",
                help = "Pipeline processing duration in milliseconds.",
                type = "summary",
                kind = MetricKind.DURATION,
            ),
            MetricDefinition(
                name = "priestess_llm_requests_total",
                help = "Total LLM requests issued by the runtime.",
                type = "counter",
                kind = MetricKind.COUNTER,
            ),
            MetricDefinition(
                name = "priestess_llm_request_duration_milliseconds",
                help = "LLM request duration in milliseconds.",
                type = "summary",
                kind = MetricKind.DURATION,
            ),
            MetricDefinition(
                name = "priestess_tool_calls_total",
                help = "Total tool calls attempted by agents.",
                type = "counter",
                kind = MetricKind.COUNTER,
            ),
        )

        private fun String.escapeLabelValue(): String {
            return replace("\\", "\\\\").replace("\n", "\\n").replace("\"", "\\\"")
        }
    }
}
