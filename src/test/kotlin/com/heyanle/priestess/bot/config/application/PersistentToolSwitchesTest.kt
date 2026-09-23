package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.resolve.*
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.config.source.RevisionedConfigFileStore
import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.encodeToString
import kotlin.test.*

class PersistentToolSwitchesTest {
    private val source = ApplicationConfigurationSource()
    private val baselineTools = listOf(
        ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ, true),
        ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE, false),
    )

    @Test
    fun `startup persists defaults once reads stay read only and reload seeds only new tools`() = inFixture { fixture ->
        assertTrue(fixture.service.startup().success)
        val seeded = Files.readString(fixture.path)
        val revision = RevisionedConfigFileStore().revision(fixture.path)
        val first = fixture.document()
        assertEquals(mapOf("read" to true, "write" to false), first.toolPolicy.enabled)
        assertEquals(emptyMap(), first.agents.single().toolPolicy.enabled)
        repeat(3) { assertEquals(revision, fixture.service.inspectRaw().value!!.revision) }
        assertEquals(seeded, Files.readString(fixture.path))
        assertEquals(revision, fixture.store.requireCurrent().desiredRevision)

        fixture.tools.replaceAll { it.copy(defaultEnabled = !it.defaultEnabled) }
        assertTrue(fixture.service.reloadFromDisk().success)
        assertEquals(seeded, Files.readString(fixture.path))
        assertEquals(setOf("read"), fixture.enabledTools())

        fixture.tools += ConfigurableToolDescriptor("new-tool", ToolRiskLevel.SAFE_READ, true)
        assertTrue(fixture.service.reloadFromDisk().success)
        assertEquals(mapOf("read" to true, "write" to false, "new-tool" to true), fixture.document().toolPolicy.enabled)
        val expanded = Files.readString(fixture.path)
        fixture.tools.replaceAll { it.copy(defaultEnabled = false) }
        assertTrue(fixture.service.reloadFromDisk().success)
        assertEquals(expanded, Files.readString(fixture.path))
        assertEquals(setOf("read", "new-tool"), fixture.enabledTools())
    }

    @Test
    fun `preview is read only and legacy API policy is normalized with revision checks`() = inFixture { fixture ->
        assertTrue(fixture.service.startup().success)
        val prior = Files.readString(fixture.path)
        val revision = RevisionedConfigFileStore().revision(fixture.path)
        val candidate = fixture.document().copy(
            toolPolicy = ToolPolicyDocument(),
            agents = fixture.document().agents.map { it.copy(toolPolicy = ToolPolicyDocument(allow = listOf("write"))) },
        )
        val body = source.json.encodeToString(candidate)
        assertTrue(fixture.service.previewApplication(body).success)
        assertEquals(prior, Files.readString(fixture.path))
        assertFalse(fixture.service.applyApplication(body, RawConfigRevision("stale")).success)
        assertEquals(prior, Files.readString(fixture.path))
        val result = fixture.service.applyApplication(body, revision)
        assertTrue(result.success, result.diagnostics.joinToString())
        assertEquals(setOf("write"), fixture.enabledTools())
        val saved = fixture.document()
        assertEquals(true, saved.toolPolicy.enabled!!["write"])
        assertEquals(false, saved.agents.single().toolPolicy.enabled!!["read"])
        assertTrue(saved.agents.single().toolPolicy.allow.isEmpty())
        assertEquals(RevisionedConfigFileStore().revision(fixture.path), fixture.store.requireCurrent().desiredRevision)
        assertEquals(fixture.store.requireCurrent().desiredRevision.value, result.desiredRevision)
    }

    @Test
    fun `all off remains off through later reads reload and schema default changes`() = inFixture { fixture ->
        val document = fixture.document().copy(toolPolicy = ToolPolicyDocument(enabled = emptyMap()))
        Files.writeString(fixture.path, source.json.encodeToString(document))
        assertTrue(fixture.service.startup().success)
        assertEquals(mapOf("read" to false, "write" to false), fixture.document().toolPolicy.enabled)
        assertTrue(fixture.enabledTools().isEmpty())
        fixture.tools.replaceAll { it.copy(defaultEnabled = true) }
        repeat(2) { fixture.service.inspectRaw(); assertTrue(fixture.service.reloadFromDisk().success) }
        assertTrue(fixture.enabledTools().isEmpty())
    }

    @Test
    fun `dynamic MCP is discovered persisted and released without poisoning other Agent policies`() {
        val root = Files.createTempDirectory("tool-switch-mcp-")
        val path = root.resolve("config.json")
        val store = EffectiveConfigStore()
        val opened = AtomicInteger()
        val closed = AtomicInteger()
        var mcpDefault = true
        val compiler = ConfigurationCompiler(environment = EnvironmentOverrideSource { null }, mcpConnector = McpServerConnector { _, _, _ ->
            opened.incrementAndGet()
            McpRuntimeConnection(listOf(FakeTool(schema = ToolSchema("dynamic_mcp", riskLevel = ToolRiskLevel.EXTERNAL_READ, defaultEnabled = mcpDefault))),
                AutoCloseable { closed.incrementAndGet() })
        })
        val app = application().copy(
            agents = listOf(application().agents.single().copy(mcpServerIds = listOf("mcp")),
                AgentProfileDocument("other", llm = AgentLlmDocument("provider", "model"))),
            mcpServers = listOf(McpServerDefinitionDocument("mcp", command = "test-only")),
        )
        Files.writeString(path, source.json.encodeToString(app))
        val service = service(path, store, compiler) { baselineTools }
        try {
            val result = service.startup()
            assertTrue(result.success, result.diagnostics.joinToString())
            val saved = source.json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
            assertEquals(true, saved.toolPolicy.enabled!!["dynamic_mcp"])
            assertTrue("dynamic_mcp" in store.requireCurrent().workspaces.getValue("agent").agents.getValue("agent").toolIds)
            assertFalse("dynamic_mcp" in store.requireCurrent().workspaces.getValue("other").agents.getValue("other").toolIds)
            assertEquals(2, opened.get())
            assertEquals(1, closed.get())
            service.inspectRaw()
            assertEquals(2, opened.get())
            mcpDefault = false
            assertTrue(service.reloadFromDisk().success)
            assertTrue("dynamic_mcp" in store.requireCurrent().workspaces.getValue("agent").agents.getValue("agent").toolIds)
        } finally { service.stop(); store.close(); root.toFile().deleteRecursively() }
        assertEquals(opened.get(), closed.get())
    }

    private fun service(path: Path, store: EffectiveConfigStore, compiler: ConfigurationCompiler, tools: () -> Collection<ConfigurableToolDescriptor>) =
        ConfigurationRuntimeService(path, compiler, store, registeredTools = tools, availableSkills = { emptySet() }, applicationSource = source)

    private fun application() = ApplicationConfigurationDocument(
        llms = listOf(ProviderConnectionDocument("provider", "openai-compatible")),
        agents = listOf(AgentProfileDocument("agent", llm = AgentLlmDocument("provider", "model"))),
    )

    private inner class Fixture(val path: Path, val store: EffectiveConfigStore, val tools: MutableList<ConfigurableToolDescriptor>, val service: ConfigurationRuntimeService) {
        fun document() = source.json.decodeFromString<ApplicationConfigurationDocument>(Files.readString(path))
        fun enabledTools() = store.requireCurrent().workspaces.getValue("agent").agents.getValue("agent").toolIds
    }

    private fun inFixture(block: (Fixture) -> Unit) {
        val root = Files.createTempDirectory("persistent-tool-switches-")
        val path = root.resolve("config.json")
        Files.writeString(path, source.json.encodeToString(application()))
        val store = EffectiveConfigStore()
        val tools = baselineTools.toMutableList()
        val service = service(path, store, ConfigurationCompiler(environment = EnvironmentOverrideSource { null })) { tools }
        try { block(Fixture(path, store, tools, service)) } finally { service.stop(); store.close(); root.toFile().deleteRecursively() }
    }
}
