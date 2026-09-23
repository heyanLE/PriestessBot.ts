package com.heyanle.priestess.bot.platform.adapters.weixin

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI

internal data class WeixinQrCode(
    val token: String,
    val scanContent: String,
)

internal interface WeixinQrApi : AutoCloseable {
    suspend fun requestQrCode(botType: String = "3"): WeixinQrCode
    suspend fun queryStatus(baseUrl: String, qrToken: String): JsonObject
}

internal class KtorWeixinQrApi(
    private val client: HttpClient = defaultClient(),
) : WeixinQrApi {
    override suspend fun requestQrCode(botType: String): WeixinQrCode {
        val response = getJson(
            baseUrl = WeixinConfig.DEFAULT_BASE_URL,
            endpoint = GET_QR_ENDPOINT,
            queryName = "bot_type",
            queryValue = botType,
        )
        response.throwIfProtocolError(GET_QR_ENDPOINT)
        val token = response.string("qrcode")?.takeIf { it.isNotBlank() }
            ?: throw WeixinQrException("iLink QR response did not include qrcode")
        val content = response.string("qrcode_img_content")?.takeIf { it.isNotBlank() }
            ?: throw WeixinQrException("iLink QR response did not include qrcode_img_content")
        return WeixinQrCode(token, content)
    }

    override suspend fun queryStatus(baseUrl: String, qrToken: String): JsonObject {
        require(qrToken.isNotBlank()) { "Weixin QR token must not be blank" }
        WeixinQrOriginPolicy.validateStatusBaseUrl(baseUrl)
        return getJson(
            baseUrl = baseUrl,
            endpoint = GET_QR_STATUS_ENDPOINT,
            queryName = "qrcode",
            queryValue = qrToken,
        ).also { it.throwIfProtocolError(GET_QR_STATUS_ENDPOINT) }
    }

    private suspend fun getJson(
        baseUrl: String,
        endpoint: String,
        queryName: String,
        queryValue: String,
    ): JsonObject {
        val response = try {
            client.get("${baseUrl.trimEnd('/')}/$endpoint") {
                timeout { requestTimeoutMillis = QR_REQUEST_TIMEOUT_MILLIS }
                header("iLink-App-Id", "bot")
                header("iLink-App-ClientVersion", ILINK_APP_CLIENT_VERSION)
                parameter(queryName, queryValue)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            throw WeixinQrException("iLink QR request failed for $endpoint", error)
        }
        if (!response.status.isSuccess()) {
            response.bodyAsText()
            throw WeixinQrException("iLink QR request failed for $endpoint with HTTP ${response.status.value}")
        }
        return try {
            response.body()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            throw WeixinQrException("iLink QR response was invalid for $endpoint", error)
        }
    }

    override fun close() {
        client.close()
    }

    private fun JsonObject.throwIfProtocolError(endpoint: String) {
        val ret = intField("ret")
        val errcode = intField("errcode")
        val code = ret?.takeIf { it != 0 } ?: errcode?.takeIf { it != 0 } ?: return
        throw WeixinQrException("iLink QR request failed for $endpoint with code $code")
    }

    private fun JsonObject.intField(key: String): Int? {
        val element = this[key] ?: return null
        return runCatching { element.jsonPrimitive.intOrNull }.getOrNull()
            ?: throw WeixinQrException("iLink QR response field '$key' is not an integer")
    }

    private fun JsonObject.string(key: String): String? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

    companion object {
        private const val GET_QR_ENDPOINT = "ilink/bot/get_bot_qrcode"
        private const val GET_QR_STATUS_ENDPOINT = "ilink/bot/get_qrcode_status"
        private const val ILINK_APP_CLIENT_VERSION = 131_584
        private const val QR_REQUEST_TIMEOUT_MILLIS = 35_000L

        private fun defaultClient(): HttpClient = HttpClient(CIO) {
            install(HttpTimeout)
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
    }
}

internal object WeixinQrOriginPolicy {
    fun redirectBaseUrl(host: String): String {
        val normalized = host.trim().lowercase()
        require(normalized.isNotBlank()) { "Weixin QR redirect host must not be blank" }
        require('/' !in normalized && ':' !in normalized && '@' !in normalized) {
            "Weixin QR redirect host is invalid"
        }
        require(isAllowedHost(normalized)) { "Weixin QR redirect host is not trusted" }
        return "https://$normalized"
    }

    fun validateStatusBaseUrl(value: String): String = validateOrigin(value, requireTrustedHost = true)

    fun validateConfirmedBaseUrl(value: String): String = validateOrigin(value, requireTrustedHost = true)

    private fun validateOrigin(value: String, requireTrustedHost: Boolean): String {
        val uri = runCatching { URI(value.trim()) }.getOrNull()
        require(
            uri != null &&
                uri.scheme.equals("https", ignoreCase = true) &&
                !uri.host.isNullOrBlank() &&
                uri.userInfo == null &&
                uri.port == -1 &&
                (uri.path.isNullOrBlank() || uri.path == "/") &&
                uri.query == null &&
                uri.fragment == null &&
                (!requireTrustedHost || isAllowedHost(uri.host.lowercase()))
        ) { "Weixin QR base URL is not a trusted HTTPS origin" }
        return "https://${uri.host.lowercase()}"
    }

    private fun isAllowedHost(host: String): Boolean =
        host == "weixin.qq.com" || host.endsWith(".weixin.qq.com")
}

internal class WeixinQrException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
