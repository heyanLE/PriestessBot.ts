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
    fun format(event: MessageEvent, permissionGroup: String? = null, agentId: String? = null): String {
        val session = event.session
        val metadata = session.metadata
        val senderId = metadata["senderId"]?.takeIf { it.isNotBlank() }
            ?: metadata["userId"]?.takeIf { it.isNotBlank() }
        val mentions = event.chain.components.filterIsInstance<MessageComponent.At>()
            .map { it.userId }.filter { it.isNotBlank() }.distinct()
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
            put("mentioned_user_ids", buildJsonArray {
                mentions.filter { it != "all" }.forEach { add(JsonPrimitive(it)) }
            })
            put("mentions_everyone", "all" in mentions)
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
        val encodedContext = context.toString().replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        return "<platform_message_context>\n$encodedContext\n</platform_message_context>\n\n$body"
    }
}
