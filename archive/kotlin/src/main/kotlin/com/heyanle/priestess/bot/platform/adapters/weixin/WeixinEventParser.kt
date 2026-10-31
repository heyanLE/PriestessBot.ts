package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

internal data class ParsedWeixinEvent(
    val event: MessageEvent,
    val contextPeerId: String,
    val contextToken: String?,
)

internal object WeixinEventParser {

    fun parse(
        platform: Platform,
        accountId: String,
        message: JsonObject,
        fallbackTimestamp: Long,
    ): ParsedWeixinEvent? {
        val senderId = message.string("from_user_id")?.trim().orEmpty()
        if (senderId.isEmpty() || senderId == accountId) return null

        val items = (message["item_list"] as? JsonArray).orEmpty()
        val text = items
            .mapNotNull { itemElement ->
                val item = itemElement as? JsonObject ?: return@mapNotNull null
                if (item.int("type") != TEXT_ITEM_TYPE) return@mapNotNull null
                (item["text_item"] as? JsonObject)?.string("text")?.takeIf { it.isNotBlank() }
            }
            .joinToString("\n")
        if (text.isBlank()) return null

        // ref_msg is protocol data. Never infer a reply or mention from the text contents.
        val quoted = items.firstNotNullOfOrNull { element ->
            val ref = (element as? JsonObject)?.get("ref_msg") as? JsonObject
            ref?.get("message_item") as? JsonObject
        }
        val replyId = quoted?.string("message_id")?.takeIf(String::isNotBlank)
            ?: quoted?.string("msg_id")?.takeIf(String::isNotBlank)
        val replySender = quoted?.string("from_user_id")?.takeIf(String::isNotBlank)

        val roomId = message.string("room_id")?.takeIf { it.isNotBlank() }
            ?: message.string("chat_room_id")?.takeIf { it.isNotBlank() }
        val sessionId = roomId ?: senderId
        val sessionType = if (roomId == null) SessionType.PRIVATE else SessionType.GROUP
        val messageId = message.string("message_id").orEmpty()
        val timestamp = message.long("create_time_ms")
            ?: message.long("timestamp_ms")
            ?: message.long("create_time")?.times(1_000)
            ?: fallbackTimestamp

        return ParsedWeixinEvent(
            event = MessageEvent(
                platform = platform,
                session = MessageSession(
                    id = sessionId,
                    type = sessionType,
                    platformName = platform.metadata.name,
                    metadata = buildMap {
                        put("senderId", senderId)
                        put("userId", senderId)
                        put("selfId", accountId)
                        roomId?.let { put("groupId", it) }
                        if (quoted != null) put("hasReply", "true")
                        replyId?.let { put("replyMessageId", it) }
                        replySender?.let { put("replySenderId", it) }
                    },
                ),
                chain = MessageChain(buildList {
                    replyId?.let { add(MessageComponent.Reply(it)) }
                    add(MessageComponent.Text(text))
                }),
                messageId = messageId,
                timestamp = timestamp,
                sourceId = messageId,
            ),
            contextPeerId = sessionId,
            contextToken = message.string("context_token")?.takeIf { it.isNotBlank() },
        )
    }

    private fun JsonObject.string(key: String): String? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

    private fun JsonObject.long(key: String): Long? =
        runCatching { this[key]?.jsonPrimitive?.longOrNull }.getOrNull()

    private fun JsonObject.int(key: String): Int? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull?.toIntOrNull() }.getOrNull()

    private const val TEXT_ITEM_TYPE = 1
}
