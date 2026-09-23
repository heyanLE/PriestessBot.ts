package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageComponent

/** Per-run delivery annotations. Tools cannot supply response text or choose a reply target. */
class ResponseIntent {
    private val mentions = linkedSetOf<String>()
    private val attachments = linkedSetOf<MessageComponent.File>()

    @Synchronized
    fun mention(userId: String) {
        require(userId.matches(Regex("[1-9][0-9]*"))) { "A positive numeric user id is required" }
        mentions.add(userId)
    }

    @Synchronized
    fun attach(file: MessageComponent.File) {
        attachments.add(file)
    }

    @Synchronized
    fun snapshot(): Snapshot = Snapshot(mentions.toList(), attachments.toList())

    @Synchronized
    fun clear() {
        mentions.clear()
        attachments.clear()
    }

    data class Snapshot(
        val mentions: List<String>,
        val attachments: List<MessageComponent.File>,
    )
}
