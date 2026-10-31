package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.observability.MetricsRegistry
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TestClock(
    initialMillis: Long = 1_700_000_000_000L,
) {
    var nowMillis: Long = initialMillis
        private set

    fun now(): Long = nowMillis

    fun advanceBy(millis: Long): Long {
        nowMillis += millis
        return nowMillis
    }
}

fun MetricsRegistry.rendered(): String = renderPrometheus()

fun MetricsRegistry.assertSample(
    sample: String,
    value: Long,
) {
    assertTrue(
        rendered().contains("$sample $value"),
        "Expected metric sample '$sample $value' in:\n${rendered()}",
    )
}

fun MetricsRegistry.assertDoesNotLeak(vararg forbidden: String) {
    val rendered = rendered()
    forbidden.filter { it.isNotBlank() }.forEach { value ->
        assertFalse(rendered.contains(value), "Metric output leaked '$value':\n$rendered")
    }
}
