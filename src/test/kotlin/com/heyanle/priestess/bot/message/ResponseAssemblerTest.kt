package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.stages.RespondStage
import com.heyanle.priestess.bot.platform.*
import com.heyanle.priestess.bot.testkit.testAgentContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.flow
import kotlin.test.*

class ResponseAssemblerTest {
    private val assembler = ResponseAssembler()

    @Test
    fun `inbound quotation and deduplicated mentions precede the final body and attachments`() {
        val platform = CapturingPlatform()
        val event = event(platform, listOf(MessageComponent.Reply("42"), MessageComponent.At("999")))
        val intent = ResponseIntent().apply {
            mention("123")
            mention("456")
            mention("123")
            attach(MessageComponent.File("https://example.com/report", "report"))
        }
        assertEquals(
            listOf(
                MessageComponent.Reply("42"), MessageComponent.At("123"), MessageComponent.Text(" "),
                MessageComponent.At("456"), MessageComponent.Text(" "), MessageComponent.Text("Final **answer**"),
                MessageComponent.File("https://example.com/report", "report"),
            ),
            assembler.assemble(event, "Final **answer**", intent).components,
        )
        assertTrue(platform.sent.isEmpty())
    }

    @Test
    fun `regular input is unquoted and each new run has isolated annotations`() {
        val event = event(CapturingPlatform())
        val first = ResponseIntent().apply { mention("123") }
        assertTrue(assembler.assemble(event, "answer", first).components.any { it is MessageComponent.At })
        assertEquals(MessageChain.text("answer"), assembler.assemble(event, "answer", ResponseIntent()))
        assertTrue(assembler.assemble(event, "", first).components.isEmpty())
    }

    @Test
    fun `private session suppresses mentions and unsupported platform suppresses quotation`() {
        val platform = CapturingPlatform(supportReply = false)
        val event = event(platform, listOf(MessageComponent.Reply("42")), SessionType.PRIVATE)
        assertEquals(MessageChain.text("answer"), assembler.assemble(event, "answer", ResponseIntent().apply { mention("123") }))
    }

    @Test
    fun `legacy reply metadata is supported without letting marks choose quotation`() {
        val platform = CapturingPlatform()
        val event = MessageEvent(platform, MessageSession("10", SessionType.PRIVATE, "test", mapOf("replyMessageId" to "43")), MessageChain.text("ask"), "99")
        assertEquals(MessageComponent.Reply("43"), assembler.assemble(event, "answer").components.first())
    }

    @Test
    fun `attachment only final response is delivered but failed run does not deliver marks`(): Unit = runBlocking {
        val platform = CapturingPlatform()
        val context = PipelineContext(event(platform))
        context.agentContext = testAgentContext().apply {
            responseIntent.mention("123")
            responseIntent.attach(MessageComponent.File("https://example.com/file", "file"))
        }
        context.agentResponse = AgentResponse.Error("failed")
        context.decoratedResponse = "Failure message"
        RespondStage().process(context)
        assertEquals(MessageChain.text("Failure message"), platform.sent.single())
        platform.sent.clear()
        context.agentResponse = AgentResponse.Final("")
        context.decoratedResponse = ""
        RespondStage().process(context)
        assertIs<MessageComponent.File>(platform.sent.single().components.last())
    }

    @Test
    fun `cancellation is not swallowed by response transport`(): Unit = runBlocking {
        val platform = CapturingPlatform(cancel = true)
        val context = PipelineContext(event(platform)).apply { decoratedResponse = "answer" }
        assertFailsWith<CancellationException> { RespondStage().process(context) }
    }

    @Test
    fun `attachment only pipeline completion includes generated caption and quotation`() = runBlocking {
        val prepare = object : com.heyanle.priestess.bot.pipeline.Stage {
            override val name = "PrepareAttachment"
            override val order = com.heyanle.priestess.bot.pipeline.StageOrder.PRE_PROCESS
            override suspend fun process(ctx: PipelineContext): kotlinx.coroutines.flow.Flow<Unit>? {
                ctx.agentContext = testAgentContext().apply {
                    responseIntent.attach(MessageComponent.File("https://example.com/file", "file"))
                }
                ctx.agentResponse = AgentResponse.Final("")
                ctx.decoratedResponse = ""
                return null
            }
        }
        val controller = com.heyanle.priestess.bot.pipeline.PipelineController(listOf(prepare, RespondStage()), Unit)
        val platform = CapturingPlatform()
        try {
            val result = com.heyanle.priestess.bot.pipeline.PipelineCase(controller)
                .processAndAwait(event(platform, listOf(MessageComponent.Reply("42"))))
            assertEquals("FINAL", result.status)
            assertEquals("附件如下：", result.content)
            assertEquals(listOf(MessageComponent.Reply("42"), MessageComponent.Text("附件如下："), MessageComponent.File("https://example.com/file", "file")), platform.sent.single().components)
        } finally {
            controller.stop()
        }
    }

    @Test
    fun `failed final delivery reports pipeline error without committing success post processing`() = runBlocking {
        var committed = false
        val prepare = object : com.heyanle.priestess.bot.pipeline.Stage {
            override val name = "PrepareTestResponse"
            override val order = com.heyanle.priestess.bot.pipeline.StageOrder.PRE_PROCESS
            override suspend fun process(ctx: PipelineContext): kotlinx.coroutines.flow.Flow<Unit> {
                ctx.decoratedResponse = "answer"
                return flow { committed = true; emit(Unit) }
            }
        }
        val controller = com.heyanle.priestess.bot.pipeline.PipelineController(listOf(prepare, RespondStage()), Unit)
        try {
            val result = com.heyanle.priestess.bot.pipeline.PipelineCase(controller)
                .processAndAwait(event(CapturingPlatform(fail = true)))
            assertEquals("ERROR", result.status)
            assertEquals("transport failed", result.error)
            assertFalse(committed)
        } finally {
            controller.stop()
        }
    }

    private fun event(platform: Platform, components: List<MessageComponent> = emptyList(), type: SessionType = SessionType.GROUP) =
        MessageEvent(platform, MessageSession("10", type, "test"), MessageChain(components), messageId = "99")

    private class CapturingPlatform(supportReply: Boolean = true, val cancel: Boolean = false, val fail: Boolean = false) : Platform() {
        override val metadata = PlatformMetadata("test", "Test", false, false, supportReply)
        val sent = mutableListOf<MessageChain>()
        override suspend fun run() = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String {
            if (cancel) throw CancellationException("cancelled")
            if (fail) error("transport failed")
            sent.add(chain)
            return "100"
        }
    }
}
