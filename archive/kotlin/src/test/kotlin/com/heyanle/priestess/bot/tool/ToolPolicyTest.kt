package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.FakeTool
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ToolPolicyTest {
    @Test
    fun `allow all permits tools and preserves audit decision`() {
        val tool = FakeTool(schema = schema(name = "audited_tool", auditLog = true))

        val decision = ToolPolicy.allowAll().check(AgentToolContext(), tool, emptyMap())

        assertTrue(decision.allowed)
        assertTrue(decision.auditLog)
        assertEquals(null, decision.code)
    }

    @Test
    fun `configured policy denies explicitly disabled tool`() {
        val tool = FakeTool(schema = schema(name = "disabled_tool", auditLog = true))
        val policy = ToolPolicy.configured(ToolPolicyConfig(disabledTools = setOf("disabled_tool")))

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertFalse(decision.allowed)
        assertEquals(ToolPolicyDenialCode.DISABLED_TOOL, decision.code)
        assertEquals("Tool 'disabled_tool' is disabled", decision.message)
        assertTrue(decision.auditLog)
    }

    @Test
    fun `configured policy denies tools outside enabled allowlist`() {
        val tool = FakeTool(schema = schema(name = "not_listed"))
        val policy = ToolPolicy.configured(ToolPolicyConfig(enabledTools = setOf("listed_tool")))

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertFalse(decision.allowed)
        assertEquals(ToolPolicyDenialCode.DISABLED_TOOL, decision.code)
        assertEquals("Tool 'not_listed' is not enabled", decision.reason)
    }

    @Test
    fun `configured policy denies disallowed risk level`() {
        val tool = FakeTool(schema = schema(name = "write_tool", riskLevel = ToolRiskLevel.STATE_WRITE))
        val policy = ToolPolicy.configured(
            ToolPolicyConfig(allowedRiskLevels = setOf(ToolRiskLevel.SAFE_READ, ToolRiskLevel.EXTERNAL_READ)),
        )

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertFalse(decision.allowed)
        assertEquals(ToolPolicyDenialCode.DISALLOWED_RISK, decision.code)
        assertTrue(decision.message.contains("STATE_WRITE"))
    }

    @Test
    fun `configured policy reports missing non-context capabilities`() {
        val tool = FakeTool(
            schema = schema(
                name = "network_tool",
                requiredCapabilities = listOf(ToolCapabilities.NETWORK, ToolCapabilities.PROVIDER_SEARCH),
            ),
        )
        val policy = ToolPolicy.configured(
            ToolPolicyConfig(availableCapabilities = setOf(ToolCapabilities.NETWORK)),
        )

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertFalse(decision.allowed)
        assertEquals(ToolPolicyDenialCode.MISSING_CAPABILITY, decision.code)
        assertEquals(listOf(ToolCapabilities.PROVIDER_SEARCH), decision.missingCapabilities)
    }

    @Test
    fun `platform and session capabilities are satisfied by tool context`() {
        val platform = FakePlatform()
        val session = FakePlatform.fakeSession()
        val tool = FakeTool(
            schema = schema(
                name = "session_tool",
                requiredCapabilities = listOf(ToolCapabilities.PLATFORM, ToolCapabilities.SESSION),
            ),
        )
        val policy = ToolPolicy.configured(ToolPolicyConfig())

        val decision = policy.check(AgentToolContext(platform = platform, session = session), tool, emptyMap())

        assertTrue(decision.allowed)
    }

    @Test
    fun `high risk tool requires explicit confirmation`() {
        val tool = FakeTool(schema = schema(name = "danger_tool", riskLevel = ToolRiskLevel.HIGH_RISK))
        val policy = ToolPolicy.configured(ToolPolicyConfig())

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertFalse(decision.allowed)
        assertEquals(ToolPolicyDenialCode.CONFIRMATION_REQUIRED, decision.code)
    }

    @Test
    fun `high risk tool is allowed when confirmed and risk is allowed`() {
        val tool = FakeTool(schema = schema(name = "danger_tool", riskLevel = ToolRiskLevel.HIGH_RISK))
        val policy = ToolPolicy.configured(
            ToolPolicyConfig(confirmedTools = setOf("danger_tool")),
        )

        val decision = policy.check(AgentToolContext(), tool, emptyMap())

        assertTrue(decision.allowed)
    }

    private fun schema(
        name: String,
        riskLevel: ToolRiskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities: List<String> = emptyList(),
        auditLog: Boolean = false,
    ): ToolSchema = ToolSchema(
        name = name,
        description = "Policy test tool",
        parameters = ToolParameters(),
        riskLevel = riskLevel,
        requiredCapabilities = requiredCapabilities,
        auditLog = auditLog,
    )
}
