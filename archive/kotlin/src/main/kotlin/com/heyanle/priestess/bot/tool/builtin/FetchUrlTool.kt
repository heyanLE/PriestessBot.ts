package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException
import java.util.Locale
import javax.net.ssl.SSLException

class FetchUrlTool(
    private val fetcher: SafeUrlFetcher = SafeUrlFetcher(),
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "fetch_url",
        description = "Fetch public HTTP(S) page content as simplified text with network-safety limits.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("url", description = "Public HTTP or HTTPS URL to fetch.", required = true),
                ParameterDef("timeout_ms", type = "integer", description = "Request timeout in milliseconds, default 10000."),
                ParameterDef("max_bytes", type = "integer", description = "Maximum response bytes to read, default 524288."),
                ParameterDef("max_chars", type = "integer", description = "Maximum output characters, default 12000."),
                ParameterDef("max_redirects", type = "integer", description = "Maximum redirects to follow, default 3."),
            ),
            required = listOf("url"),
        ),
        riskLevel = ToolRiskLevel.EXTERNAL_READ,
        requiredCapabilities = listOf(ToolCapabilities.NETWORK),
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json {
        encodeDefaults = true
        prettyPrint = true
    }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val url = args["url"]?.trim().orEmpty()
        if (url.isBlank()) {
            return ToolResult.error("Missing required parameter: url", FetchUrlErrorCode.VALIDATION_ERROR.name)
        }

        val request = FetchUrlRequest(
            url = url,
            timeoutMillis = args["timeout_ms"]?.toIntOrNull()?.coerceIn(100, 30_000) ?: 10_000,
            maxBytes = args["max_bytes"]?.toIntOrNull()?.coerceIn(1, 1_048_576) ?: 524_288,
            maxChars = args["max_chars"]?.toIntOrNull()?.coerceIn(1, 50_000) ?: 12_000,
            maxRedirects = args["max_redirects"]?.toIntOrNull()?.coerceIn(0, 10) ?: 3,
        )

        return when (val result = fetcher.fetch(request)) {
            is FetchUrlResult.Success -> ToolResult.success(json.encodeToString(result.response))
            is FetchUrlResult.Failure -> ToolResult.error(result.message, result.code.name)
        }
    }
}

class SafeUrlFetcher(
    private val resolver: HostResolver = JdkHostResolver(),
    private val transport: UrlTransport = JdkUrlTransport(),
) {
    suspend fun fetch(request: FetchUrlRequest): FetchUrlResult {
        return try {
            var currentUrl = request.url
            repeat(request.maxRedirects + 1) { redirectIndex ->
                val validated = validatePublicHttpUrl(currentUrl)
                    ?: return FetchUrlResult.Failure(FetchUrlErrorCode.BLOCKED_TARGET, "URL is not a public HTTP(S) target")
                val transportResult = transport.get(validated, request)
                when (transportResult) {
                    is UrlTransportResult.Redirect -> {
                        if (redirectIndex >= request.maxRedirects) {
                            return FetchUrlResult.Failure(FetchUrlErrorCode.REDIRECT_LIMIT, "Redirect limit exceeded")
                        }
                        currentUrl = validated.resolve(transportResult.location).toString()
                    }
                    is UrlTransportResult.Response -> {
                        if (transportResult.statusCode >= 400) {
                            return FetchUrlResult.Failure(
                                FetchUrlErrorCode.HTTP_FAILURE,
                                "HTTP request failed with status ${transportResult.statusCode}",
                            )
                        }
                        val contentType = transportResult.contentType.substringBefore(";").trim().lowercase()
                        if (!isSupportedContentType(contentType)) {
                            return FetchUrlResult.Failure(
                                FetchUrlErrorCode.UNSUPPORTED_CONTENT,
                                "Unsupported content type: ${transportResult.contentType.ifBlank { "unknown" }}",
                            )
                        }
                        val rawText = transportResult.bytes.toString(Charsets.UTF_8)
                        val text = simplifyText(rawText, contentType)
                        val truncated = text.length > request.maxChars
                        return FetchUrlResult.Success(
                            FetchUrlResponse(
                                statusCode = transportResult.statusCode,
                                finalUrl = validated.toString(),
                                contentType = transportResult.contentType,
                                title = extractTitle(rawText),
                                text = if (truncated) text.take(request.maxChars) else text,
                                truncated = truncated || transportResult.truncated,
                                bytesRead = transportResult.bytes.size,
                            ),
                        )
                    }
                }
            }
            FetchUrlResult.Failure(FetchUrlErrorCode.REDIRECT_LIMIT, "Redirect limit exceeded")
        } catch (e: UnknownHostException) {
            FetchUrlResult.Failure(FetchUrlErrorCode.DNS_FAILURE, "DNS lookup failed: ${e.message}")
        } catch (e: java.net.SocketTimeoutException) {
            FetchUrlResult.Failure(FetchUrlErrorCode.TIMEOUT, "Request timed out")
        } catch (e: SSLException) {
            FetchUrlResult.Failure(FetchUrlErrorCode.TLS_FAILURE, "TLS failure: ${e.message}")
        } catch (e: Exception) {
            FetchUrlResult.Failure(FetchUrlErrorCode.NETWORK_ERROR, "Fetch failed: ${e.message}")
        }
    }

    private fun validatePublicHttpUrl(url: String): URI? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        if (host == "localhost" || host.endsWith(".localhost")) return null
        val addresses = resolver.resolve(host)
        if (addresses.isEmpty() || addresses.any { it.isPrivateOrLocal() }) return null
        return uri
    }

    private fun InetAddress.isPrivateOrLocal(): Boolean {
        val bytes = address.map { it.toInt() and 0xff }
        if (isAnyLocalAddress || isLoopbackAddress || isLinkLocalAddress || isSiteLocalAddress || isMulticastAddress) return true
        if (bytes.size == 4) {
            val first = bytes[0]
            val second = bytes[1]
            if (first == 10) return true
            if (first == 172 && second in 16..31) return true
            if (first == 192 && second == 168) return true
            if (first == 169 && second == 254) return true
            if (first == 127) return true
            if (first == 0) return true
        }
        return false
    }

    private fun isSupportedContentType(contentType: String): Boolean {
        return contentType.startsWith("text/") ||
            contentType in setOf("application/json", "application/xml", "application/xhtml+xml")
    }

    private fun simplifyText(raw: String, contentType: String): String {
        if (!contentType.contains("html")) return raw.trim()
        return raw
            .replace(Regex("(?is)<script.*?</script>"), " ")
            .replace(Regex("(?is)<style.*?</style>"), " ")
            .replace(Regex("(?is)<[^>]+>"), " ")
            .replace(Regex("&nbsp;"), " ")
            .replace(Regex("&amp;"), "&")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun extractTitle(raw: String): String? {
        return Regex("(?is)<title[^>]*>(.*?)</title>")
            .find(raw)
            ?.groupValues
            ?.getOrNull(1)
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
            ?.takeIf { it.isNotBlank() }
    }
}

fun interface HostResolver {
    fun resolve(host: String): List<InetAddress>
}

class JdkHostResolver : HostResolver {
    override fun resolve(host: String): List<InetAddress> = InetAddress.getAllByName(host).toList()
}

fun interface UrlTransport {
    suspend fun get(uri: URI, request: FetchUrlRequest): UrlTransportResult
}

class JdkUrlTransport : UrlTransport {
    override suspend fun get(uri: URI, request: FetchUrlRequest): UrlTransportResult = withContext(Dispatchers.IO) {
        val connection = (uri.toURL().openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = request.timeoutMillis
            readTimeout = request.timeoutMillis
            requestMethod = "GET"
            setRequestProperty("User-Agent", "PriestessBot-FetchUrl/1.0")
            setRequestProperty("Accept", "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1")
        }
        try {
            val status = connection.responseCode
            if (status in 300..399) {
                return@withContext UrlTransportResult.Redirect(connection.getHeaderField("Location").orEmpty())
            }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val bytes = stream?.use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                var total = 0
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    val allowed = (request.maxBytes + 1 - total).coerceAtMost(read)
                    if (allowed > 0) out.write(buffer, 0, allowed)
                    total += read
                    if (total > request.maxBytes) break
                }
                out.toByteArray()
            } ?: ByteArray(0)
            UrlTransportResult.Response(
                statusCode = status,
                contentType = connection.contentType.orEmpty(),
                bytes = bytes.copyOf(bytes.size.coerceAtMost(request.maxBytes)),
                truncated = bytes.size > request.maxBytes,
            )
        } finally {
            connection.disconnect()
        }
    }
}

data class FetchUrlRequest(
    val url: String,
    val timeoutMillis: Int,
    val maxBytes: Int,
    val maxChars: Int,
    val maxRedirects: Int,
)

sealed class FetchUrlResult {
    data class Success(val response: FetchUrlResponse) : FetchUrlResult()
    data class Failure(val code: FetchUrlErrorCode, val message: String) : FetchUrlResult()
}

sealed class UrlTransportResult {
    data class Redirect(val location: String) : UrlTransportResult()
    data class Response(
        val statusCode: Int,
        val contentType: String,
        val bytes: ByteArray,
        val truncated: Boolean = false,
    ) : UrlTransportResult()
}

@Serializable
data class FetchUrlResponse(
    val statusCode: Int,
    val finalUrl: String,
    val contentType: String,
    val title: String? = null,
    val text: String,
    val truncated: Boolean,
    val bytesRead: Int,
)

enum class FetchUrlErrorCode {
    VALIDATION_ERROR,
    BLOCKED_TARGET,
    DNS_FAILURE,
    TLS_FAILURE,
    TIMEOUT,
    UNSUPPORTED_CONTENT,
    HTTP_FAILURE,
    REDIRECT_LIMIT,
    NETWORK_ERROR,
}
