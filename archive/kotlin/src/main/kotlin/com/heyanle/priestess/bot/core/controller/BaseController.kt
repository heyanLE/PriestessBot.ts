package com.heyanle.priestess.bot.core.controller

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Base class for long-lived module controllers.
 *
 * A controller owns module-local state, resources, and background tasks. The
 * shared scope uses a supervisor job so one child task failure is logged without
 * cancelling sibling work; callers should expose cross-module behavior through
 * Case classes instead of reaching into controller internals.
 */
abstract class BaseController(
    val name: String,
    private val parentScope: CoroutineScope? = null,
) {
    protected val logger = KotlinLogging.logger(name)
    protected val scope: CoroutineScope = parentScope
        ?: CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineName(name))

    private val children = mutableSetOf<Job>()

    protected fun launchTask(taskName: String, block: suspend CoroutineScope.() -> Unit): Job {
        val job = scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logger.error(e) { "Task '$taskName' failed" }
            }
        }
        synchronized(children) {
            children.add(job)
        }
        job.invokeOnCompletion {
            synchronized(children) {
                children.remove(job)
            }
        }
        return job
    }

    open suspend fun stop() {
        scope.cancel()
    }
}
