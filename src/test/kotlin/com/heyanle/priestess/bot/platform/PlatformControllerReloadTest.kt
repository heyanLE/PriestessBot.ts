package com.heyanle.priestess.bot.platform

import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.EffectivePlatformConnection
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.pipeline.PipelineController
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlatformControllerReloadTest {
    @Test
    fun `changed platform config terminates old instance before starting replacement`() = runBlocking {
        val type = "reload-tracking-platform"
        val instances = mutableListOf<TrackingPlatform>()
        PlatformRegistry.registerMeta(
            PlatformMetadata(type, "Reload Tracking", false, false),
        ) { config ->
            TrackingPlatform(config?.name.orEmpty(), config?.token.orEmpty()).also(instances::add)
        }
        val runtime = testRuntimeConfiguration()
        val controller = PlatformController(
            runtime.case,
            PlatformCase { PipelineCase(PipelineController(emptyList(), Unit)) },
        )

        try {
            runtime.publish(AppConfigDocument(), platforms = mapOf("wechat-main" to connection(type, "old")))
            awaitUntil { instances.size == 1 }

            runtime.publish(AppConfigDocument(), platforms = mapOf("wechat-main" to connection(type, "new")))
            awaitUntil { instances.size == 2 }

            assertEquals("old", instances[0].token)
            assertEquals("new", instances[1].token)
            assertTrue(instances[0].terminated)
            assertEquals(instances[1], controller.get("wechat-main"))
        } finally {
            controller.stop()
            PlatformRegistry.unregister(type)
        }
    }

    private fun connection(type: String, token: String) = EffectivePlatformConnection(
        id = "wechat-main",
        type = type,
        enabled = true,
        defaultWorkspaceId = null,
        credentials = mapOf("token" to GuardedSecret.of(token)),
        settings = emptyMap(),
    )

    private suspend fun awaitUntil(condition: () -> Boolean) {
        withTimeout(2_000) {
            while (!condition()) delay(10)
        }
    }

    private class TrackingPlatform(
        name: String,
        val token: String,
    ) : Platform() {
        override val metadata = PlatformMetadata(name, name, false, false)
        var terminated = false
        private val lifetime = Job()

        override suspend fun run(): Job = lifetime

        override suspend fun terminate() {
            terminated = true
        }

        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = null
    }
}
