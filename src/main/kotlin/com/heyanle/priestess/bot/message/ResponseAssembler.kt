package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.SessionType

/** Assembles one logical response; adapters handle formatting and native transport. */
class ResponseAssembler {
    fun assemble(event: MessageEvent, content: String, intent: ResponseIntent? = null): MessageChain {
        val annotations = intent?.snapshot()
        if (content.isBlank() && annotations?.attachments.isNullOrEmpty()) return MessageChain()

        return MessageChain(buildList {
            // Continue the input's explicit quotation. The LLM never chooses its target.
            if (event.platform.metadata.supportReply) {
                val replyId = event.chain.components.filterIsInstance<MessageComponent.Reply>()
                    .firstOrNull()?.messageId?.takeIf { it.isNotBlank() }
                    ?: event.session.metadata["replyMessageId"]?.takeIf { it.isNotBlank() }
                replyId?.let { add(MessageComponent.Reply(it)) }
            }
            if (event.session.type == SessionType.GROUP) {
                annotations?.mentions.orEmpty().forEach {
                    add(MessageComponent.At(it))
                    add(MessageComponent.Text(" "))
                }
            }
            add(MessageComponent.Text(content.ifBlank { "附件如下：" }))
            addAll(annotations?.attachments.orEmpty())
        })
    }
}
