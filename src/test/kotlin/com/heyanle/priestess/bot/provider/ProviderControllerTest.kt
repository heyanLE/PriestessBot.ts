package com.heyanle.priestess.bot.provider

import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.*

class ProviderControllerTest {
    @Test
    fun `effective provider uses only compiled connection values`() = runBlocking {
        ProviderRegistry.register(metadata("effective-type")) { StaticProvider(it) }
        val runtime = testRuntimeConfiguration()
        val controller = ProviderController(runtime.case)
        try {
            val provider = assertNotNull(controller.getEffective(
                EffectiveProviderConnection("production", "effective-type", true, "https://provider.example/v1", GuardedSecret.of("compiled-secret"), null, mapOf("region" to "test")),
            ))
            assertEquals("production", provider.config.name)
            assertEquals("", provider.config.model)
            assertEquals("compiled-secret", provider.config.resolveApiKey())
        } finally {
            controller.stop()
            ProviderRegistry.unregister("effective-type")
        }
    }

    @Test
    fun `activated provider generations replace and remove configured providers`() = runBlocking {
        ProviderRegistry.register(metadata("config-provider")) { StaticProvider(it) }
        val first = app(provider("main", "model-a"))
        val runtime = testRuntimeConfiguration(first)
        val controller = ProviderController(runtime.case)
        try {
            assertNotNull(controller.getByName("main"))
            runtime.publish(app(provider("main", "model-b"), provider("extra", "model-c")))
            eventually {
                assertNotNull(controller.getByName("main"))
                assertNotNull(controller.getByName("extra"))
            }
            runtime.publish(AppConfigDocument())
            eventually {
                assertNull(controller.getByName("main"))
                assertNull(controller.getByName("extra"))
            }
        } finally {
            controller.stop()
            ProviderRegistry.unregister("config-provider")
        }
    }

    private fun provider(id: String, @Suppress("UNUSED_PARAMETER") model: String) = ProviderConnectionDocument(id, "config-provider")
    private fun app(vararg providers: ProviderConnectionDocument) = AppConfigDocument(providers = providers.toList())

    private suspend fun eventually(assertion: () -> Unit) = withTimeout(1_000) {
        while (true) try { assertion(); return@withTimeout } catch (_: AssertionError) { delay(10) }
    }

    private class StaticProvider(override val config: ProviderConfig) : ChatProvider {
        override val metadata = metadata(config.name)
        override suspend fun textChat(request: LLMRequest) = LLMResponse(content = config.model)
        override suspend fun getModels() = listOf(config.model)
        override suspend fun test() = true
    }

    companion object {
        private fun metadata(name: String) = ProviderMetadata(name, name, LLMKind.OPENAI, false, false, false)
    }
}
