package com.heyanle.priestess.bot.platform

import com.heyanle.priestess.bot.pipeline.PipelineCase
import io.github.oshai.kotlinlogging.KotlinLogging

/**
 * 平台模块门面，负责接收平台消息并向其他模块暴露平台运行状态。
 */
class PlatformCase(
    private val controllerProvider: () -> PlatformController = {
        error("PlatformController provider is not configured")
    },
    private val pipelineCaseProvider: () -> PipelineCase,
) {
    private val logger = KotlinLogging.logger {}

    fun start() {
        controllerProvider()
    }

    fun runningPlatformNames(): Set<String> {
        return controllerProvider().getRunning().map { it.metadata.name }.toSet()
    }

    fun runningPlatformCount(): Int = runningPlatformNames().size

    suspend fun restart(name: String): Boolean = controllerProvider().restart(name)

    suspend fun stop() {
        controllerProvider().stop()
    }

    suspend fun handleIncomingMessage(event: MessageEvent) {
        logger.info {
            "[PIPELINE-020] PlatformCase received message platform=${event.platform.metadata.name}, " +
                "session=${event.session.id}, type=${event.session.type}, text='${event.chain.textContent.take(120)}'"
        }
        pipelineCaseProvider().process(event)
        logger.info {
            "[PIPELINE-029] PlatformCase dispatched message platform=${event.platform.metadata.name}, " +
                "session=${event.session.id}"
        }
    }
}
