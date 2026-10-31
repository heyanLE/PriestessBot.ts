package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.coroutines.Job

class FakePlatform : Platform() {
    val sentMessages = mutableListOf<Pair<MessageSession, MessageChain>>()

    override val metadata = PlatformMetadata(
        name = "fake-platform",
        displayName = "Fake Platform",
        supportStreaming = false,
        supportProactiveMessage = true,
    )

    override suspend fun run(): Job = Job()

    override suspend fun terminate() = Unit

    override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? {
        sentMessages += session to chain
        return null
    }

    suspend fun emitText(
        text: String,
        session: MessageSession = fakeSession(),
        messageId: String = "fake-message",
    ) {
        commitEvent(MessageEvent(this, session, MessageChain.text(text), messageId = messageId))
    }

    companion object {
        fun fakeSession(
            id: String = "session-1",
            type: SessionType = SessionType.PRIVATE,
        ): MessageSession = MessageSession(
            id = id,
            type = type,
            platformName = "fake-platform",
        )
    }
}
