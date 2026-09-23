package com.heyanle.priestess.bot.platform.adapters.weixin

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.timeout
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.coroutines.CancellationException
import java.security.SecureRandom
import java.util.Base64

internal interface WeixinApi : AutoCloseable {
    suspend fun getUpdates(syncBuf: String, timeoutMillis: Long): JsonObject

    suspend fun sendText(
        toUserId: String,
        text: String,
        contextToken: String?,
        clientId: String,
    ): JsonObject
}

internal class WeixinTransportException(
    message: String,
    val retryable: Boolean,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)

internal class KtorWeixinApi(
    private val config: WeixinConfig,
    private val pollClient: HttpClient = defaultClient(),
    private val sendClient: HttpClient = defaultClient(),
    private val uinProvider: () -> String = ::randomWeChatUin,
) : WeixinApi {

    override suspend fun getUpdates(syncBuf: String, timeoutMillis: Long): JsonObject {
        return try {
            post(
                client = pollClient,
                endpoint = GET_UPDATES_ENDPOINT,
                payload = buildJsonObject { put("get_updates_buf", syncBuf) },
                timeoutMillis = timeoutMillis + REQUEST_TIMEOUT_GRACE_MILLIS,
            )
        } catch (_: HttpRequestTimeoutException) {
            buildJsonObject {
                put("ret", 0)
                put("get_updates_buf", syncBuf)
                put("msgs", buildJsonArray {})
            }
        }
    }

    override suspend fun sendText(
        toUserId: String,
        text: String,
        contextToken: String?,
        clientId: String,
    ): JsonObject {
        require(text.isNotBlank()) { "Weixin message text must not be blank" }
        val message = buildJsonObject {
            put("from_user_id", "")
            put("to_user_id", toUserId)
            put("client_id", clientId)
            put("message_type", 2)
            put("message_state", 2)
            contextToken?.takeIf { it.isNotBlank() }?.let { put("context_token", it) }
            put("item_list", buildJsonArray {
                add(buildJsonObject {
                    put("type", 1)
                    putJsonObject("text_item") { put("text", text) }
                })
            })
        }
        return try {
            post(
                client = sendClient,
                endpoint = SEND_MESSAGE_ENDPOINT,
                payload = buildJsonObject { put("msg", message) },
                timeoutMillis = SEND_TIMEOUT_MILLIS,
            )
        } catch (error: HttpRequestTimeoutException) {
            throw WeixinTransportException(
                message = "iLink request timed out for $SEND_MESSAGE_ENDPOINT",
                retryable = true,
            )
        }
    }

    private suspend fun post(
        client: HttpClient,
        endpoint: String,
        payload: JsonObject,
        timeoutMillis: Long,
    ): JsonObject {
        val response = try {
            client.post("${config.baseUrl.trimEnd('/')}/$endpoint") {
                timeout { requestTimeoutMillis = timeoutMillis }
                contentType(ContentType.Application.Json)
                header(HttpHeaders.Authorization, "Bearer ${config.token}")
                header("AuthorizationType", "ilink_bot_token")
                header("X-WECHAT-UIN", uinProvider())
                header("iLink-App-Id", "bot")
                header("iLink-App-ClientVersion", ILINK_APP_CLIENT_VERSION)
                setBody(buildJsonObject {
                    payload.forEach { (key, value) -> put(key, value) }
                    putJsonObject("base_info") { put("channel_version", CHANNEL_VERSION) }
                })
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: HttpRequestTimeoutException) {
            throw error
        } catch (error: Exception) {
            throw WeixinTransportException(
                message = "iLink request failed for $endpoint",
                retryable = true,
                cause = error,
            )
        }

        if (!response.status.isSuccess()) {
            response.bodyAsText()
            throw WeixinTransportException(
                message = "iLink request failed for $endpoint with HTTP ${response.status.value}",
                retryable = response.status.value == 429 || response.status.value >= 500,
            )
        }
        return try {
            response.body()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw WeixinTransportException(
                message = "iLink returned invalid JSON for $endpoint",
                retryable = true,
            )
        }
    }

    override fun close() {
        pollClient.close()
        if (sendClient !== pollClient) sendClient.close()
    }

    companion object {
        private const val GET_UPDATES_ENDPOINT = "ilink/bot/getupdates"
        private const val SEND_MESSAGE_ENDPOINT = "ilink/bot/sendmessage"
        private const val CHANNEL_VERSION = "2.2.0"
        private const val ILINK_APP_CLIENT_VERSION = 131_584
        private const val SEND_TIMEOUT_MILLIS = 15_000L
        private const val REQUEST_TIMEOUT_GRACE_MILLIS = 5_000L
        private val secureRandom = SecureRandom()

        private fun defaultClient(): HttpClient = HttpClient(CIO) {
            install(HttpTimeout)
            install(ContentNegotiation) {
                json(Json { ignoreUnknownKeys = true })
            }
        }

        private fun randomWeChatUin(): String {
            val unsigned = secureRandom.nextInt().toUInt().toString()
            return Base64.getEncoder().encodeToString(unsigned.toByteArray(Charsets.UTF_8))
        }
    }
}
