package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Adds per-message platform facts to model input without exposing arbitrary session metadata. */
object InboundMessageFormatter {
    private const val MAX_QUOTED_CONTENT_CHARS = 4_000

    fun format(event: MessageEvent, permissionGroup: String? = null, agentId: String? = null): String {
        val session = event.session
        val metadata = session.metadata
        val senderId = metadata["senderId"]?.takeIf { it.isNotBlank() }
            ?: metadata["userId"]?.takeIf { it.isNotBlank() }
        val mentions = event.chain.components.filterIsInstance<MessageComponent.At>()
            .map { it.userId }.filter { it.isNotBlank() }.distinct()
        val reply = event.chain.components.filterIsInstance<MessageComponent.Reply>().firstOrNull()
        val context = buildJsonObject {
            put("platform", session.platformName)
            put("session_type", session.type.name.lowercase())
            put("session_id", session.id)
            put("sender_user_id", senderId)
            permissionGroup?.let { put("permission_group", it) }
            agentId?.let { put("agent_id", it) }
            put("sender_name", metadata["senderName"]?.takeIf { it.isNotBlank() })
            put("bot_user_id", metadata["selfId"]?.takeIf { it.isNotBlank() })
            put("group_id", session.id.takeIf { session.type == SessionType.GROUP })
            put("message_id", event.messageId.takeIf { it.isNotBlank() })
            put("reply_message_id", event.chain.components.filterIsInstance<MessageComponent.Reply>()
                .firstOrNull()?.messageId?.takeIf { it.isNotBlank() }
                ?: metadata["replyMessageId"]?.takeIf { it.isNotBlank() })
            put("reply_sender_user_id", reply?.senderId?.takeIf { it.isNotBlank() }
                ?: metadata["replySenderId"]?.takeIf { it.isNotBlank() })
            put("mentioned_user_ids", buildJsonArray {
                mentions.filter { it != "all" }.forEach { add(JsonPrimitive(it)) }
            })
            put("mentions_everyone", "all" in mentions)
        }
        val quoteContent = reply?.chain?.components?.joinToString("") { component ->
            when (component) {
                is MessageComponent.Text -> component.text
                is MessageComponent.At -> " [mention user_id=${component.userId}] "
                is MessageComponent.Image -> " [image] "
                is MessageComponent.File -> " [file: ${component.name.ifBlank { "attachment" }}] "
                is MessageComponent.Reply -> " [nested reply] "
            }
        }?.trim().orEmpty()
        val quote = reply?.let {
            val limited = quoteContent.take(MAX_QUOTED_CONTENT_CHARS)
            buildJsonObject {
                put("message_id", it.messageId)
                put("sender_user_id", it.senderId ?: metadata["replySenderId"])
                put("sender_name", it.senderName)
                put("content", limited.takeIf(String::isNotBlank))
                put("truncated", quoteContent.length > MAX_QUOTED_CONTENT_CHARS)
            }
        }
        val body = event.chain.components.joinToString("") { component ->
            when (component) {
                is MessageComponent.Text -> component.text
                is MessageComponent.At -> when {
                    component.userId.isBlank() -> ""
                    component.userId == "all" -> " [mention everyone] "
                    else -> " [mention user_id=${JsonPrimitive(component.userId)}] "
                }
                else -> ""
            }
        }
        // Keep names and identifiers inside JSON data even when they contain tag-like text.
        fun encodeJson(value: String) = value.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        val quoteBlock = quote?.let {
            "<quoted_message_context>\n${encodeJson(it.toString())}\n</quoted_message_context>\n\n"
        }.orEmpty()
        return "<platform_message_context>\n${encodeJson(context.toString())}\n</platform_message_context>\n\n$quoteBlock$body"
    }
}
