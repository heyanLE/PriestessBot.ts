package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ToolPolicyResolver
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import kotlin.test.*

class ApplicationToolPolicyInitializerTest {
    private val tools = listOf(
        ConfigurableToolDescriptor("read", ToolRiskLevel.SAFE_READ, true),
        ConfigurableToolDescriptor("write", ToolRiskLevel.STATE_WRITE, false),
        ConfigurableToolDescriptor("danger", ToolRiskLevel.HIGH_RISK, false),
    )
    private val initializer = ApplicationToolPolicyInitializer()
    private val resolver = ToolPolicyResolver()

    @Test
    fun `unconfigured legacy Agent follows later platform opt in without frozen defaults`() {
        val migrated = initializer.normalize(document(), tools)
        assertEquals(mapOf("read" to true, "write" to false, "danger" to false), migrated.toolPolicy.enabled)
        assertEquals(emptyMap(), migrated.agents.single().toolPolicy.enabled)
        val enabledLater = migrated.toolPolicy.copy(enabled = migrated.toolPolicy.enabled!! + ("write" to true))
        assertEquals(setOf("read", "write"), resolver.resolveApplication(tools, enabledLater, migrated.agents.single().toolPolicy))
    }

    @Test
    fun `new Agent sparse inheritance does not opt every platform default off tool in`() {
        val normalized = initializer.normalize(document(agentPolicy = ToolPolicyDocument(enabled = emptyMap())), tools)
        assertEquals(mapOf("read" to true, "write" to false, "danger" to false), normalized.toolPolicy.enabled)
        assertEquals(setOf("read"), resolver.resolveApplication(tools, normalized.toolPolicy, normalized.agents.single().toolPolicy))
    }

    @Test
    fun `legacy explicit opt in preserves every Agents previous effective set`() {
        val old = document().copy(agents = listOf(
            agent("default"), agent("writer", ToolPolicyDocument(allow = listOf("write"))),
            agent("restricted", ToolPolicyDocument(deny = listOf("read"), allowedRiskLevels = listOf(ToolRiskLevel.SAFE_READ))),
        ))
        val before = old.agents.associate { it.id to resolver.resolveApplication(tools, old.toolPolicy, it.toolPolicy) }
        val normalized = initializer.normalize(old, tools)
        assertEquals(true, normalized.toolPolicy.enabled!!["write"])
        assertEquals(false, normalized.agents.first { it.id == "default" }.toolPolicy.enabled!!["write"])
        normalized.agents.forEach {
            assertEquals(before[it.id], resolver.resolveApplication(tools, normalized.toolPolicy, it.toolPolicy))
            assertTrue(it.toolPolicy.allow.isEmpty())
            assertTrue(it.toolPolicy.deny.isEmpty())
            assertEquals(ToolRiskLevel.entries, it.toolPolicy.allowedRiskLevels)
        }
    }

    @Test
    fun `platform off cannot be overridden and explicit empty platform means all off`() {
        val normalized = initializer.normalize(document(
            platformPolicy = ToolPolicyDocument(enabled = emptyMap()),
            agentPolicy = ToolPolicyDocument(enabled = mapOf("read" to true, "write" to true)),
        ), tools)
        assertEquals(tools.associate { it.id to false }, normalized.toolPolicy.enabled)
        assertTrue(resolver.resolveApplication(tools, normalized.toolPolicy, normalized.agents.single().toolPolicy).isEmpty())
    }

    @Test
    fun `existing switches survive default changes and new catalog keys initialize only once`() {
        val first = initializer.normalize(document(), tools)
        val changedDefaults = tools.map { it.copy(defaultEnabled = !it.defaultEnabled) }
        assertEquals(first, initializer.normalize(first, changedDefaults))
        val newTool = ConfigurableToolDescriptor("new-tool", ToolRiskLevel.SAFE_READ, true)
        val expanded = initializer.normalize(first, changedDefaults + newTool)
        assertEquals(first.toolPolicy.enabled, expanded.toolPolicy.enabled!!.filterKeys { it != "new-tool" })
        assertEquals(true, expanded.toolPolicy.enabled!!["new-tool"])
        assertEquals(expanded, initializer.normalize(expanded, changedDefaults + newTool.copy(defaultEnabled = false)))
    }

    @Test
    fun `hidden legacy constraints are folded into map and dormant dynamic decisions survive`() {
        val original = document(
            platformPolicy = ToolPolicyDocument(enabled = mapOf("read" to true, "write" to true, "offline-mcp" to false), deny = listOf("write")),
            agentPolicy = ToolPolicyDocument(enabled = mapOf("read" to true), allowedRiskLevels = listOf(ToolRiskLevel.STATE_WRITE)),
        )
        val normalized = initializer.normalize(original, tools)
        assertEquals(false, normalized.toolPolicy.enabled!!["write"])
        assertEquals(false, normalized.toolPolicy.enabled!!["offline-mcp"])
        assertEquals(false, normalized.agents.single().toolPolicy.enabled!!["read"])
        assertTrue(normalized.toolPolicy.deny.isEmpty())
        assertEquals(ToolRiskLevel.entries, normalized.agents.single().toolPolicy.allowedRiskLevels)
        assertTrue(resolver.resolveApplication(tools, normalized.toolPolicy, normalized.agents.single().toolPolicy).isEmpty())
    }

    private fun document(platformPolicy: ToolPolicyDocument = ToolPolicyDocument(), agentPolicy: ToolPolicyDocument = ToolPolicyDocument()) =
        ApplicationConfigurationDocument(toolPolicy = platformPolicy, agents = listOf(agent("agent", agentPolicy)))

    private fun agent(id: String, policy: ToolPolicyDocument = ToolPolicyDocument()) =
        AgentProfileDocument(id, llm = AgentLlmDocument("provider", "model"), toolPolicy = policy)
}
