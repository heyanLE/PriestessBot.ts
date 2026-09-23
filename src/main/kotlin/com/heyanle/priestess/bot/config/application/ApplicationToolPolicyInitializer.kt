package com.heyanle.priestess.bot.config.application

import com.heyanle.priestess.bot.config.model.ApplicationConfigurationDocument
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ToolPolicyResolver
import com.heyanle.priestess.bot.tool.ToolRiskLevel

/** Converts legacy restrictions and seeds newly discovered tools, without changing stored switches. */
class ApplicationToolPolicyInitializer {
    private val resolver = ToolPolicyResolver()

    fun normalize(document: ApplicationConfigurationDocument, available: Collection<ConfigurableToolDescriptor>): ApplicationConfigurationDocument {
        val catalog = available.associateBy { it.id }.toSortedMap()
        val platform = document.toolPolicy
        val platformWasInitialized = platform.enabled != null
        val switches = platform.enabled.orEmpty().toMutableMap()
        catalog.values.forEach { tool ->
            val legacyEligible = resolver.legacyAllows(platform, tool)
            val initial = when {
                platform.enabled?.containsKey(tool.id) == true -> platform.enabled.getValue(tool.id)
                platform.enabled?.isEmpty() == true -> false
                platformWasInitialized -> tool.defaultEnabled
                else -> tool.defaultEnabled || document.agents.any {
                    (it.toolPolicy.enabled?.get(tool.id) == true || (it.toolPolicy.enabled == null && tool.id in it.toolPolicy.allow)) &&
                        resolver.legacyAllows(it.toolPolicy, tool)
                }
            }
            switches[tool.id] = initial && legacyEligible
        }
        // Keep dormant explicit choices for temporarily absent MCP/plugin tools.
        (platform.allow + platform.deny).forEach { id ->
            if (id !in catalog) switches[id] = id !in platform.deny && (platform.allow.isEmpty() || id in platform.allow)
        }
        switches.keys.filter { it !in catalog }.forEach { id ->
            if (id in platform.deny || (platform.allow.isNotEmpty() && id !in platform.allow) || platform.allowedRiskLevels.isEmpty()) switches[id] = false
        }
        val agents = document.agents.map { agent ->
            val policy = agent.toolPolicy
            val agentSwitches = policy.enabled.orEmpty().toMutableMap()
            catalog.values.forEach { tool ->
                // Preserve each Agent's own legacy selection, including one Agent's default-off
                // opt-in without silently enabling the same tool for every other legacy Agent.
                val ownChoice = resolver.agentAllows(policy, tool, platformWasInitialized)
                val explicitRestriction = !resolver.legacyAllows(policy, tool)
                val preserveCurrentOff = !ownChoice && switches[tool.id] == true
                if (explicitRestriction || preserveCurrentOff || policy.enabled?.containsKey(tool.id) == true) {
                    agentSwitches[tool.id] = ownChoice
                }
            }
            (policy.allow + policy.deny).forEach { id ->
                if (id !in catalog) agentSwitches[id] = id !in policy.deny && (policy.allow.isEmpty() || id in policy.allow)
            }
            agentSwitches.keys.filter { it !in catalog }.forEach { id ->
                if (id in policy.deny || (policy.allow.isNotEmpty() && id !in policy.allow) || policy.allowedRiskLevels.isEmpty()) agentSwitches[id] = false
            }
            agent.copy(toolPolicy = switchesOnly(agentSwitches, policy.minimumPermissionGroups))
        }
        return document.copy(toolPolicy = switchesOnly(switches), agents = agents)
    }

    private fun switchesOnly(
        enabled: Map<String, Boolean>,
        minimumPermissionGroups: Map<String, com.heyanle.priestess.bot.pipeline.PermissionGroup> = emptyMap(),
    ) = ToolPolicyDocument(
        enabled = enabled.toSortedMap(),
        minimumPermissionGroups = minimumPermissionGroups.toSortedMap(),
        allow = emptyList(), deny = emptyList(), allowedRiskLevels = ToolRiskLevel.entries,
    )
}
