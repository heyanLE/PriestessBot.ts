package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.config.CommandConfig
import com.heyanle.priestess.bot.conversation.MessageRole
import com.heyanle.priestess.bot.pipeline.stages.CommandStage
import com.heyanle.priestess.bot.pipeline.stages.RespondStage
import com.heyanle.priestess.bot.pipeline.stages.ResultDecorateStage
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.testConversationCase
import com.heyanle.priestess.bot.testkit.testPipelineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CommandStageTest {
    @Test
    fun `administrator new clears current history without deleting conversation`() = runBlocking {
        val conversations = testConversationCase("command-new")
        val ctx = testPipelineContext(text = "/new", sessionId = "session", senderId = "admin")
        val conversation = conversations.getOrCreate(ctx.event.platform.metadata.name, ctx.event.session.id)
        conversations.storeMessage(conversation.id, MessageRole.USER, "old")
        ctx.permissionGroup = PermissionGroup.ADMIN

        stage(conversations).process(ctx)

        assertTrue(ctx.isCommandHandled)
        assertEquals("已清空当前会话的历史消息。", ctx.directResponse)
        assertTrue(conversations.getMessages(conversation.id).isEmpty())
        assertEquals(conversation.id, conversations.getOrCreate(ctx.event.platform.metadata.name, ctx.event.session.id).id)
    }

    @Test
    fun `operator new is denied without clearing history`() = runBlocking {
        val conversations = testConversationCase("command-denied")
        val ctx = testPipelineContext(text = "/new", sessionId = "session", senderId = "operator")
        val conversation = conversations.getOrCreate(ctx.event.platform.metadata.name, ctx.event.session.id)
        conversations.storeMessage(conversation.id, MessageRole.USER, "old")

        stage(conversations).process(ctx)

        assertTrue(ctx.isCommandHandled)
        assertEquals("denied", ctx.directResponse)
        assertFalse(conversations.getMessages(conversation.id).isEmpty())
    }

    @Test
    fun `unknown command is handled while ordinary text remains available to the agent`() = runBlocking {
        val conversations = testConversationCase("command-dispatch")
        val unknown = testPipelineContext(text = "/missing")
        val ordinary = testPipelineContext(text = "normal conversation")

        stage(conversations).process(unknown)
        stage(conversations).process(ordinary)

        assertEquals("未知指令：missing", unknown.directResponse)
        assertFalse(ordinary.isCommandHandled)
    }

    @Test
    fun `new command bypasses the agent and still sends its direct response`() = runBlocking {
        val conversations = testConversationCase("command-pipeline")
        val platform = FakePlatform()
        val session = FakePlatform.fakeSession(id = "command-session")
        val conversation = conversations.getOrCreate(platform.metadata.name, session.id)
        conversations.storeMessage(conversation.id, MessageRole.USER, "old")
        val pipeline = PipelineController(
            listOf(
                object : Stage {
                    override val name = "SetAdmin"
                    override val order = StageOrder.RESOLVE_PERMISSION
                    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
                        ctx.permissionGroup = PermissionGroup.ADMIN
                        return null
                    }
                },
                stage(conversations),
                ResultDecorateStage(),
                RespondStage(),
            ),
            Unit,
        )

        pipeline.process(MessageEvent(platform, session, MessageChain.text("/new"))).join()

        assertEquals("已清空当前会话的历史消息。", platform.sentMessages.single().second.textContent)
        assertTrue(conversations.getMessages(conversation.id).isEmpty())
        pipeline.stop()
    }

    private fun stage(conversations: com.heyanle.priestess.bot.conversation.ConversationCase) = CommandStage(
        configProvider = { CommandConfig() },
        commandCase = CommandCase(),
        conversationCase = conversations,
        permissionDeniedMessageResolver = PermissionDeniedMessageResolver { "denied" },
    )
}
