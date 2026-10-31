package com.heyanle.priestess.bot.platform.adapters.napcat4_18_6

import com.heyanle.priestess.bot.platform.AdapterConfig
import com.heyanle.priestess.bot.message.MarkdownMessageFormatter
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.SessionType
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.readText
import io.ktor.websocket.send
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.json.intOrNull

class NapCatConfig(
    val host: String = "127.0.0.1",
    val port: Int = 3000,
    val wsPort: Int = 3001,
    val token: String = "",
    val useWs: Boolean = true,
    override val name: String = "napcat4_18_6",
    override val displayName: String = "NapCat v4.18.6 (QQ)",
) : AdapterConfig()

class NapCatPlatform(
    private val config: NapCatConfig = NapCatConfig(),
    httpClient: HttpClient? = null,
    private val actionTimeoutMillis: Long = 15_000,
) : Platform() {

    private val logger = KotlinLogging.logger {}
    private val messageFormatter = MarkdownMessageFormatter()

    override val metadata = PlatformMetadata(
        name = config.name,
        displayName = config.displayName,
        supportStreaming = false,
        supportProactiveMessage = false,
        supportReply = true,
    )

    override fun platformTools() = NapCatPlatformTools.all()

    val baseUrl: String get() = "http://${config.host}:${config.port}"
    val wsUrl: String get() = "ws://${config.host}:${config.wsPort}"

    private var _client: HttpClient? = httpClient
    @Volatile
    private var activeWebSocketSession: WebSocketSession? = null
    private val pendingActions = ConcurrentHashMap<String, CompletableDeferred<JsonObject>>()

    private val client: HttpClient get() = _client ?: HttpClient(CIO) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        install(WebSockets)
    }.also { _client = it }

    override suspend fun run(): Job {
        logger.info {
            "[PIPELINE-001] Starting NapCat platform name=${metadata.name}, ws=${config.useWs}, " +
                "host=${config.host}, port=${config.port}, wsPort=${config.wsPort}, tokenSet=${config.token.isNotBlank()}"
        }
        return if (config.useWs) {
            CoroutineScope(Dispatchers.IO).launch { wsListen(wsUrl) }
        } else {
            CoroutineScope(Dispatchers.IO).launch { httpPoll() }
        }
    }

    override suspend fun terminate() {
        logger.info { "[PIPELINE-009] Terminating NapCat platform name=${metadata.name}" }
        activeWebSocketSession = null
        failPendingActions("NapCat platform terminated")
        _client?.close()
        _client = null
    }

    override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? {
        require(session.type != SessionType.CHANNEL) { "NapCat channel sessions are unsupported" }
        val targetId = session.id.toLongOrNull()?.takeIf { it > 0 }
            ?: error("NapCat session id must be a positive number")
        // Format each source text once: generated images and native components bypass Markdown parsing.
        val components = chain.components.flatMap { component ->
            if (component is MessageComponent.Text && component.text.isNotBlank()) {
                messageFormatter.format(component.text).components
            } else listOf(component)
        }
        val pending = mutableListOf<JsonElement>()
        var messageId: String? = null
        suspend fun flush() {
            val hasContent = pending.any { element ->
                val item = element.jsonObject
                when (item["type"]?.jsonPrimitive?.content) {
                    "text" -> item["data"]?.jsonObject?.get("text")?.jsonPrimitive?.content?.isNotBlank() == true
                    "image", "at" -> true
                    else -> false
                }
            }
            if (hasContent) {
                val sentId = sendNativeMessage(session, JsonArray(pending.toList()))
                if (messageId == null) messageId = sentId
                pending.clear()
            }
        }
        for (component in components) {
            when (component) {
                is MessageComponent.Text -> if (component.text.isNotEmpty()) pending.add(segment("text", "text", component.text))
                is MessageComponent.At -> pending.add(segment("at", "qq", component.userId))
                is MessageComponent.Image -> pending.add(segment("image", "file", component.url))
                is MessageComponent.Reply -> pending.add(segment("reply", "id", component.messageId))
                is MessageComponent.File -> {
                    flush()
                    val isGroup = session.type == SessionType.GROUP
                    callAction(if (isGroup) "upload_group_file" else "upload_private_file", buildJsonObject {
                        put(if (isGroup) "group_id" else "user_id", targetId)
                        put("file", component.url)
                        put("name", component.name.ifBlank { "attachment" })
                        if (isGroup) component.folderId?.let { put("folder", it) }
                    })
                }
            }
        }
        flush()
        return messageId
    }

    private fun segment(type: String, key: String, value: String): JsonObject = buildJsonObject {
        put("type", type)
        putJsonObject("data") { put(key, value) }
    }

    // WebSocket (OneBot 11 forward WS)
    private suspend fun wsListen(url: String) {
        while (currentCoroutineContext().isActive) {
            try {
                logger.info { "[PIPELINE-002] NapCat connecting websocket url=$url" }
                client.webSocket(
                    request = {
                        url(url)
                        addAuthHeader()
                    },
                ) {
                    logger.info { "[PIPELINE-003] NapCat websocket connected url=$url" }
                    activeWebSocketSession = this
                    try {
                        for (frame in incoming) {
                            when (frame) {
                                is Frame.Text -> {
                                    val text = frame.readText()
                                    logger.info { "[PIPELINE-010] NapCat received frame length=${text.length}" }
                                    val json = Json.parseToJsonElement(text).jsonObject
                                    val echo = (json["echo"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                                    if (echo != null && pendingActions.remove(echo)?.complete(json) == true) continue
                                    val event = NapCatEventParser.parseOneBotEvent(this@NapCatPlatform, json) ?: continue
                                    logger.info {
                                        "[PIPELINE-011] NapCat parsed message session=${event.session.id}, " +
                                            "type=${event.session.type}, source=${event.sourceId}, text='${event.chain.textContent.take(120)}'"
                                    }
                                    // The reader must remain free to receive action acknowledgements
                                    // while the message handler assembles and sends its response.
                                    launch {
                                        try {
                                            commitEvent(resolveReplyContext(event))
                                            logger.info {
                                                "[PIPELINE-019] NapCat committed message session=${event.session.id}, source=${event.sourceId}"
                                            }
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            logger.error(e) { "NapCat message handler failed source=${event.sourceId}" }
                                        }
                                    }
                                }
                                else -> Unit
                            }
                        }
                    } finally {
                        if (activeWebSocketSession === this) {
                            activeWebSocketSession = null
                            failPendingActions("NapCat websocket disconnected before action acknowledgement")
                        }
                    }
                }
            } catch (e: CancellationException) {
                break
            } catch (e: Exception) {
                logger.warn(e) { "[PIPELINE-902] NapCat websocket failed, retrying in 3000ms" }
                delay(3000)
            }
        }
    }

    /** Resolve the quoted author for routing and original content for the model in one `get_msg`. */
    internal suspend fun resolveReplyContext(event: MessageEvent): MessageEvent {
        val replyMessageId = event.session.metadata["replyMessageId"] ?: return event
        val replyId = replyMessageId.toLongOrNull() ?: return event
        val replyIndex = event.chain.components.indexOfFirst { it is MessageComponent.Reply && it.messageId == replyMessageId }
        if (replyIndex < 0) return event
        val originalReply = event.chain.components[replyIndex] as MessageComponent.Reply
        if (originalReply.chain != null) return event
        val message = try {
            callAction("get_msg", buildJsonObject { put("message_id", replyId) }) as? JsonObject
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.warn { "Could not resolve NapCat quoted message messageId=$replyId: ${e.message}" }
            null
        }
        if (message == null) return event
        val sender = message["sender"] as? JsonObject
        val senderId = (sender?.get("user_id") ?: message["user_id"])
            ?.let { it as? kotlinx.serialization.json.JsonPrimitive }?.content
            ?.takeIf { it.isNotBlank() }
            ?: event.session.metadata["replySenderId"]
        val senderName = listOf("card", "nickname").firstNotNullOfOrNull { field ->
            (sender?.get(field) as? kotlinx.serialization.json.JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
        }
        val referencedChain = NapCatEventParser.parseReferencedMessage(message)
        val components = event.chain.components.toMutableList()
        components[replyIndex] = originalReply.copy(
            senderId = senderId,
            senderName = senderName,
            chain = referencedChain,
        )
        return MessageEvent(
            platform = event.platform,
            session = event.session.copy(metadata = if (senderId == null) event.session.metadata else event.session.metadata + ("replySenderId" to senderId)),
            chain = MessageChain(components),
            messageId = event.messageId,
            timestamp = event.timestamp,
            sourceId = event.sourceId,
        )
    }

    // HTTP polling (fallback)
    private suspend fun httpPoll() {
        while (currentCoroutineContext().isActive) {
            try {
                val messages = fetchMessages()
                for (msg in messages) {
                    val event = NapCatEventParser.parseHttpMessage(this@NapCatPlatform, msg) ?: continue
                    commitEvent(resolveReplyContext(event))
                }
            } catch (e: CancellationException) {
                break
            } catch (e: Exception) {
                delay(3000)
            }
        }
    }

    private suspend fun fetchMessages(): List<JsonObject> {
        try {
            val response = client.get("$baseUrl/get_msg") {
                addAuthHeader()
            }
            val body = response.body<JsonObject>()
            return body["data"]?.jsonArray?.mapNotNull { it.jsonObject }
                ?: emptyList()
        } catch (e: Exception) {
            return emptyList()
        }
    }

    private fun HttpRequestBuilder.addAuthHeader() {
        if (config.token.isNotBlank()) {
            header(HttpHeaders.Authorization, "Bearer ${config.token}")
        }
    }

    internal suspend fun callAction(action: String, params: JsonObject): JsonElement {
        sendViaWebSocket(action, params)?.let { return it }
        val response = client.post("$baseUrl/$action") {
            addAuthHeader()
            header(HttpHeaders.ContentType, "application/json")
            setBody(params)
        }
        if (!response.status.isSuccess()) {
            error("NapCat action '$action' returned HTTP ${response.status.value}")
        }
        return actionData(action, response.body<JsonObject>())
    }

    private fun actionData(action: String, body: JsonObject): JsonElement {
        val status = body["status"]?.jsonPrimitive?.content
        val retcode = body["retcode"]?.jsonPrimitive?.intOrNull
        if ((status != null && status != "ok") || (retcode != null && retcode != 0)) {
            val message = body["message"]?.jsonPrimitive?.content
                ?: body["wording"]?.jsonPrimitive?.content
                ?: "OneBot action failed"
            error("NapCat action '$action' failed: $message (retcode=${retcode ?: "unknown"})")
        }
        return body["data"] ?: JsonNull
    }

    internal suspend fun sendNativeMessage(session: MessageSession, message: JsonArray): String? {
        val targetKey = when (session.type) {
            SessionType.PRIVATE -> "user_id"
            SessionType.GROUP -> "group_id"
            SessionType.CHANNEL -> error("NapCat channel sessions are unsupported")
        }
        val action = if (session.type == SessionType.GROUP) "send_group_msg" else "send_private_msg"
        val targetId = session.id.toLongOrNull()?.takeIf { it > 0 }
            ?: error("NapCat session id must be a positive number")
        val params = buildJsonObject {
            put(targetKey, targetId)
            put("message", message)
        }
        val data = callAction(action, params)
        return (data as? JsonObject)?.get("message_id")?.jsonPrimitive?.content
    }

    private suspend fun sendViaWebSocket(action: String, params: JsonObject): JsonElement? {
        val ws = activeWebSocketSession ?: return null
        val echo = "priestess-send-${UUID.randomUUID()}"
        val response = CompletableDeferred<JsonObject>()
        pendingActions[echo] = response
        try {
            val payload = buildJsonObject {
                put("action", action)
                put("params", params)
                put("echo", echo)
            }
            logger.info { "[PIPELINE-303] NapCat sending websocket action=$action, echo=$echo" }
            // Once dispatched, a missing acknowledgement must fail without retrying over HTTP:
            // the server may already have delivered the message.
            val body = withTimeoutOrNull(actionTimeoutMillis) {
                ws.send(payload.toString())
                response.await()
            } ?: error("NapCat action '$action' acknowledgement timed out; delivery state is unknown")
            return actionData(action, body)
        } finally {
            pendingActions.remove(echo)
            response.cancel()
        }
    }

    private fun failPendingActions(message: String) {
        pendingActions.keys.forEach { echo ->
            pendingActions.remove(echo)?.completeExceptionally(IllegalStateException(message))
        }
    }
}
