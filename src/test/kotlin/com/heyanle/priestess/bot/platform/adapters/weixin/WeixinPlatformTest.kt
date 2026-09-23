package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.config.PlatformConfig
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.PlatformRegistry
import com.heyanle.priestess.bot.platform.PlatformSetupRequiredException
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.platform.registerBuiltinPlatforms
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.util.IdentityHashMap
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WeixinPlatformTest {
    private val stores = IdentityHashMap<WeixinPlatform, WeixinStateStore>()

    @Test
    fun `registry creates named weixin instance and disabled config stays absent`() {
        registerBuiltinPlatforms()
        val enabled = PlatformConfig(
            name = "weixin-main",
            type = "weixin",
            token = "token",
            baseUrl = "https://ilink.example.test",
            config = mapOf("accountId" to "account"),
        )

        val platform = PlatformRegistry.createFromConfig(enabled)

        assertIs<WeixinPlatform>(platform)
        assertEquals("weixin-main", platform.metadata.name)
        assertFalse(platform.metadata.supportStreaming)
        assertFalse(platform.metadata.supportProactiveMessage)
        assertEquals(null, PlatformRegistry.createFromConfig(enabled.copy(enabled = false)))
    }

    @Test
    fun `run validates credentials before creating background work`() = runBlocking {
        val api = FakeWeixinApi()
        val platform = testPlatform(api, testConfig(token = ""))

        assertFailsWith<PlatformSetupRequiredException> { platform.run() }
        assertEquals(0, api.getUpdatesCalls)
        assertEquals(0, api.closeCount)
    }

    @Test
    fun `poll maps direct and group sender metadata and commits cursor after delivery`() = runBlocking {
        val api = FakeWeixinApi(
            updateResponses = ArrayDeque(listOf(updatesResponse("cursor-2", directMessage(), groupMessage()))),
        )
        val platform = testPlatform(api)
        val events = mutableListOf<MessageEvent>()
        platform.setMessageHandler { events += it }

        platform.pollOnce(api)

        assertEquals(2, events.size)
        assertEquals(SessionType.PRIVATE, events[0].session.type)
        assertEquals("peer-a", events[0].session.id)
        assertEquals("peer-a", events[0].session.metadata["senderId"])
        assertEquals(SessionType.GROUP, events[1].session.type)
        assertEquals("room-a", events[1].session.id)
        assertEquals("peer-b", events[1].session.metadata["senderId"])
        assertEquals("cursor-2", platform.store().cursor())
        assertEquals("context-a", platform.store().contextToken("peer-a"))
        assertEquals("context-group", platform.store().contextToken("room-a"))
    }

    @Test
    fun `failed commit retains cursor and successful message id is deduplicated`() = runBlocking {
        val response = updatesResponse("cursor-2", directMessage())
        val api = FakeWeixinApi(updateResponses = ArrayDeque(listOf(response, response, response)))
        val platform = testPlatform(api)
        var commits = 0
        platform.setMessageHandler {
            commits += 1
            if (commits == 1) error("pipeline rejected")
        }

        assertFailsWith<IllegalStateException> { platform.pollOnce(api) }
        assertEquals("", platform.store().cursor())
        platform.pollOnce(api)
        platform.pollOnce(api)

        assertEquals(2, commits)
        assertEquals("cursor-2", platform.store().cursor())
    }

    @Test
    fun `identical text with different message ids is not content deduplicated`() = runBlocking {
        val second = JsonObject(directMessage().toMutableMap().also { it["message_id"] = Json.parseToJsonElement("\"m-other\"") })
        val api = FakeWeixinApi(
            updateResponses = ArrayDeque(listOf(updatesResponse("cursor-2", directMessage(), second))),
        )
        val platform = testPlatform(api)
        val events = mutableListOf<MessageEvent>()
        platform.setMessageHandler { events += it }

        platform.pollOnce(api)

        assertEquals(listOf("m1", "m-other"), events.map { it.messageId })
        assertEquals(listOf("hello", "hello"), events.map { it.chain.textContent })
    }

    @Test
    fun `persisted context token is used after platform recreation`() = runBlocking {
        val config = testConfig()
        val originalStore = WeixinStateStore(java.nio.file.Path.of(config.stateDirectory)).also { it.initialize() }
        originalStore.updateContextToken("peer-a", "persisted-context")
        val restoredStore = WeixinStateStore(java.nio.file.Path.of(config.stateDirectory))
        val api = FakeWeixinApi(sendResponses = ArrayDeque(listOf(json("""{"ret":0}"""))))
        val platform = WeixinPlatform(config, api, restoredStore, sleeper = {}, clockMillis = { 1_000L })
        stores[platform] = restoredStore
        platform.run()

        platform.sendMessage(privateSession(), MessageChain.text("hello"))

        assertEquals("persisted-context", api.sendCalls.single().contextToken)
        platform.terminate()
    }

    @Test
    fun `send restores context falls back once and keeps stable client id`() = runBlocking {
        val api = FakeWeixinApi(
            sendResponses = ArrayDeque(
                listOf(
                    json("""{"ret":-14,"errmsg":"session expired"}"""),
                    json("""{"ret":0}"""),
                ),
            ),
        )
        val platform = runningPlatform(api)
        platform.store().updateContextToken("peer-a", "context-a")

        val messageId = platform.sendMessage(privateSession(), MessageChain.text("hello"))

        assertNotNull(messageId)
        assertEquals(listOf("context-a", null), api.sendCalls.map { it.contextToken })
        assertEquals(1, api.sendCalls.map { it.clientId }.distinct().size)
        assertEquals(null, platform.store().contextToken("peer-a"))
        platform.terminate()
    }

    @Test
    fun `retryable transport failure is bounded and reuses client id`() = runBlocking {
        val api = FakeWeixinApi(
            sendFailures = ArrayDeque(
                listOf(
                    WeixinTransportException("temporary", retryable = true),
                    WeixinTransportException("temporary", retryable = true),
                ),
            ),
            sendResponses = ArrayDeque(listOf(json("""{"ret":0}"""))),
        )
        val waits = mutableListOf<Long>()
        val platform = runningPlatform(api, sleeper = { waits += it })

        platform.sendMessage(privateSession(), MessageChain.text("hello"))

        assertEquals(3, api.sendCalls.size)
        assertEquals(1, api.sendCalls.map { it.clientId }.distinct().size)
        assertEquals(listOf(10L, 20L), waits)
        platform.terminate()
    }

    @Test
    fun `rate limit opens cooldown without another api call`() = runBlocking {
        var now = 1_000L
        val api = FakeWeixinApi(
            sendResponses = ArrayDeque(listOf(json("""{"ret":-2,"errmsg":"frequency limit"}"""))),
        )
        val platform = runningPlatform(api, clockMillis = { now })

        assertFailsWith<WeixinRateLimitException> {
            platform.sendMessage(privateSession(), MessageChain.text("first"))
        }
        assertFailsWith<WeixinRateLimitException> {
            platform.sendMessage(privateSession(), MessageChain.text("second"))
        }

        assertEquals(1, api.sendCalls.size)
        now += 1_001
        api.sendResponses += json("""{"ret":0}""")
        platform.sendMessage(privateSession(), MessageChain.text("third"))
        assertEquals(2, api.sendCalls.size)
        platform.terminate()
    }

    @Test
    fun `concurrent multi chunk sends never interleave`() = runBlocking {
        val api = FakeWeixinApi(
            sendResponses = ArrayDeque(List(4) { json("""{"ret":0}""") }),
        )
        val platform = runningPlatform(api, config = testConfig(maxMessageCodePoints = 2))

        val first = async { platform.sendMessage(privateSession(), MessageChain.text("AAAA")) }
        val second = async { platform.sendMessage(privateSession(), MessageChain.text("BBBB")) }
        first.await()
        second.await()

        val sent = api.sendCalls.map { it.text }
        assertTrue(sent == listOf("AA", "AA", "BB", "BB") || sent == listOf("BB", "BB", "AA", "AA"))
        platform.terminate()
    }

    @Test
    fun `terminate cancels long poll closes api once and is idempotent`() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val api = FakeWeixinApi(onGetUpdates = {
            started.complete(Unit)
            awaitCancellation()
        })
        val platform = testPlatform(api)
        val job = platform.run()
        withTimeout(1_000) { started.await() }

        withTimeout(1_000) { platform.terminate() }
        platform.terminate()

        assertTrue(job.isCancelled)
        assertEquals(1, api.closeCount)
    }

    @Test
    fun `non retryable poll failure stops job and closes api`() = runBlocking {
        val api = FakeWeixinApi(
            onGetUpdates = { throw WeixinTransportException("HTTP 401", retryable = false) },
        )
        val platform = testPlatform(api)

        val job = platform.run()
        withTimeout(1_000) { job.join() }

        assertTrue(job.isCompleted)
        assertEquals(1, api.getUpdatesCalls)
        assertEquals(1, api.closeCount)
    }

    @Test
    fun `blank outbound text is rejected without api call`() = runBlocking {
        val api = FakeWeixinApi()
        val platform = runningPlatform(api)

        assertFailsWith<IllegalArgumentException> {
            platform.sendMessage(privateSession(), MessageChain.text("  "))
        }
        assertEquals(0, api.sendCalls.size)
        platform.terminate()
    }

    private fun updatesResponse(cursor: String, vararg messages: JsonObject): JsonObject = json(
        """{"ret":0,"get_updates_buf":"$cursor","msgs":[${messages.joinToString(",")}]}""",
    )

    private fun directMessage() = json(
        """{"message_id":"m1","from_user_id":"peer-a","context_token":"context-a","item_list":[{"type":1,"text_item":{"text":"hello"}}]}""",
    )

    private fun groupMessage() = json(
        """{"message_id":"m2","from_user_id":"peer-b","room_id":"room-a","context_token":"context-group","item_list":[{"type":1,"text_item":{"text":"group hello"}}]}""",
    )

    private fun json(value: String): JsonObject = Json.parseToJsonElement(value).jsonObject

    private fun privateSession() = MessageSession(
        id = "peer-a",
        type = SessionType.PRIVATE,
        platformName = "weixin-test",
    )

    private fun testConfig(
        token: String = "token",
        maxMessageCodePoints: Int = 2_000,
    ) = WeixinConfig(
        token = token,
        accountId = "account-a",
        baseUrl = "https://ilink.example.test",
        stateDirectory = Files.createTempDirectory("weixin-platform-state").toString(),
        pollRetryDelayMillis = 100,
        pollMaxBackoffMillis = 1_000,
        sendRetries = 2,
        sendRetryDelayMillis = 10,
        sendChunkDelayMillis = 0,
        rateLimitCooldownMillis = 1_000,
        maxMessageCodePoints = maxMessageCodePoints,
        name = "weixin-test",
    )

    private fun testPlatform(
        api: FakeWeixinApi,
        config: WeixinConfig = testConfig(),
        sleeper: suspend (Long) -> Unit = {},
        clockMillis: () -> Long = System::currentTimeMillis,
    ): WeixinPlatform {
        val store = WeixinStateStore(java.nio.file.Path.of(config.stateDirectory)).also { it.initialize() }
        return WeixinPlatform(config, api, store, sleeper, clockMillis).also { stores[it] = store }
    }

    private suspend fun runningPlatform(
        api: FakeWeixinApi,
        config: WeixinConfig = testConfig(),
        sleeper: suspend (Long) -> Unit = {},
        clockMillis: () -> Long = System::currentTimeMillis,
    ): WeixinPlatform {
        val platform = testPlatform(api, config, sleeper, clockMillis)
        platform.run()
        return platform
    }

    private fun WeixinPlatform.store(): WeixinStateStore = stores.getValue(this)

    private data class SendCall(
        val toUserId: String,
        val text: String,
        val contextToken: String?,
        val clientId: String,
    )

    private class FakeWeixinApi(
        val updateResponses: ArrayDeque<JsonObject> = ArrayDeque(),
        val sendResponses: ArrayDeque<JsonObject> = ArrayDeque(),
        val sendFailures: ArrayDeque<WeixinTransportException> = ArrayDeque(),
        private val onGetUpdates: (suspend () -> JsonObject)? = null,
    ) : WeixinApi {
        var getUpdatesCalls = 0
        var closeCount = 0
        val sendCalls = mutableListOf<SendCall>()

        override suspend fun getUpdates(syncBuf: String, timeoutMillis: Long): JsonObject {
            getUpdatesCalls += 1
            return onGetUpdates?.invoke()
                ?: updateResponses.removeFirstOrNull()
                ?: awaitCancellation()
        }

        override suspend fun sendText(
            toUserId: String,
            text: String,
            contextToken: String?,
            clientId: String,
        ): JsonObject {
            sendCalls += SendCall(toUserId, text, contextToken, clientId)
            sendFailures.removeFirstOrNull()?.let { throw it }
            return sendResponses.removeFirstOrNull() ?: buildJsonObject { put("ret", 0) }
        }

        override fun close() {
            closeCount += 1
        }
    }
}
