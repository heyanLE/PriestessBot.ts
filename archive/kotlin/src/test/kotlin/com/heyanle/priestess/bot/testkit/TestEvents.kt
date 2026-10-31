package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType

fun testPipelineContext(
    text: String = "hello",
    sessionType: SessionType = SessionType.PRIVATE,
    sessionId: String = "session-1",
    senderId: String = "sender-1",
    selfId: String = "bot-1",
    components: List<MessageComponent> = listOf(MessageComponent.Text(text)),
    platform: FakePlatform = FakePlatform(),
): PipelineContext {
    val session = MessageSession(
        id = sessionId,
        type = sessionType,
        platformName = platform.metadata.name,
        metadata = mapOf(
            "senderId" to senderId,
            "selfId" to selfId,
        ),
    )
    return PipelineContext(
        MessageEvent(
            platform = platform,
            session = session,
            chain = MessageChain(components),
            messageId = "message-1",
        ),
    )
}
