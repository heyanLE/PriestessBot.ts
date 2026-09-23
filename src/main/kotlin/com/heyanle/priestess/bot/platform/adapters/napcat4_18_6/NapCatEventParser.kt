package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.SessionType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal object NapCatEventParser {

    fun parseOneBotEvent(platform: Platform, json: JsonObject): MessageEvent? {
        if (json.string("post_type") != "message") return null
        return parseHttpMessage(platform, json)
    }

    fun parseHttpMessage(platform: Platform, json: JsonObject): MessageEvent? {
        val messageType = json.string("message_type") ?: "private"
        val sender = json["sender"] as? JsonObject
        val userId = sender?.string("user_id") ?: json.string("user_id") ?: return null
        val senderName = sender?.string("card")?.takeIf { it.isNotBlank() }
            ?: sender?.string("nickname")?.takeIf { it.isNotBlank() }
        val selfId = json.string("self_id")
        val sessionId = if (messageType == "group") json.string("group_id") ?: return null else userId
        val chain = when (val message = json["message"]) {
            is JsonArray -> parseSegmentArray(message)
            else -> parseMessageChain(json.string("raw_message") ?: (message as? JsonPrimitive)?.contentOrNull.orEmpty())
        }
        return buildMessageEvent(
            platform, messageType, sessionId, userId, selfId, json.string("message_id").orEmpty(), chain, senderName, replySenderId(json),
        )
    }

    private fun replySenderId(json: JsonObject): String? {
        val data = (json["message"] as? JsonArray)?.firstNotNullOfOrNull { element ->
            val segment = element as? JsonObject
            if (segment?.string("type") == "reply") segment["data"] as? JsonObject else null
        }
        val sender = data?.get("sender") as? JsonObject
        val structuredSender = sender?.string("user_id") ?: data?.string("user_id") ?: data?.string("qq")
        if (json["message"] is JsonArray) return structuredSender
        return (json.string("raw_message") ?: json.string("message"))?.let { text ->
                CQ_SEGMENT_REGEX.findAll(text).firstOrNull { it.groupValues[1] == "reply" }
                    ?.let { parseAttributes(it.groupValues[2]) }
                    ?.let { it["user_id"] ?: it["qq"] }
            }
    }

    private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull

    private fun parseSegmentArray(segments: JsonArray): MessageChain = MessageChain(
        segments.mapNotNull { element ->
            val segment = element as? JsonObject ?: return@mapNotNull null
            val data = segment["data"] as? JsonObject ?: return@mapNotNull null
            component(segment.string("type").orEmpty(), data.mapNotNull { (key, value) ->
                (value as? JsonPrimitive)?.contentOrNull?.let { key to it }
            }.toMap())
        },
    )

    private fun component(type: String, attributes: Map<String, String>): MessageComponent? = when (type) {
        "text" -> attributes["text"]?.let(MessageComponent::Text)
        "at" -> attributes["qq"]?.takeIf { it.isNotBlank() }?.let(MessageComponent::At)
        "reply" -> attributes["id"]?.takeIf { it.isNotBlank() }?.let(MessageComponent::Reply)
        "file" -> MessageComponent.File(
            attributes["url"] ?: attributes["file_id"] ?: attributes["file"].orEmpty(),
            attributes["name"] ?: attributes["file"].orEmpty(),
        )
        "image" -> MessageComponent.Image(attributes["url"] ?: attributes["file"].orEmpty())
        else -> null
    }

    private fun buildMessageEvent(
        platform: Platform,
        messageType: String,
        sessionId: String,
        senderId: String,
        selfId: String?,
        messageId: String,
        chain: MessageChain,
        senderName: String?,
        replySenderId: String?,
    ): MessageEvent {
        val sessionType = when (messageType) {
            "private" -> SessionType.PRIVATE
            "group" -> SessionType.GROUP
            else -> SessionType.PRIVATE
        }
        return MessageEvent(
            platform = platform,
            session = MessageSession(
                id = sessionId,
                type = sessionType,
                platformName = platform.metadata.name,
                metadata = buildMap {
                    put("senderId", senderId)
                    put("userId", senderId)
                    senderName?.let { put("senderName", it) }
                    replySenderId?.takeIf { it.isNotBlank() }?.let { put("replySenderId", it) }
                    if (sessionType == SessionType.GROUP) put("groupId", sessionId)
                    if (selfId != null) {
                        put("selfId", selfId)
                    }
                    chain.components.filterIsInstance<MessageComponent.Reply>().firstOrNull()?.let {
                        put("replyMessageId", it.messageId)
                    }
                },
            ),
            chain = chain,
            messageId = messageId,
            sourceId = messageId,
        )
    }

    private fun parseMessageChain(text: String): MessageChain {
        val components = mutableListOf<MessageComponent>()
        var cursor = 0
        for (match in CQ_SEGMENT_REGEX.findAll(text)) {
            val plain = text.substring(cursor, match.range.first)
            if (plain.isNotEmpty()) {
                components.add(MessageComponent.Text(decodeCq(plain)))
            }
            val type = match.groupValues[1]
            val attributes = parseAttributes(match.groupValues[2])
            components.add(component(type, attributes) ?: MessageComponent.Text(match.value))
            cursor = match.range.last + 1
        }
        val tail = text.substring(cursor)
        if (tail.isNotEmpty()) {
            components.add(MessageComponent.Text(decodeCq(tail)))
        }
        return MessageChain(components.ifEmpty { listOf(MessageComponent.Text(decodeCq(text))) })
    }

    private fun parseAttributes(raw: String): Map<String, String> = raw
        .removePrefix(",")
        .split(',')
        .mapNotNull { item ->
            val parts = item.split('=', limit = 2)
            if (parts.size != 2) null else parts[0] to decodeCq(parts[1])
        }
        .toMap()

    private fun decodeCq(value: String): String = value
        .replace("&#44;", ",")
        .replace("&#91;", "[")
        .replace("&#93;", "]")
        .replace("&amp;", "&")

    private val CQ_SEGMENT_REGEX = Regex("""\[CQ:([A-Za-z0-9_]+)((?:,[^\]]*)?)]""")
}
