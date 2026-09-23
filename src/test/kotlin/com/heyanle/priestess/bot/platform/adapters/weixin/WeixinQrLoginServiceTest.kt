package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.DesiredConfig
import com.heyanle.priestess.bot.config.model.EffectivePlatformConnection
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeView
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.RawConfigRevision
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.pipeline.PipelineController
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformCase
import com.heyanle.priestess.bot.platform.PlatformController
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.PlatformRegistry
import com.heyanle.priestess.bot.platform.registerBuiltinPlatforms
import java.nio.file.Files
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WeixinQrLoginServiceTest {
    @Test
    fun `QR login requires authenticated dashboard before creating remote client`() = runBlocking {
        val runtime = runtime(Files.createTempDirectory("weixin-qr-auth"), dashboardToken = null)
        var apiCreated = false
        val service = WeixinQrLoginService(
            runtimeConfig = runtime,
            platformCase = PlatformCase { PipelineCase(PipelineController(emptyList(), Unit)) },
            apiFactory = {
                apiCreated = true
                FakeQrApi(ArrayDeque())
            },
        )

        kotlin.test.assertFailsWith<IllegalStateException> { service.start("weixin-main") }
        assertFalse(apiCreated)
        service.stop()
    }

    @Test
    fun `confirmed login stores credential without returning token and restarts platform`() = runBlocking {
        val stateDirectory = Files.createTempDirectory("weixin-qr-confirm")
        val runtime = runtime(stateDirectory)
        lateinit var controller: PlatformController
        val platformCase = PlatformCase(
            controllerProvider = { controller },
            pipelineCaseProvider = { PipelineCase(PipelineController(emptyList(), Unit)) },
        )
        controller = PlatformController(runtime, platformCase)
        delay(20)
        val started = mutableListOf<TrackingPlatform>()
        PlatformRegistry.registerMeta(PlatformMetadata("weixin", "Test Weixin", false, false)) { config ->
            TrackingPlatform(config?.name.orEmpty()).also(started::add)
        }
        val api = FakeQrApi(
            statuses = ArrayDeque(
                listOf(
                    json("""{"status":"scaned"}"""),
                    json("""{"status":"confirmed","ilink_bot_id":"account-a","bot_token":"secret-token","baseurl":"https://ilinkai.weixin.qq.com","ilink_user_id":"user-a"}"""),
                ),
            ),
        )
        val service = WeixinQrLoginService(
            runtimeConfig = runtime,
            platformCase = platformCase,
            apiFactory = { api },
            renderer = { "data:image/png;base64,test" },
            pollDelayMillis = 1,
        )

        try {
            val created = service.start("weixin-main")
            val completed = awaitTerminal { service.status("weixin-main", created.sessionId) }

            assertEquals(WeixinQrLoginStatus.CONFIRMED, completed.status)
            assertEquals("account-a", completed.accountId)
            assertTrue(completed.platformRunning)
            assertFalse(completed.toString().contains("secret-token"))
            assertEquals("secret-token", WeixinCredentialStore(stateDirectory).load()?.token)
            assertTrue(started.isNotEmpty())
            assertEquals("weixin-main", started.last().metadata.name)
            assertEquals(1, api.closeCount)
        } finally {
            service.stop()
            controller.stop()
            registerBuiltinPlatforms()
        }
    }

    @Test
    fun `redirect is validated and expired codes refresh only three times`() = runBlocking {
        val stateDirectory = Files.createTempDirectory("weixin-qr-expiry")
        val runtime = runtime(stateDirectory)
        val platformCase = PlatformCase(
            pipelineCaseProvider = { PipelineCase(PipelineController(emptyList(), Unit)) },
        )
        val api = FakeQrApi(
            statuses = ArrayDeque(
                listOf(
                    json("""{"status":"scaned_but_redirect","redirect_host":"redirect.weixin.qq.com"}"""),
                    json("""{"status":"expired"}"""),
                    json("""{"status":"expired"}"""),
                    json("""{"status":"expired"}"""),
                    json("""{"status":"expired"}"""),
                ),
            ),
        )
        val service = WeixinQrLoginService(
            runtimeConfig = runtime,
            platformCase = platformCase,
            apiFactory = { api },
            renderer = { "data:$it" },
            pollDelayMillis = 1,
        )

        try {
            val created = service.start("weixin-main")
            val expired = awaitTerminal { service.status("weixin-main", created.sessionId) }

            assertEquals(WeixinQrLoginStatus.EXPIRED, expired.status)
            assertEquals(4, api.requestCount)
            assertEquals(4, expired.qrRevision)
            assertEquals(WeixinConfig.DEFAULT_BASE_URL, api.statusBaseUrls[0])
            assertEquals("https://redirect.weixin.qq.com", api.statusBaseUrls[1])
            assertTrue(api.statusBaseUrls.drop(2).all { it == WeixinConfig.DEFAULT_BASE_URL })
            assertEquals(1, api.closeCount)
        } finally {
            service.stop()
        }
    }

    @Test
    fun `cancelling login stops polling and closes api`() = runBlocking {
        val stateDirectory = Files.createTempDirectory("weixin-qr-cancel")
        val runtime = runtime(stateDirectory)
        val platformCase = PlatformCase(
            pipelineCaseProvider = { PipelineCase(PipelineController(emptyList(), Unit)) },
        )
        val api = FakeQrApi(statuses = ArrayDeque(List(100) { json("""{"status":"wait"}""") }))
        val service = WeixinQrLoginService(runtime, platformCase, { api }, { "data:$it" }, pollDelayMillis = 10)

        val created = service.start("weixin-main")
        val cancelled = service.cancel("weixin-main", created.sessionId)

        assertEquals(WeixinQrLoginStatus.CANCELLED, cancelled.status)
        assertEquals(1, api.closeCount)
        service.stop()
    }

    private fun runtime(
        stateDirectory: java.nio.file.Path,
        dashboardToken: String? = "dashboard-token",
    ): RuntimeConfigurationCase {
        val document = AppConfigDocument()
        val store = EffectiveConfigStore()
        store.publish(
            DesiredConfig(
                document = document,
                rawRevision = RawConfigRevision("test"),
                sourceFingerprint = SourceFingerprint("test"),
                runtime = EffectiveRuntimeView(
                    document.runtime.server,
                    document.runtime.database,
                    document.runtime.plugins,
                    document.runtime.reload,
                    document.runtime.pipeline,
                    document.runtime.command,
                    document.runtime.permission,
                ),
                serverApiCredential = dashboardToken?.let(GuardedSecret::of),
                platforms = mapOf(
                    "weixin-main" to EffectivePlatformConnection(
                        id = "weixin-main",
                        type = "weixin",
                        enabled = true,
                        defaultWorkspaceId = null,
                        credentials = emptyMap(),
                        settings = mapOf("stateDirectory" to stateDirectory.toString()),
                    ),
                ),
                providers = emptyMap(),
                workspaces = emptyMap(),
                provenance = emptyMap(),
            ),
        )
        return RuntimeConfigurationCase(store) {}
    }

    private suspend fun awaitTerminal(view: () -> WeixinQrLoginView): WeixinQrLoginView = withTimeout(2_000) {
        while (true) {
            val current = view()
            if (current.status !in setOf(WeixinQrLoginStatus.WAITING, WeixinQrLoginStatus.SCANNED)) return@withTimeout current
            delay(2)
        }
        error("unreachable")
    }

    private class FakeQrApi(
        private val statuses: ArrayDeque<JsonObject>,
    ) : WeixinQrApi {
        var requestCount = 0
        var closeCount = 0
        val statusBaseUrls = mutableListOf<String>()

        override suspend fun requestQrCode(botType: String): WeixinQrCode {
            requestCount += 1
            return WeixinQrCode("qr-$requestCount", "scan-$requestCount")
        }

        override suspend fun queryStatus(baseUrl: String, qrToken: String): JsonObject {
            statusBaseUrls += baseUrl
            return statuses.removeFirstOrNull() ?: json("""{"status":"wait"}""")
        }

        override fun close() {
            closeCount += 1
        }
    }

    private class TrackingPlatform(name: String) : Platform() {
        override val metadata = PlatformMetadata(name, name, false, false)
        private val job = Job()
        override suspend fun run(): Job = job
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = null
    }

    private companion object {
        fun json(value: String): JsonObject = Json.parseToJsonElement(value) as JsonObject
    }
}
