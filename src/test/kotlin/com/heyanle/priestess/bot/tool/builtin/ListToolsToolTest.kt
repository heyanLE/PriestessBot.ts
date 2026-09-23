package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.RegisteredTool
import com.heyanle.priestess.bot.tool.ToolMetadata
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.ToolSource
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ListToolsToolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `lists built in and plugin tools with policy metadata`() = runBlocking {
        val tool = ListToolsTool {
            listOf(
                RegisteredTool(FakeTool(schema = schema("system_info"))),
                RegisteredTool(
                    tool = FakeTool(schema = schema("plugin_lookup", auditLog = true)),
                    metadata = ToolMetadata(source = ToolSource.PLUGIN, owner = "demo"),
                ),
            )
        }

        val result = tool.execute(AgentToolContext(), emptyMap())

        assertTrue(result.success)
        val response = json.decodeFromString<ListToolsResponse>(result.output)
        assertEquals(listOf("system_info", "plugin_lookup").sorted(), response.tools.map { it.name }.sorted())
        val plugin = response.tools.single { it.name == "plugin_lookup" }
        assertEquals(ToolSource.PLUGIN, plugin.source)
        assertEquals("demo", plugin.owner)
        assertTrue(plugin.auditLog)
    }

    @Test
    fun `filters by enabled source risk and query`() = runBlocking {
        val tool = ListToolsTool {
            listOf(
                RegisteredTool(FakeTool(schema = schema("safe_builtin"))),
                RegisteredTool(
                    FakeTool(schema = schema("external_plugin", riskLevel = ToolRiskLevel.EXTERNAL_READ)),
                    ToolMetadata(source = ToolSource.PLUGIN, owner = "demo"),
                ),
                RegisteredTool(FakeTool(schema = schema("disabled_builtin", defaultEnabled = false))),
            )
        }

        val result = tool.execute(
            AgentToolContext(),
            mapOf(
                "enabled" to "true",
                "source" to "plugin",
                "risk_level" to "EXTERNAL_READ",
                "query" to "external",
            ),
        )

        val response = json.decodeFromString<ListToolsResponse>(result.output)
        assertEquals(listOf("external_plugin"), response.tools.map { it.name })
    }

    @Test
    fun `hides high risk tools unless explicitly included`() = runBlocking {
        val tool = ListToolsTool {
            listOf(
                RegisteredTool(FakeTool(schema = schema("safe_tool"))),
                RegisteredTool(FakeTool(schema = schema("danger_tool", riskLevel = ToolRiskLevel.HIGH_RISK))),
            )
        }

        val hidden = json.decodeFromString<ListToolsResponse>(
            tool.execute(AgentToolContext(), emptyMap()).output,
        )
        val included = json.decodeFromString<ListToolsResponse>(
            tool.execute(AgentToolContext(), mapOf("include_high_risk" to "true")).output,
        )

        assertFalse(hidden.tools.any { it.name == "danger_tool" })
        assertTrue(included.tools.any { it.name == "danger_tool" })
    }

    @Test
    fun `dependency backed built in tools are listed unavailable when providers are missing`() = runBlocking {
        val registry = ToolController()
        registerBuiltinTools(ToolCase(registry))
        val tool = registry.get("list_tools") ?: error("list_tools not registered")

        val response = json.decodeFromString<ListToolsResponse>(
            tool.execute(AgentToolContext(), mapOf("include_high_risk" to "true")).output,
        )

        val unavailable = response.tools.associateBy { it.name }
        assertEquals("Requires health dependency", unavailable.getValue("health_check").statusReason)
        assertEquals("Requires conversation history dependency", unavailable.getValue("conversation_search").statusReason)
        assertEquals("Requires memory dependency", unavailable.getValue("memory_recall").statusReason)
        assertEquals("Requires reminder dependency", unavailable.getValue("list_reminders").statusReason)
        assertEquals("Requires knowledge dependency", unavailable.getValue("knowledge_search").statusReason)
        assertEquals(null, unavailable.getValue("web_search").statusReason)
        assertFalse(unavailable.getValue("memory_recall").effectiveEnabled)
        assertFalse(unavailable.getValue("list_reminders").effectiveEnabled)
    }

    private fun schema(
        name: String,
        riskLevel: ToolRiskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled: Boolean = true,
        auditLog: Boolean = false,
    ): ToolSchema = ToolSchema(
        name = name,
        description = "$name description",
        parameters = ToolParameters(),
        riskLevel = riskLevel,
        defaultEnabled = defaultEnabled,
        auditLog = auditLog,
    )
}
