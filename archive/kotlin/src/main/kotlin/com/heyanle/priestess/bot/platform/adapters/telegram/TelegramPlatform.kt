package com.heyanle.priestess.bot.platform.adapters.telegram

import com.heyanle.priestess.bot.platform.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.engine.ProxyBuilder
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.HttpResponse
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import io.github.oshai.kotlinlogging.KotlinLogging
import java.nio.channels.UnresolvedAddressException

class TelegramConfig(
    val token: String = "",
    override val name: String = "telegram",
    override val displayName: String = "Telegram",
    val proxyUrl: String? = null,
) : AdapterConfig()

class TelegramPlatform(
    private val config: TelegramConfig = TelegramConfig(),
    private val clientFactory: () -> HttpClient = { createDefaultClient(config.proxyUrl) },
) : Platform() {

    private val logger = KotlinLogging.logger {}

    override val metadata = PlatformMetadata(
        name = config.name,
        displayName = config.displayName,
        supportStreaming = true,
        supportProactiveMessage = true,
    )

    private var offset: Long = 0
    @Volatile private var botIdentity: BotIdentity? = null
    private val baseUrl: String get() = "https://api.telegram.org/bot${config.token}"
    @Volatile private var _client: HttpClient? = null
    private val client: HttpClient get() = _client ?: clientFactory().also { _client = it }

    override suspend fun run(): Job {
        require(config.token.isNotBlank()) { "Telegram bot token must be configured" }
        return CoroutineScope(Dispatchers.IO).launch {
            var consecutiveFailures = 0
            while (isActive) {
                try {
                    ensureBotIdentity()
                    val updates = fetchUpdates()
                    if (consecutiveFailures > 0) {
                        logger.info { "Telegram polling recovered platform=${safeErrorText(metadata.name)} previousFailures=$consecutiveFailures" }
                        consecutiveFailures = 0
                    }
                    for (update in updates) {
                        val event = parseUpdate(update) ?: continue
                        commitEvent(event)
                    }
                } catch (e: CancellationException) {
                    break
                } catch (e: Exception) {
                    consecutiveFailures++
                    logger.warn { "Telegram polling failed platform=${safeErrorText(metadata.name)} consecutiveFailures=$consecutiveFailures ${sanitizedFailure(e)}" }
                    delay(5000)
                }
            }
        }
    }

    override suspend fun terminate() {
        _client?.close()
        _client = null
    }

    override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? {
        val rawText = chain.textContent
        require(rawText.isNotBlank()) { "Message text must not be blank" }
        var firstMessageId: String? = null
        for (chunk in TelegramMessageChunker.split(rawText, RICH_MESSAGE_MAX_CODE_POINTS)) {
            val body = callTelegram("sendRichMessage", buildJsonObject {
                put("chat_id", session.id)
                put("rich_message", buildJsonObject { put("markdown", chunk) })
            })

            if (body.isSuccessful()) {
                firstMessageId = firstMessageId ?: body.messageId()
                continue
            }

            logApiFailure("sendRichMessage", body)
            firstMessageId = firstMessageId ?: sendPlainText(session, chunk)
        }
        return firstMessageId
    }

    /**
     * Rich Messages 仅在较新的 Telegram Bot API 中可用。不可用或内容被拒绝时，
     * 以普通文本作为可靠降级，避免旧的 HTML 正则转换再次损坏消息内容。
     */
    private suspend fun sendPlainText(session: MessageSession, text: String): String? {
        var firstMessageId: String? = null
        for (chunk in TelegramMessageChunker.split(text, BASIC_MESSAGE_MAX_CODE_POINTS)) {
            val body = callTelegram("sendMessage", buildJsonObject {
                put("chat_id", session.id)
                put("text", chunk)
            })
            if (!body.isSuccessful()) {
                logApiFailure("sendMessage", body)
                throw TelegramApiException("sendMessage", body.errorDescription(), body.errorCode())
            }
            firstMessageId = firstMessageId ?: body.messageId()
        }
        return firstMessageId
    }

    private suspend fun callTelegram(method: String, request: JsonObject): JsonObject =
        postTelegram(method, request).body()

    private fun JsonObject.isSuccessful(): Boolean =
        this["ok"]?.jsonPrimitive?.booleanOrNull == true

    private fun JsonObject.messageId(): String? =
        this["result"]?.jsonObject?.get("message_id")?.jsonPrimitive?.content

    private fun JsonObject.errorDescription(): String =
        safeErrorText(string("description") ?: "Telegram API returned an unsuccessful response")

    private fun JsonObject.errorCode(): String =
        (this["error_code"] as? JsonPrimitive)?.intOrNull?.toString() ?: "unknown"

    private fun logApiFailure(method: String, body: JsonObject) {
        val errorCode = body.errorCode()
        logger.warn { "Telegram API call failed method=$method errorCode=$errorCode description=${body.errorDescription()}" }
    }

    /** Exception messages can contain the token-bearing request URL; never log the throwable. */
    internal fun sanitizedFailure(error: Exception): String =
        "${error::class.simpleName ?: "Exception"}: ${safeErrorText(error.message.orEmpty())}"

    private fun safeErrorText(value: String): String {
        var safe = value
        if (config.token.isNotBlank()) safe = safe.replace(config.token, "[REDACTED]")
        config.proxyUrl?.takeIf { it.isNotBlank() }?.let { safe = safe.replace(it, "[PROXY URL OMITTED]") }
        safe = REQUEST_URL.replace(safe, "[URL OMITTED]")
        safe = BOT_TOKEN.replace(safe, "[REDACTED]")
        return safe.replace('\r', ' ').replace('\n', ' ').take(400)
    }

    private suspend fun postTelegram(method: String, body: JsonObject): HttpResponse {
        var lastFailure: UnresolvedAddressException? = null
        repeat(3) { attempt ->
            try {
                return client.post("$baseUrl/$method") {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            } catch (error: UnresolvedAddressException) {
                lastFailure = error
                if (attempt < 2) delay((attempt + 1) * 1_000L)
            }
        }
        throw requireNotNull(lastFailure)
    }

    internal suspend fun fetchUpdates(): List<JsonObject> {
        val response = client.get("$baseUrl/getUpdates") {
            parameter("offset", offset + 1)
            parameter("timeout", 30)
        }
        val body = response.body<JsonObject>()
        if (!response.status.isSuccess() || !body.isSuccessful()) {
            throw TelegramApiException("getUpdates", body.errorDescription(), body.errorCode(), response.status.value)
        }
        val result = body["result"] as? JsonArray ?: error("Telegram getUpdates returned no result array")
        val updates = result.map { it as? JsonObject ?: error("Telegram getUpdates returned a malformed update") }
        val latestOffset = updates.mapNotNull { it.string("update_id")?.toLongOrNull() }.maxOrNull()
        if (latestOffset != null && latestOffset > offset) offset = latestOffset
        return updates
    }

    internal suspend fun ensureBotIdentity() {
        if (botIdentity != null) return
        val response = client.get("$baseUrl/getMe")
        val body = response.body<JsonObject>()
        if (!response.status.isSuccess() || !body.isSuccessful()) {
            throw TelegramApiException("getMe", body.errorDescription(), body.errorCode(), response.status.value)
        }
        val user = body["result"] as? JsonObject ?: error("Telegram getMe returned no bot identity")
        val id = user.string("id")?.takeIf { it.isNotBlank() } ?: error("Telegram getMe returned no bot id")
        botIdentity = BotIdentity(id, user.string("username")?.takeIf { it.isNotBlank() })
        logger.info { "Telegram getMe succeeded platform=${safeErrorText(metadata.name)} proxyConfigured=${!config.proxyUrl.isNullOrBlank()}" }
    }

    internal fun parseUpdate(update: JsonObject): MessageEvent? {
        val message = (update["message"] ?: update["channel_post"]) as? JsonObject ?: return null
        val chat = message["chat"] as? JsonObject ?: return null
        val chatId = chat.string("id") ?: return null
        val sender = message["from"] as? JsonObject
        val senderId = sender?.string("id")
        val identity = botIdentity
        val chatType = when (chat.string("type")) {
            "private" -> SessionType.PRIVATE
            "group", "supergroup" -> SessionType.GROUP
            "channel" -> SessionType.CHANNEL
            else -> SessionType.PRIVATE
        }
        val hasText = message.string("text") != null
        val text = message.string(if (hasText) "text" else "caption").orEmpty()
        val reply = message["reply_to_message"] as? JsonObject
        val replyId = reply?.string("message_id")
        val replySenderId = (reply?.get("from") as? JsonObject)?.string("id")
        val components = buildList {
            replyId?.let { add(MessageComponent.Reply(it)) }
            addAll(parseMentions(text, message[if (hasText) "entities" else "caption_entities"] as? JsonArray, identity))
        }
        val messageId = message.string("message_id").orEmpty()
        return MessageEvent(
            platform = this,
            session = MessageSession(
                id = chatId,
                type = chatType,
                platformName = metadata.name,
                metadata = buildMap {
                    chat.forEach { (key, value) -> (value as? JsonPrimitive)?.contentOrNull?.let { put(key, it) } }
                    senderId?.let { put("senderId", it); put("userId", it) }
                    sender?.let {
                        val displayName = listOfNotNull(it.string("first_name"), it.string("last_name"))
                            .filter(String::isNotBlank).joinToString(" ").ifBlank { it.string("username").orEmpty() }
                        if (displayName.isNotBlank()) put("senderName", displayName)
                    }
                    identity?.let { put("selfId", it.id) }
                    if (chatType == SessionType.GROUP) put("groupId", chatId)
                    replyId?.let { put("replyMessageId", it) }
                    replySenderId?.let { put("replySenderId", it) }
                },
            ),
            chain = MessageChain(components),
            messageId = messageId,
            sourceId = messageId,
        )
    }

    private fun parseMentions(text: String, entities: JsonArray?, identity: BotIdentity?): List<MessageComponent> = buildList {
        var cursor = 0
        entities.orEmpty().mapNotNull { it as? JsonObject }
            .sortedBy { it.string("offset")?.toIntOrNull() ?: Int.MAX_VALUE }
            .forEach { entity ->
                val offset = entity.string("offset")?.toIntOrNull() ?: return@forEach
                val length = entity.string("length")?.toIntOrNull() ?: return@forEach
                if (offset < cursor || length <= 0 || offset > text.length || length > text.length - offset) return@forEach
                val end = offset + length
                if (!text.isCodePointBoundary(offset) || !text.isCodePointBoundary(end)) return@forEach
                val target = when (entity.string("type")) {
                    "text_mention" -> (entity["user"] as? JsonObject)?.string("id")
                    "mention" -> {
                        val value = text.substring(offset, end)
                        if (!value.matches(Regex("@[A-Za-z0-9_]+"))) return@forEach
                        val username = value.drop(1)
                        if (identity?.username?.equals(username, ignoreCase = true) == true) identity.id
                        else "username:${username.lowercase()}"
                    }
                    else -> null
                }?.takeIf { it.isNotBlank() } ?: return@forEach
                if (cursor < offset) add(MessageComponent.Text(text.substring(cursor, offset)))
                add(MessageComponent.At(target))
                cursor = end
            }
        if (cursor < text.length) add(MessageComponent.Text(text.substring(cursor)))
    }

    private fun String.isCodePointBoundary(index: Int): Boolean = index <= 0 || index >= length ||
        !(this[index - 1].isHighSurrogate() && this[index].isLowSurrogate())

    private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
    private data class BotIdentity(val id: String, val username: String?)

    private class TelegramApiException(method: String, description: String, errorCode: String, httpStatus: Int? = null) :
        IllegalStateException("Telegram API call failed method=$method errorCode=$errorCode httpStatus=${httpStatus ?: "unknown"} description=$description")

    private companion object {
        const val RICH_MESSAGE_MAX_CODE_POINTS = 32_768
        const val BASIC_MESSAGE_MAX_CODE_POINTS = 4_096
        const val HTTP_REQUEST_TIMEOUT_MILLIS = 60_000L
        const val HTTP_CONNECT_TIMEOUT_MILLIS = 10_000L
        private val REQUEST_URL = Regex("(?i)https?://[^\\s<>\"']+")
        private val BOT_TOKEN = Regex("\\b[0-9]{5,}:[A-Za-z0-9_-]{10,}\\b")

        fun createDefaultClient(proxyUrl: String?): HttpClient = HttpClient(CIO) {
            engine {
                requestTimeout = HTTP_REQUEST_TIMEOUT_MILLIS
                endpoint {
                    connectTimeout = HTTP_CONNECT_TIMEOUT_MILLIS
                    socketTimeout = HTTP_REQUEST_TIMEOUT_MILLIS
                }
                proxyUrl?.trim()?.takeIf { it.isNotEmpty() }?.let { value ->
                    val proxyAddress = Url(value)
                    require(proxyAddress.protocol == URLProtocol.HTTP) { "Telegram proxyUrl must use an HTTP proxy" }
                    proxy = ProxyBuilder.http(proxyAddress)
                }
            }
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
            install(HttpTimeout) {
                requestTimeoutMillis = HTTP_REQUEST_TIMEOUT_MILLIS
                socketTimeoutMillis = HTTP_REQUEST_TIMEOUT_MILLIS
                connectTimeoutMillis = HTTP_CONNECT_TIMEOUT_MILLIS
            }
        }
    }
}
