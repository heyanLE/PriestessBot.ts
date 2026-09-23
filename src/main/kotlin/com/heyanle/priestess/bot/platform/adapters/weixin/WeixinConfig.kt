package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.platform.AdapterConfig
import com.heyanle.priestess.bot.config.PlatformConfig
import java.net.URI
import java.nio.file.Path

class WeixinConfig(
    val token: String,
    val accountId: String,
    val baseUrl: String = DEFAULT_BASE_URL,
    val stateDirectory: String = ".priestess/weixin/weixin",
    val pollTimeoutMillis: Long = 35_000,
    val pollRetryDelayMillis: Long = 2_000,
    val pollMaxBackoffMillis: Long = 30_000,
    val sendRetries: Int = 3,
    val sendRetryDelayMillis: Long = 1_000,
    val sendChunkDelayMillis: Long = 1_500,
    val rateLimitCooldownMillis: Long = 30_000,
    val maxMessageCodePoints: Int = 2_000,
    val deduplicationTtlMillis: Long = 5 * 60_000,
    val deduplicationMaxEntries: Int = 10_000,
    override val name: String = "weixin",
    override val displayName: String = "WeChat (iLink)",
) : AdapterConfig() {

    fun validate() {
        require(token.isNotBlank()) { "Weixin bot token must be configured" }
        require(accountId.isNotBlank()) { "Weixin config.accountId must be configured" }
        require(stateDirectory.isNotBlank()) { "Weixin config.stateDirectory must not be blank" }
        require(pollTimeoutMillis in 1_000..120_000) {
            "Weixin pollTimeoutMillis must be between 1000 and 120000"
        }
        require(pollRetryDelayMillis in 100..300_000) {
            "Weixin pollRetryDelayMillis must be between 100 and 300000"
        }
        require(pollMaxBackoffMillis in pollRetryDelayMillis.coerceAtLeast(1)..600_000) {
            "Weixin pollMaxBackoffMillis must be positive and at least pollRetryDelayMillis"
        }
        require(sendRetries in 0..10) { "Weixin sendRetries must be between 0 and 10" }
        require(sendRetryDelayMillis in 0..60_000) {
            "Weixin sendRetryDelayMillis must be between 0 and 60000"
        }
        require(sendChunkDelayMillis in 0..60_000) {
            "Weixin sendChunkDelayMillis must be between 0 and 60000"
        }
        require(rateLimitCooldownMillis in 1_000..600_000) {
            "Weixin rateLimitCooldownMillis must be between 1000 and 600000"
        }
        require(maxMessageCodePoints in 1..2_000) {
            "Weixin maxMessageCodePoints must be between 1 and 2000"
        }
        require(deduplicationTtlMillis in 1_000..3_600_000) {
            "Weixin deduplicationTtlMillis must be between 1000 and 3600000"
        }
        require(deduplicationMaxEntries in 1..100_000) {
            "Weixin deduplicationMaxEntries must be between 1 and 100000"
        }

        val uri = runCatching { URI(baseUrl) }.getOrNull()
        require(
            uri != null &&
                uri.scheme.equals("https", ignoreCase = true) &&
                !uri.host.isNullOrBlank() &&
                uri.userInfo == null &&
                (uri.path.isNullOrEmpty() || uri.path == "/") &&
                uri.query == null &&
                uri.fragment == null
        ) { "Weixin baseUrl must be an HTTPS origin without credentials, query, or fragment" }

        runCatching { Path.of(stateDirectory) }.getOrElse {
            throw IllegalArgumentException("Weixin config.stateDirectory is not a valid path", it)
        }
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com"
    }
}

internal fun Map<String, String>.longSetting(name: String, default: Long): Long =
    this[name]?.trim()?.takeIf { it.isNotEmpty() }?.let { value ->
        value.toLongOrNull() ?: throw IllegalArgumentException("Weixin config.$name must be an integer")
    } ?: default

internal fun Map<String, String>.intSetting(name: String, default: Int): Int =
    this[name]?.trim()?.takeIf { it.isNotEmpty() }?.let { value ->
        value.toIntOrNull() ?: throw IllegalArgumentException("Weixin config.$name must be an integer")
    } ?: default

internal fun PlatformConfig.toWeixinConfig(): WeixinConfig {
    val instanceName = name.ifBlank { "weixin" }
    val stateDirectory = config["stateDirectory"]
        ?: ".priestess/weixin/${instanceName.replace(Regex("[^A-Za-z0-9._-]"), "_")}"
    val saved = WeixinCredentialStore(Path.of(stateDirectory)).load()
    return WeixinConfig(
        token = token.takeIf { it.isNotBlank() } ?: saved?.token.orEmpty(),
        accountId = config["accountId"]?.takeIf { it.isNotBlank() } ?: saved?.accountId.orEmpty(),
        baseUrl = baseUrl.takeIf { it.isNotBlank() } ?: saved?.baseUrl ?: WeixinConfig.DEFAULT_BASE_URL,
        stateDirectory = stateDirectory,
        pollTimeoutMillis = config.longSetting("pollTimeoutMillis", 35_000),
        pollRetryDelayMillis = config.longSetting("pollRetryDelayMillis", 2_000),
        pollMaxBackoffMillis = config.longSetting("pollMaxBackoffMillis", 30_000),
        sendRetries = config.intSetting("sendRetries", 3),
        sendRetryDelayMillis = config.longSetting("sendRetryDelayMillis", 1_000),
        sendChunkDelayMillis = config.longSetting("sendChunkDelayMillis", 1_500),
        rateLimitCooldownMillis = config.longSetting("rateLimitCooldownMillis", 30_000),
        maxMessageCodePoints = config.intSetting("maxMessageCodePoints", 2_000),
        deduplicationTtlMillis = config.longSetting("deduplicationTtlMillis", 300_000),
        deduplicationMaxEntries = config.intSetting("deduplicationMaxEntries", 10_000),
        name = instanceName,
        displayName = "WeChat (iLink)",
    )
}
