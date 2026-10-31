package com.heyanle.priestess.bot

import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.PipelineController
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoordinatedShutdownTest {
    @Test
    fun `pipeline stop waits for accepted message job to finish`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val completed = CompletableDeferred<Unit>()
        val controller = PipelineController(
            testStages = listOf(BlockingStage(started, release, completed)),
            testOnly = Unit,
            drainTimeoutMillis = 1_000,
        )

        val job = controller.process(messageEvent("accepted"))
        withTimeout(1_000) { started.await() }
        val stopJob = launch { controller.stop() }

        delay(50)
        assertFalse(stopJob.isCompleted)
        release.complete(Unit)

        withTimeout(1_000) { completed.await() }
        withTimeout(1_000) { stopJob.join() }
        assertTrue(job.isCompleted)
    }

    @Test
    fun `pipeline case drains before stopping controller`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val completed = CompletableDeferred<Unit>()
        val controller = PipelineController(
            testStages = listOf(BlockingStage(started, release, completed)),
            testOnly = Unit,
            drainTimeoutMillis = 1_000,
        )
        val pipelineCase = PipelineCase(controller)

        val job = pipelineCase.process(messageEvent("accepted"))
        withTimeout(1_000) { started.await() }
        val stopJob = launch {
            pipelineCase.drain(1_000)
            pipelineCase.stop()
        }

        delay(50)
        assertFalse(stopJob.isCompleted)
        release.complete(Unit)

        withTimeout(1_000) { completed.await() }
        withTimeout(1_000) { stopJob.join() }
        assertTrue(job.isCompleted)
    }

    @Test
    fun `pipeline rejects new work after shutdown starts`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val completed = CompletableDeferred<Unit>()
        val controller = PipelineController(
            testStages = listOf(BlockingStage(started, release, completed)),
            testOnly = Unit,
            drainTimeoutMillis = 1_000,
        )

        controller.process(messageEvent("accepted"))
        withTimeout(1_000) { started.await() }
        val stopJob = launch { controller.stop() }
        delay(50)

        val rejected = controller.process(messageEvent("rejected"))

        assertTrue(rejected.isCompleted)
        assertTrue(rejected.isCancelled)
        release.complete(Unit)
        withTimeout(1_000) { stopJob.join() }
    }

    @Test
    fun `pipeline drain timeout proceeds to cancellation`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val controller = PipelineController(
            testStages = listOf(NeverEndingStage(started)),
            testOnly = Unit,
            drainTimeoutMillis = 25,
        )

        val job = controller.process(messageEvent("hang"))
        withTimeout(1_000) { started.await() }
        controller.stop()

        assertTrue(job.isCancelled)
    }

    @Test
    fun `runtime shutdown runs stop steps in deterministic order`() = runBlocking {
        val order = mutableListOf<String>()
        val runtime = PriestessRuntime(
            listOf(
                "platforms" to { order += "platforms" },
                "pipeline" to { order += "pipeline" },
                "server" to { order += "server" },
                "plugins" to { order += "plugins" },
                "providers" to { order += "providers" },
                "tools" to { order += "tools" },
                "skills" to { order += "skills" },
                "workspace" to { order += "workspace" },
                "observability" to { order += "observability" },
                "database" to { order += "database" },
                "config" to { order += "config" },
            ),
        )

        runtime.stop()

        assertEquals(
            listOf(
                "platforms",
                "pipeline",
                "server",
                "plugins",
                "providers",
                "tools",
                "skills",
                "workspace",
                "observability",
                "database",
                "config",
            ),
            order,
        )
    }

    private class BlockingStage(
        private val started: CompletableDeferred<Unit>,
        private val release: CompletableDeferred<Unit>,
        private val completed: CompletableDeferred<Unit>,
    ) : Stage {
        override val name = "Blocking"
        override val order = StageOrder.PROCESS

        override suspend fun process(ctx: PipelineContext): kotlinx.coroutines.flow.Flow<Unit>? {
            started.complete(Unit)
            release.await()
            completed.complete(Unit)
            return null
        }
    }

    private class NeverEndingStage(
        private val started: CompletableDeferred<Unit>,
    ) : Stage {
        override val name = "NeverEnding"
        override val order = StageOrder.PROCESS

        override suspend fun process(ctx: PipelineContext): kotlinx.coroutines.flow.Flow<Unit>? {
            started.complete(Unit)
            Job().join()
            return null
        }
    }

    private class TestPlatform : Platform() {
        override val metadata = PlatformMetadata(
            name = "shutdown-platform",
            displayName = "Shutdown Platform",
            supportStreaming = false,
            supportProactiveMessage = false,
        )

        override suspend fun run(): Job = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = null
    }

    private fun messageEvent(text: String): MessageEvent {
        return MessageEvent(
            platform = TestPlatform(),
            session = MessageSession(
                id = "shutdown-session",
                type = SessionType.PRIVATE,
                platformName = "shutdown-platform",
            ),
            chain = MessageChain.text(text),
        )
    }
}
