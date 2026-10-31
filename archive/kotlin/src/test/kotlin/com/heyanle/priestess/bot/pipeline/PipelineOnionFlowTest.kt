package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.testkit.testPipelineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class PipelineOnionFlowTest {
    @Test
    fun `stage post-processing resumes after downstream stages run`() = runBlocking {
        val events = mutableListOf<String>()
        val controller = PipelineController(
            testStages = listOf(
                RecordingStage(
                    name = "pre",
                    order = StageOrder.PRE_PROCESS,
                    events = events,
                    postEvent = "pre-post",
                ),
                RecordingStage(
                    name = "process",
                    order = StageOrder.PROCESS,
                    events = events,
                    postEvent = "process-post",
                ),
                RecordingStage(
                    name = "respond",
                    order = StageOrder.RESPOND,
                    events = events,
                ),
            ),
            testOnly = Unit,
        )

        controller.process(testPipelineContext().event).join()

        assertEquals(
            listOf(
                "pre-enter",
                "process-enter",
                "respond-enter",
                "process-post",
                "pre-post",
            ),
            events,
        )
    }

    private class RecordingStage(
        override val name: String,
        override val order: StageOrder,
        private val events: MutableList<String>,
        private val postEvent: String? = null,
    ) : Stage {
        override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
            events += "$name-enter"
            return postEvent?.let { event ->
                flow {
                    events += event
                    emit(Unit)
                }
            }
        }
    }
}
