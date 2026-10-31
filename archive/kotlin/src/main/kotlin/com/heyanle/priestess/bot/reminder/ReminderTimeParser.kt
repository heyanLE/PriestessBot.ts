package com.heyanle.priestess.bot.reminder

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeParseException
import kotlin.math.max

/**
 * 提醒时间解析器，支持相对时间和标准绝对时间格式。
 */
object ReminderTimeParser {
    private val compactRelative = Regex("""^\s*(?:in\s*)?(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*$""", RegexOption.IGNORE_CASE)

    fun parse(value: String, timezone: ZoneId = ZoneId.systemDefault(), nowMillis: Long = System.currentTimeMillis()): Long {
        val trimmed = value.trim()
        require(trimmed.isNotBlank()) { "due time must not be blank" }
        parseRelative(trimmed, nowMillis)?.let { return it }
        parseAbsolute(trimmed, timezone)?.let { return it }
        throw IllegalArgumentException("Unsupported due time format")
    }

    private fun parseRelative(value: String, nowMillis: Long): Long? {
        val match = compactRelative.matchEntire(value) ?: return null
        val amount = match.groupValues[1].toLong()
        val unit = match.groupValues[2].lowercase()
        val seconds = when {
            unit.startsWith("s") -> amount
            unit.startsWith("m") -> amount * 60
            unit.startsWith("h") -> amount * 60 * 60
            unit.startsWith("d") -> amount * 60 * 60 * 24
            else -> return null
        }
        return nowMillis + max(1L, seconds) * 1000
    }

    private fun parseAbsolute(value: String, timezone: ZoneId): Long? {
        runCatching { return Instant.parse(value).toEpochMilli() }
        runCatching { return ZonedDateTime.parse(value).toInstant().toEpochMilli() }
        runCatching { return LocalDateTime.parse(value).atZone(timezone).toInstant().toEpochMilli() }
        return null
    }
}
