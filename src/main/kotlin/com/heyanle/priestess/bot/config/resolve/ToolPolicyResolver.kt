package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.tool.ToolRiskLevel

data class ConfigurableToolDescriptor(
    val id: String,
    val riskLevel: ToolRiskLevel,
    val defaultEnabled: Boolean = true,
)

class ToolPolicyResolver {
    /** Initialized switches never consult tool defaults. Legacy policy is normalized before publication. */
    fun resolveApplication(
        available: Collection<ConfigurableToolDescriptor>,
        platformPolicy: ToolPolicyDocument,
        agentPolicy: ToolPolicyDocument,
    ): Set<String> {
        return available.filter {
            (platformPolicy.enabled?.get(it.id) ?: (platformPolicy.enabled == null)) &&
                legacyAllows(platformPolicy, it) &&
                agentAllows(agentPolicy, it, platformPolicy.enabled != null)
        }.mapTo(sortedSetOf()) { it.id }
    }

    internal fun legacyAllows(policy: ToolPolicyDocument, tool: ConfigurableToolDescriptor): Boolean =
        (policy.allow.isEmpty() || tool.id in policy.allow) &&
            tool.id !in policy.deny && tool.riskLevel in policy.allowedRiskLevels

    internal fun agentAllows(policy: ToolPolicyDocument, tool: ConfigurableToolDescriptor, initializedPlatform: Boolean): Boolean =
        (policy.enabled?.get(tool.id) ?: if (policy.enabled != null || initializedPlatform || policy.allow.isNotEmpty()) true else tool.defaultEnabled) &&
            legacyAllows(policy, tool)

    fun resolve(
        available: Collection<ConfigurableToolDescriptor>,
        workspacePolicy: ToolPolicyDocument,
        agentPolicy: ToolPolicyDocument,
        permissionAllowedRiskLevels: Set<ToolRiskLevel> = ToolRiskLevel.entries.toSet(),
        permissionAllowedToolIds: Set<String>? = null,
    ): Set<String> {
        val byId = available.associateBy { it.id }
        var selected = if (workspacePolicy.allow.isEmpty()) {
            byId.values.filter { it.defaultEnabled }.mapTo(linkedSetOf()) { it.id }
        } else {
            byId.keys.intersect(workspacePolicy.allow.toSet())
        }
        selected -= workspacePolicy.deny.toSet()
        selected = selected.filterTo(linkedSetOf()) { byId.getValue(it).riskLevel in workspacePolicy.allowedRiskLevels }
        selected = applyNamedPolicy(selected, agentPolicy)
        selected = selected.filterTo(linkedSetOf()) { byId.getValue(it).riskLevel in agentPolicy.allowedRiskLevels }
        selected = selected.filterTo(linkedSetOf()) { byId.getValue(it).riskLevel in permissionAllowedRiskLevels }
        if (permissionAllowedToolIds != null) selected = selected.intersect(permissionAllowedToolIds)
        return selected.toSortedSet()
    }

    private fun applyNamedPolicy(input: Set<String>, policy: ToolPolicyDocument): Set<String> {
        val allowed = if (policy.allow.isEmpty()) input else input.intersect(policy.allow.toSet())
        return allowed - policy.deny.toSet()
    }
}
