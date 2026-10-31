package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.source.EnvironmentOverrideSource
import com.heyanle.priestess.bot.config.source.RevisionedConfigFileStore
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.platform.*
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlin.test.*

class ApplicationConfigurationSourceTest {
    private val source = ApplicationConfigurationSource()

    @Test
    fun `group context is opt in and budgets are validated`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val base = validDocument().copy(ims = listOf(im("qq", "assistant")))
        val loaded = source.decode(source.json.encodeToString(base), path)
        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        assertFalse(loaded.value!!.application!!.ims.single().groupContext.recentEnabled)
        assertFalse(loaded.value!!.application!!.ims.single().groupContext.archiveEnabled)

        val invalid = base.copy(ims = listOf(base.ims.single().copy(
            groupContext = GroupContextSettingsDocument(recentEnabled = true, maxInjectedTokens = 0),
        )))
        val rejected = source.decode(source.json.encodeToString(invalid), path)
        assertFalse(rejected.isSuccess)
        assertTrue(rejected.diagnostics.any { it.path.contains("maxInjectedTokens") })
    }

    @Test
    fun `route injection defaults to multi and rejects modes the Agent cannot run`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val base = validDocument()
        assertTrue(source.decode(source.json.encodeToString(base), path).isSuccess)
        val none = base.copy(ims = listOf(im("qq", "assistant").copy(routes = listOf(
            ImRouteDocument("no-im-tools", action = ImRouteActionDocument(agentId = "assistant", toolInjectionMode = ToolInjectionMode.NONE)),
        ))))
        assertTrue(source.decode(source.json.encodeToString(none), path).isSuccess)
        val unsupported = none.copy(ims = listOf(none.ims.single().copy(routes = listOf(
            ImRouteDocument("single", action = ImRouteActionDocument(agentId = "assistant", toolInjectionMode = ToolInjectionMode.SINGLE)),
        ))))
        val rejected = source.decode(source.json.encodeToString(unsupported), path)
        assertFalse(rejected.isSuccess)
        assertTrue(rejected.diagnostics.any { it.path.contains("toolInjectionMode") && it.message.contains("SINGLE") })
        val command = none.copy(ims = listOf(none.ims.single().copy(routes = listOf(
            ImRouteDocument("command", action = ImRouteActionDocument(type = ImRouteActionType.COMMAND, toolInjectionMode = ToolInjectionMode.NONE)),
        ))))
        assertFalse(source.decode(source.json.encodeToString(command), path).isSuccess)
    }

    @Test
    fun `LLM protocol defaults to chat and rejects unknown or incompatible values`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val base = validDocument()
        val default = assertNotNull(source.decode(source.json.encodeToString(base), path).value)
        val compiler = ConfigurationCompiler(environment = EnvironmentOverrideSource { null })
        val compiled = compiler.compile(default, emptyList(), emptySet())
        assertTrue(compiled.isSuccess, compiled.diagnostics.joinToString())
        assertEquals(WireProtocol.OPENAI_CHAT_COMPLETIONS, compiled.desired!!.providers.getValue("llm").protocol)

        val responses = base.copy(llms = base.llms.map { it.copy(protocol = "OPENAI_RESPONSES") })
        val accepted = source.decode(source.json.encodeToString(responses), path)
        assertTrue(accepted.isSuccess, accepted.diagnostics.joinToString())
        assertEquals(WireProtocol.OPENAI_RESPONSES, compiler.compile(assertNotNull(accepted.value), emptyList(), emptySet()).desired!!.providers.getValue("llm").protocol)

        listOf("UNKNOWN", "ANTHROPIC_MESSAGES").forEach { value ->
            val invalid = base.copy(llms = base.llms.map { it.copy(protocol = value) })
            val result = source.decode(source.json.encodeToString(invalid), path)
            assertFalse(result.isSuccess, "Unexpectedly accepted $value")
            assertTrue(result.diagnostics.any { it.path.contains("protocol") })
        }
    }

    @Test
    fun `multiple IMs and independent Agents project without creating parallel authoring files`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val first = agent("first").copy(personaId = "persona-one", memory = AgentMemoryDocument(listOf("shared"), "shared"))
        val second = agent("second").copy(llm = AgentLlmDocument("other-llm", "model-two"))
        val document = validDocument().copy(
            agents = listOf(first, second, agent("disabled").copy(enabled = false)),
            llms = listOf(ProviderConnectionDocument("llm", "openai-compatible"), ProviderConnectionDocument("other-llm", "openai-compatible")),
            ims = listOf(im("qq", "first"), im("tg", "second").copy(type = "telegram")),
            memoryLibraries = listOf(MemoryLibraryDocument("shared")),
        )
        val loaded = source.decode(source.json.encodeToString(document), path)
        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val raw = assertNotNull(loaded.value)
        assertEquals(document, raw.application)
        assertEquals(listOf("qq", "tg"), raw.document.platforms.map { it.id })
        assertEquals(setOf("first", "second"), raw.workspaces.keys)
        val secondUnit = raw.workspaces.getValue("second").document
        assertEquals("second", secondUnit.primaryAgentId)
        assertEquals("other-llm", secondUnit.agents.single().providerRef)
        assertEquals("model-two", secondUnit.agents.single().model)
        assertEquals("persona-one", raw.workspaces.getValue("first").document.personas.single().id)
        assertEquals(root.toRealPath().resolve("agents/first/config").toString(), raw.document.workspaces.entries.first().directory)
        assertFalse(Files.exists(root.resolve("agents")))
    }

    @Test
    fun `projection revisions are the original bytes revision and route order remains authoritative`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val routes = listOf(
            ImRouteDocument("first-match", match = ImRouteMatchDocument(textPattern = "*hello*"), action = ImRouteActionDocument(agentId = "assistant")),
            ImRouteDocument("fallback", action = ImRouteActionDocument(agentId = "second")),
        )
        val document = validDocument().copy(agents = listOf(agent("assistant"), agent("second")), ims = listOf(im("qq", "assistant").copy(routes = routes)))
        val original = "  \n" + source.json.encodeToString(document) + "\n\n"
        Files.writeString(path, original)
        val loaded = source.load(path)
        assertTrue(loaded.isSuccess, loaded.diagnostics.joinToString())
        val raw = assertNotNull(loaded.value)
        val revision = RevisionedConfigFileStore().revision(path)
        assertEquals(revision, raw.revision)
        raw.workspaces.values.forEach { assertEquals(raw.revision, it.revision) }
        assertEquals(original, Files.readString(path))
        assertEquals(routes, raw.application!!.ims.single().routes)
        val event = MessageEvent(FakePlatform(), MessageSession("user", SessionType.PRIVATE, "qq"), MessageChain.text("hello there"))
        assertEquals("first-match", ImRouter().match(raw.application!!.ims.single(), event)?.route?.id)
        assertEquals("fallback", ImRouter().match(raw.application!!.ims.single().copy(routes = routes.reversed()), event)?.route?.id)
    }

    @Test
    fun `strict source rejects unknown fields duplicate keys and duplicate identifiers`() = inDirectory { root ->
        val path = root.resolve("config.json")
        val encoded = source.json.encodeToJsonElement(validDocument()).jsonObject
        assertFalse(source.decode(JsonObject(encoded + ("unknownConfiguration" to JsonPrimitive(true))).toString(), path).isSuccess)
        assertFalse(source.decode("""{"schemaVersion":3,"schemaVersion":3}""", path).isSuccess)
        val duplicateVariants = listOf(
            validDocument().copy(agents = listOf(agent("assistant"), agent("assistant"))),
            validDocument().copy(ims = listOf(im("qq", "assistant"), im("qq", "assistant"))),
            validDocument().copy(llms = listOf(ProviderConnectionDocument("llm", "openai-compatible"), ProviderConnectionDocument("llm", "openai-compatible"))),
            validDocument().copy(ims = listOf(im("qq", "assistant").copy(routes = listOf(route("same"), route("same"))))),
        )
        duplicateVariants.forEach { assertFalse(source.decode(source.json.encodeToString(it), path).isSuccess) }
    }

    @Test
    fun `enabled references and resource directories are validated before projection`() = inDirectory { root ->
        val path = root.resolve("config.json")
        Files.writeString(root.resolve("occupied"), "an existing file cannot become a runtime directory")
        val base = validDocument()
        val invalidVariants = listOf(
            base.copy(llms = base.llms.map { it.copy(enabled = false) }),
            base.copy(agents = listOf(agent("assistant").copy(llm = AgentLlmDocument("missing", "model")))),
            base.copy(ims = listOf(im("qq", "missing"))),
            base.copy(agents = listOf(agent("assistant").copy(enabled = false))),
            base.copy(agents = listOf(agent("assistant").copy(configDirectory = "agents/common", tempDirectory = "agents/nested/../common"))),
            base.copy(agents = listOf(agent("assistant").copy(configDirectory = ""))),
            base.copy(agents = listOf(agent("assistant").copy(tempDirectory = ""))),
            base.copy(platformDirectory = ""),
            base.copy(platformDirectory = "occupied"),
            base.copy(agents = listOf(agent("assistant").copy(configDirectory = "occupied/nested"))),
            base.copy(agents = listOf(agent("assistant").copy(tempDirectory = "occupied/nested"))),
            base.copy(agents = listOf(agent("assistant").copy(memory = AgentMemoryDocument(listOf("missing"))))),
            base.copy(agents = listOf(agent("assistant").copy(mcpServerIds = listOf("missing")))),
            base.copy(agents = listOf(agent("assistant").copy(skills = AgentSkillsDocument(platformLibraries = listOf(AgentSkillLibraryBinding("missing")))))),
            base.copy(agents = listOf(agent("assistant").copy(memory = AgentMemoryDocument(writeLibraryId = "not-selected")))),
        )
        invalidVariants.forEachIndexed { index, document ->
            val result = source.decode(source.json.encodeToString(document), path)
            assertFalse(result.isSuccess, "Invalid variant $index was accepted")
            assertNull(result.value)
        }
    }

    @Test
    fun `global constraints bound explicit Agent selection while default-off tool can be enabled`() = inDirectory { root ->
        val descriptors = listOf(
            ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ),
            ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE, defaultEnabled = false),
            ConfigurableToolDescriptor("danger", ToolRiskLevel.HIGH_RISK),
        )
        val compiler = ConfigurationCompiler(environment = EnvironmentOverrideSource { null })
        fun selected(global: ToolPolicyDocument, local: ToolPolicyDocument): Set<String> {
            val document = validDocument().copy(toolPolicy = global, agents = listOf(agent("assistant").copy(toolPolicy = local)))
            val raw = assertNotNull(source.decode(source.json.encodeToString(document), root.resolve("config.json")).value)
            val result = compiler.compile(raw, descriptors, emptySet())
            assertTrue(result.isSuccess, result.diagnostics.joinToString())
            return result.desired!!.workspaces.getValue("assistant").agents.getValue("assistant").toolIds
        }
        assertEquals(setOf("write"), selected(ToolPolicyDocument(), ToolPolicyDocument(allow = listOf("write"))))
        assertEquals(emptySet(), selected(ToolPolicyDocument(deny = listOf("write")), ToolPolicyDocument(allow = listOf("write"))))
        assertEquals(setOf("read"), selected(ToolPolicyDocument(allowedRiskLevels = listOf(ToolRiskLevel.SAFE_READ)), ToolPolicyDocument(allow = listOf("read", "danger"))))
        assertFalse("write" in selected(ToolPolicyDocument(), ToolPolicyDocument()))
    }

    private fun validDocument() = ApplicationConfigurationDocument(
        llms = listOf(ProviderConnectionDocument("llm", "openai-compatible")),
        agents = listOf(agent("assistant")), ims = listOf(im("qq", "assistant")),
    )

    private fun agent(id: String) = AgentProfileDocument(id, llm = AgentLlmDocument("llm", "model"))
    private fun route(id: String) = ImRouteDocument(id, action = ImRouteActionDocument(agentId = "assistant"))
    private fun im(id: String, agentId: String) = ImConnectionDocument(id, type = "napcat4_18_6", routes = listOf(ImRouteDocument("route", action = ImRouteActionDocument(agentId = agentId))))

    private inline fun inDirectory(block: (Path) -> Unit) {
        val root = Files.createTempDirectory("application-source-test-")
        try { block(root) } finally { root.toFile().deleteRecursively() }
    }
}
