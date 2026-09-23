package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.PlatformSetupRequiredException
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.nio.file.Path
import java.util.UUID
import kotlin.math.min

class WeixinPlatform private constructor(
    private val config: WeixinConfig,
    private val apiFactory: () -> WeixinApi,
    private val stateStore: WeixinStateStore,
    private val sleeper: suspend (Long) -> Unit,
    private val clockMillis: () -> Long,
) : Platform() {

    constructor(config: WeixinConfig = WeixinConfig(token = "", accountId = "")) : this(
        config = config,
        apiFactory = { KtorWeixinApi(config) },
        stateStore = WeixinStateStore(Path.of(config.stateDirectory)),
        sleeper = { millis -> delay(millis) },
        clockMillis = ::monotonicMillis,
    )

    internal constructor(
        config: WeixinConfig,
        api: WeixinApi,
        stateStore: WeixinStateStore,
        sleeper: suspend (Long) -> Unit = { millis -> delay(millis) },
        clockMillis: () -> Long = ::monotonicMillis,
    ) : this(config, { api }, stateStore, sleeper, clockMillis)

    private val logger = KotlinLogging.logger {}
    private val lifecycleLock = Any()
    private val sendMutex = Mutex()
    private val processedIds = ProcessedMessageIds(
        ttlMillis = config.deduplicationTtlMillis,
        maxEntries = config.deduplicationMaxEntries,
        clockMillis = clockMillis,
    )

    @Volatile
    private var activeApi: WeixinApi? = null
    private var pollingJob: Job? = null
    @Volatile
    private var rateLimitUntilMillis: Long = 0
    @Volatile
    private var currentPollTimeoutMillis: Long = config.pollTimeoutMillis

    override val metadata = PlatformMetadata(
        name = config.name,
        displayName = config.displayName,
        supportStreaming = false,
        supportProactiveMessage = false,
    )

    override suspend fun run(): Job {
        if (config.token.isBlank() || config.accountId.isBlank()) {
            throw PlatformSetupRequiredException(
                "open Dashboard > Platforms and use Weixin QR login, or configure token and accountId explicitly",
            )
        }
        config.validate()
        stateStore.initialize()
        val job = synchronized(lifecycleLock) {
            check(pollingJob == null && activeApi == null) { "Weixin platform '${metadata.name}' is already running" }
            val api = apiFactory()
            CoroutineScope(Dispatchers.IO).launch(start = CoroutineStart.LAZY) {
                try {
                    pollLoop(api)
                } finally {
                    releaseAfterPoll(api, coroutineContext[Job])
                }
            }.also {
                activeApi = api
                pollingJob = it
            }
        }
        job.start()
        return job
    }

    private suspend fun pollLoop(api: WeixinApi) {
        var consecutiveFailures = 0
        while (kotlin.coroutines.coroutineContext.isActive) {
            try {
                pollOnce(api)
                consecutiveFailures = 0
            } catch (error: CancellationException) {
                throw error
            } catch (error: WeixinSessionExpiredException) {
                logger.error { "Weixin session expired for platform '${metadata.name}'; refresh credentials before restarting" }
                break
            } catch (error: WeixinTransportException) {
                if (!error.retryable) {
                    logger.error { "Weixin polling stopped for platform '${metadata.name}': ${error.message}" }
                    break
                }
                consecutiveFailures += 1
                val waitMillis = pollBackoffMillis(consecutiveFailures)
                logger.warn(error) {
                    "Weixin poll failed for platform '${metadata.name}'; retrying in ${waitMillis}ms"
                }
                sleeper(waitMillis)
            } catch (error: Exception) {
                consecutiveFailures += 1
                val waitMillis = pollBackoffMillis(consecutiveFailures)
                logger.warn(error) {
                    "Weixin poll failed for platform '${metadata.name}'; retrying in ${waitMillis}ms"
                }
                sleeper(waitMillis)
            }
        }
    }

    internal suspend fun pollOnce(api: WeixinApi = requireActiveApi()) {
        val response = api.getUpdates(stateStore.cursor(), currentPollTimeoutMillis)
        validatePollResponse(response)
        response.long("longpolling_timeout_ms")
            ?.takeIf { it in 1_000..120_000 }
            ?.let { currentPollTimeoutMillis = it }

        val messages = response["msgs"] as? JsonArray ?: JsonArray(emptyList())
        for (element in messages) {
            val message = element as? JsonObject ?: continue
            val messageId = message.string("message_id").orEmpty()
            if (messageId.isNotBlank() && processedIds.contains(messageId)) continue

            val parsed = WeixinEventParser.parse(
                platform = this,
                accountId = config.accountId,
                message = message,
                fallbackTimestamp = System.currentTimeMillis(),
            )
            if (parsed == null) {
                if (messageId.isNotBlank()) processedIds.mark(messageId)
                continue
            }

            parsed.contextToken?.let {
                stateStore.updateContextToken(parsed.contextPeerId, it)
            }
            commitEvent(parsed.event)
            if (messageId.isNotBlank()) processedIds.mark(messageId)
        }

        response.string("get_updates_buf")
            ?.takeIf { it.isNotBlank() }
            ?.let(stateStore::updateCursor)
    }

    override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? {
        val text = chain.textContent
        require(text.isNotBlank()) { "Message text must not be blank" }
        require(session.id.isNotBlank()) { "Weixin target session id must not be blank" }
        val chunks = WeixinMessageChunker.split(text, config.maxMessageCodePoints)
        return sendMutex.withLock {
            checkCooldown()
            val api = requireActiveApi()
            var firstClientId: String? = null
            chunks.forEachIndexed { index, chunk ->
                val clientId = "priestess-weixin-${UUID.randomUUID().toString().replace("-", "")}"
                firstClientId = firstClientId ?: clientId
                sendChunk(
                    api = api,
                    peerId = session.id,
                    chunk = chunk,
                    clientId = clientId,
                )
                if (index < chunks.lastIndex && config.sendChunkDelayMillis > 0) {
                    sleeper(config.sendChunkDelayMillis)
                }
            }
            firstClientId
        }
    }

    private suspend fun sendChunk(
        api: WeixinApi,
        peerId: String,
        chunk: String,
        clientId: String,
    ) {
        var contextToken = stateStore.contextToken(peerId)
        var staleFallbackUsed = false
        var transportRetries = 0

        while (true) {
            checkCooldown()
            val response = try {
                api.sendText(peerId, chunk, contextToken, clientId)
            } catch (error: WeixinTransportException) {
                if (!error.retryable || transportRetries >= config.sendRetries) throw error
                transportRetries += 1
                sleeper(config.sendRetryDelayMillis * transportRetries)
                continue
            }

            val error = response.errorCode()
            if (error == null) return
            val message = response.string("errmsg").orEmpty()
            val staleContext = error == SESSION_EXPIRED_ERROR ||
                (error == RATE_LIMIT_ERROR && message.equals("unknown error", ignoreCase = true))
            if (staleContext && contextToken != null && !staleFallbackUsed) {
                staleFallbackUsed = true
                contextToken = null
                stateStore.removeContextToken(peerId)
                continue
            }
            if (error == RATE_LIMIT_ERROR && !staleContext) {
                rateLimitUntilMillis = clockMillis() + config.rateLimitCooldownMillis
                throw WeixinRateLimitException("iLink sendmessage is rate limited")
            }
            throw WeixinApiException("iLink sendmessage failed with code $error")
        }
    }

    private fun validatePollResponse(response: JsonObject) {
        val error = response.errorCode() ?: return
        val message = response.string("errmsg").orEmpty()
        if (error == SESSION_EXPIRED_ERROR ||
            (error == RATE_LIMIT_ERROR && message.equals("unknown error", ignoreCase = true))
        ) {
            throw WeixinSessionExpiredException()
        }
        throw WeixinApiException("iLink getupdates failed with code $error")
    }

    private fun pollBackoffMillis(consecutiveFailures: Int): Long {
        val multiplier = consecutiveFailures.coerceAtMost(100).toLong()
        return min(config.pollMaxBackoffMillis, config.pollRetryDelayMillis * multiplier)
    }

    private fun checkCooldown() {
        val remaining = rateLimitUntilMillis - clockMillis()
        if (remaining > 0) {
            throw WeixinRateLimitException("iLink sendmessage cooldown is active for ${remaining}ms")
        }
    }

    private fun requireActiveApi(): WeixinApi =
        activeApi ?: error("Weixin platform '${metadata.name}' is not running")

    override suspend fun terminate() {
        val (job, api) = synchronized(lifecycleLock) {
            val current = pollingJob to activeApi
            pollingJob = null
            activeApi = null
            current
        }
        job?.cancelAndJoin()
        api?.close()
    }

    private fun releaseAfterPoll(api: WeixinApi, job: Job?) {
        val close = synchronized(lifecycleLock) {
            if (activeApi === api && pollingJob === job) {
                activeApi = null
                pollingJob = null
                true
            } else {
                false
            }
        }
        if (close) api.close()
    }

    private fun JsonObject.string(key: String): String? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

    private fun JsonObject.long(key: String): Long? =
        runCatching { this[key]?.jsonPrimitive?.longOrNull }.getOrNull()

    private fun JsonObject.errorCode(): Int? {
        val ret = intResponseField("ret")
        val errcode = intResponseField("errcode")
        return when {
            ret != null && ret != 0 -> ret
            errcode != null && errcode != 0 -> errcode
            else -> null
        }
    }

    private fun JsonObject.intResponseField(key: String): Int? {
        val element = this[key] ?: return null
        return runCatching { element.jsonPrimitive.intOrNull }.getOrNull()
            ?: throw WeixinApiException("iLink response field '$key' is not an integer")
    }

    private companion object {
        const val SESSION_EXPIRED_ERROR = -14
        const val RATE_LIMIT_ERROR = -2
    }
}

internal class WeixinApiException(message: String) : IllegalStateException(message)
internal class WeixinRateLimitException(message: String) : IllegalStateException(message)
internal class WeixinSessionExpiredException : IllegalStateException("Weixin session expired")

internal class ProcessedMessageIds(
    private val ttlMillis: Long,
    private val maxEntries: Int,
    private val clockMillis: () -> Long,
) {
    private val lock = Any()
    private val entries = LinkedHashMap<String, Long>()

    fun contains(messageId: String): Boolean = synchronized(lock) {
        purgeExpired()
        entries.containsKey(messageId)
    }

    fun mark(messageId: String) = synchronized(lock) {
        purgeExpired()
        entries.remove(messageId)
        while (entries.size >= maxEntries) {
            val first = entries.entries.firstOrNull()?.key ?: break
            entries.remove(first)
        }
        entries[messageId] = clockMillis()
    }

    private fun purgeExpired() {
        val cutoff = clockMillis() - ttlMillis
        val iterator = entries.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().value < cutoff) iterator.remove()
        }
    }
}

private fun monotonicMillis(): Long = System.nanoTime() / 1_000_000
