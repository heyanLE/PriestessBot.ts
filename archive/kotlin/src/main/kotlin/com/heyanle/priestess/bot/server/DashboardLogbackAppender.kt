package com.heyanle.priestess.bot.server

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.AppenderBase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 仪表盘 Logback 追加器，把运行时日志转发到仪表盘日志中心。
 */
class DashboardLogbackAppender : AppenderBase<ILoggingEvent>() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun append(eventObject: ILoggingEvent) {
        val loggerName = eventObject.loggerName ?: ""
        if (loggerName.startsWith("com.heyanle.priestess.bot.server.DashboardLog")) return
        val event = LogEventDto(
            level = eventObject.level?.toString() ?: "INFO",
            message = "${loggerName.substringAfterLast('.')}: ${eventObject.formattedMessage}",
            timestamp = eventObject.timeStamp,
        )
        scope.launch {
            DashboardLogHub.publish(event)
        }
    }
}
