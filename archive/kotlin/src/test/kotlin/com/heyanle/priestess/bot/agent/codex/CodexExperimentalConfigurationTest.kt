package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource
import com.heyanle.priestess.bot.agent.ExternalAgentRunnerRegistry
import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.core.di.coreModule
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import java.nio.file.Files
import org.koin.dsl.koinApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Run separately with the explicit experimental flag and a pinned mock JNI library. */
class CodexExperimentalConfigurationTest {
    @Test
    fun `opted-in runtime registers the Codex runner`() = runBlocking {
        if (System.getenv("PRIESTESS_CODEX_EXPERIMENTAL") != "true") return@runBlocking
        val app = koinApplication { modules(coreModule) }
        try {
            val registry = app.koin.get<ExternalAgentRunnerRegistry>()
            assertNotNull(registry.get(AgentEngine.CODEX))
            registry.stop()
        } finally {
            app.close()
        }
    }

    @Test
    fun `enabled Codex requires Responses credentials and rejects native tool name collisions`() {
        if (System.getenv("PRIESTESS_CODEX_EXPERIMENTAL") != "true") return
        assertNotNull(CodexNativeAvailability.selection.path, CodexNativeAvailability.selection.problem.orEmpty())
        val source = ApplicationConfigurationSource()
        val path = Files.createTempDirectory("priestess-codex-config-").resolve("config.json")
        val document = ApplicationConfigurationDocument(
            llms = listOf(ProviderConnectionDocument("llm", "openai", endpoint = "http://127.0.0.1:18081/v1",
                credentialRef = CredentialReference(key = "MOCK_TOKEN"), protocol = "OPENAI_RESPONSES")),
            agents = listOf(AgentProfileDocument("codex", type = AgentType.CODEX, llm = AgentLlmDocument("llm", "gpt-5.1"))),
            ims = listOf(ImConnectionDocument("telegram", type = "telegram", routes = listOf(
                ImRouteDocument("private", action = ImRouteActionDocument(agentId = "codex", toolInjectionMode = ToolInjectionMode.NONE)),
            ))),
        )
        val raw = source.decode(source.json.encodeToString(document), path)
        assertTrue(raw.isSuccess, raw.diagnostics.joinToString())
        val compiler = ConfigurationCompiler(environment = EnvironmentOverrideSource { key -> if (key == "MOCK_TOKEN") "fake-token" else null })
        assertTrue(compiler.compile(assertNotNull(raw.value), emptyList(), emptySet()).isSuccess)

        val collision = compiler.compile(assertNotNull(raw.value), listOf(
            ConfigurableToolDescriptor("web_search", ToolRiskLevel.EXTERNAL_READ),
        ), emptySet())
        assertEquals("AGENT_CODEX_NATIVE_TOOL_COLLISION", collision.diagnostics.first { it.code == "AGENT_CODEX_NATIVE_TOOL_COLLISION" }.code)
    }
}
