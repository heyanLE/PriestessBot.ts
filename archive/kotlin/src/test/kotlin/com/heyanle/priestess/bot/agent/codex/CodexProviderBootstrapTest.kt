package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.WireProtocol
import java.nio.file.Path
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CodexProviderBootstrapTest {
    private val provider = EffectiveProviderConnection(
        id = "responses", type = "openai", enabled = true,
        endpoint = "https://example.test/v1/responses", credential = GuardedSecret.of("test-token"),
        credentialReference = null, settings = emptyMap(), protocol = WireProtocol.OPENAI_RESPONSES,
    )

    @Test
    fun `custom Responses provider uses explicit token without login or process environment`() {
        val options = Json.parseToJsonElement(CodexProviderBootstrap.engineOptions(Path.of("agent-home"), provider)).jsonObject
        val nativeProvider = options["config"]!!.jsonObject["model_providers.priestess"]!!.jsonObject
        assertEquals("disabled", options["config"]!!.jsonObject["web_search"]!!.jsonPrimitive.content)
        assertEquals("https://example.test/v1", nativeProvider["base_url"]!!.jsonPrimitive.content)
        assertEquals("responses", nativeProvider["wire_api"]!!.jsonPrimitive.content)
        assertFalse(nativeProvider["requires_openai_auth"]!!.jsonPrimitive.boolean)
        assertEquals("test-token", nativeProvider["experimental_bearer_token"]!!.jsonPrimitive.content)
        assertFalse("env_key" in nativeProvider)
        val thread = Json.parseToJsonElement(CodexProviderBootstrap.threadParams(Path.of("agent-temp"), "model-x", "You are a helper.")).jsonObject
        assertEquals("priestess", thread["model_provider"]!!.jsonPrimitive.content)
        assertTrue(thread["no_environment"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `non Responses connection cannot enter native bootstrap`() {
        assertFailsWith<IllegalArgumentException> {
            CodexProviderBootstrap.engineOptions(Path.of("agent-home"), provider.copy(protocol = WireProtocol.OPENAI_CHAT_COMPLETIONS))
        }
    }
}
