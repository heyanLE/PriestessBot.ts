package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.testkit.testPipelineContext
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class ResultDecorateStageTest {
    @Test
    fun `final response is passed through as text`() = runBlocking {
        val ctx = testPipelineContext()
        ctx.agentResponse = AgentResponse.Final("hello")

        ResultDecorateStage().process(ctx)

        assertEquals("hello", ctx.decoratedResponse)
    }

    @Test
    fun `max step error is converted to friendly timeout message`() = runBlocking {
        val ctx = testPipelineContext()
        ctx.agentResponse = AgentResponse.Error("Exceeded maximum steps (10)")

        ResultDecorateStage().process(ctx)

        assertEquals("抱歉，处理您的请求超时了，请稍后再试或简化您的问题。", ctx.decoratedResponse)
    }

    @Test
    fun `missing response becomes user visible error`() = runBlocking {
        val ctx = testPipelineContext()

        ResultDecorateStage().process(ctx)

        assertEquals("未收到任何响应。", ctx.decoratedResponse)
    }
}
