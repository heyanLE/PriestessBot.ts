package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.platform.MessageEvent
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.Job
import kotlinx.coroutines.CompletableDeferred

/**
 * 流水线模块门面，向平台模块提供消息投递能力并承接流水线生命周期。
 */
class PipelineCase(
    private val controller: PipelineController,
) {
    private val logger = KotlinLogging.logger {}

    /**
     * 投递平台消息到流水线执行。
     */
    fun process(event: MessageEvent): Job {
        logger.info {
            "[PIPELINE-030] PipelineCase accepted message platform=${event.platform.metadata.name}, " +
                "session=${event.session.id}, messageId=${event.messageId}"
        }
        return controller.process(event)
    }

    /** Executes through the identical pinned stage chain used by platform traffic. */
    suspend fun processAndAwait(event: MessageEvent): PipelineExecutionResult {
        val result = CompletableDeferred<PipelineExecutionResult>()
        val job = controller.process(event) { completion -> result.complete(completion) }
        job.invokeOnCompletion { cause ->
            if (cause != null && !result.isCompleted) {
                result.complete(PipelineExecutionResult("ERROR", "", error = cause.message))
            }
        }
        return result.await()
    }

    /**
     * 按指定超时等待在途消息完成。
     */
    suspend fun drain(timeoutMillis: Long = DEFAULT_DRAIN_TIMEOUT_MILLIS): Boolean {
        return controller.drain(timeoutMillis)
    }

    /**
     * 停止流水线模块并取消剩余任务。
     */
    suspend fun stop() {
        controller.stop()
    }

    companion object {
        const val DEFAULT_DRAIN_TIMEOUT_MILLIS = PipelineController.DEFAULT_DRAIN_TIMEOUT_MILLIS
    }
}
