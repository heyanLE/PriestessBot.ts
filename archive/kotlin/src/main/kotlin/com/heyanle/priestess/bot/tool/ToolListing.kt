package com.heyanle.priestess.bot.tool

import kotlinx.serialization.Serializable

@Serializable
data class ToolListingItem(
    val name: String,
    val description: String,
    val source: ToolSource,
    val owner: String? = null,
    val riskLevel: ToolRiskLevel,
    val requiredCapabilities: List<String>,
    val defaultEnabled: Boolean,
    val effectiveEnabled: Boolean,
    val auditLog: Boolean,
    val statusReason: String? = null,
)

data class ToolListingFilters(
    val enabled: Boolean? = null,
    val source: ToolSource? = null,
    val riskLevel: ToolRiskLevel? = null,
    val includeHighRisk: Boolean = false,
    val query: String = "",
)

object ToolListing {
    fun list(
        registeredTools: List<RegisteredTool>,
        filters: ToolListingFilters = ToolListingFilters(),
    ): List<ToolListingItem> {
        val normalizedQuery = filters.query.trim().lowercase()
        return registeredTools
            .asSequence()
            .map { it.toListingItem() }
            .filter { filters.enabled == null || it.effectiveEnabled == filters.enabled }
            .filter { filters.source == null || it.source == filters.source }
            .filter { filters.riskLevel == null || it.riskLevel == filters.riskLevel }
            .filter { filters.includeHighRisk || it.riskLevel != ToolRiskLevel.HIGH_RISK }
            .filter {
                normalizedQuery.isBlank() ||
                    it.name.lowercase().contains(normalizedQuery) ||
                    it.description.lowercase().contains(normalizedQuery)
            }
            .sortedWith(compareBy<ToolListingItem> { it.source.name }.thenBy { it.name })
            .toList()
    }

    private fun RegisteredTool.toListingItem(): ToolListingItem {
        val schema = tool.schema
        val statusReason = metadata.statusReason
        return ToolListingItem(
            name = schema.name,
            description = schema.description,
            source = metadata.source,
            owner = metadata.owner,
            riskLevel = schema.riskLevel,
            requiredCapabilities = schema.requiredCapabilities,
            defaultEnabled = schema.defaultEnabled,
            effectiveEnabled = statusReason == null,
            auditLog = schema.auditLog,
            statusReason = statusReason,
        )
    }
}
