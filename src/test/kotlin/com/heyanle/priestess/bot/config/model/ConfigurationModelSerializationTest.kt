package com.heyanle.priestess.bot.config.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ConfigurationModelSerializationTest {
    private val json = Json {
        encodeDefaults = true
        prettyPrint = true
    }

    @Test
    fun `raw application document stores credential references but has no resolved secret field`() {
        val document = AppConfigDocument(
            providers = listOf(
                ProviderConnectionDocument(
                    id = "provider-a",
                    type = "openai-compatible",
                    credentialRef = CredentialReference(key = "PROVIDER_A_API_KEY"),
                ),
            ),
        )

        val serialized = json.encodeToString(document)

        assertTrue(serialized.contains("PROVIDER_A_API_KEY"))
        assertFalse(serialized.contains("actual-secret"))
        assertFalse(serialized.contains("apiKey"))
    }

    @Test
    fun `effective provider requires explicit redacted API projection`() {
        val effective = EffectiveProviderConnection(
            id = "provider-a",
            type = "openai-compatible",
            enabled = true,
            endpoint = "https://example.invalid",
            credential = GuardedSecret.of("actual-secret"),
            credentialReference = CredentialReference(key = "PROVIDER_A_API_KEY"),
            settings = emptyMap(),
        )

        val serialized = json.encodeToString(effective.redacted())

        assertTrue(serialized.contains(GuardedSecret.REDACTED_VALUE))
        assertTrue(serialized.contains("PROVIDER_A_API_KEY"))
        assertFalse(serialized.contains("actual-secret"))
        assertEquals(GuardedSecret.REDACTED_VALUE, effective.credential.toString())
    }

    @Test
    fun `workspace defaults are typed and do not erase nested defaults`() {
        val agent = AgentDefinitionDocument(
            id = "agent-a",
            providerRef = "provider-a",
            model = "model-a",
            generation = GenerationSettingsDocument(temperature = 0.25),
        )

        assertEquals(0.25, agent.generation.temperature)
        assertEquals(20, agent.context.compression.maxRounds)
        assertEquals(30_000, agent.execution.toolTimeoutMillis)
        assertEquals(com.heyanle.priestess.bot.tool.ToolRiskLevel.entries, agent.toolPolicy.allowedRiskLevels)
    }
}
