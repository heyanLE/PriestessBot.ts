package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.RegisteredTool
import com.heyanle.priestess.bot.tool.ToolListing
import com.heyanle.priestess.bot.tool.ToolListingFilters
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.ToolSource
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ListToolsTool(
    private val registeredToolsProvider: () -> List<RegisteredTool>,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "list_tools",
        description = "List tools visible to the current agent with policy metadata and optional filters.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("enabled", type = "boolean", description = "Filter by effective enabled state."),
                ParameterDef(
                    name = "source",
                    description = "Filter by tool source.",
                    enumValues = ToolSource.entries.map { it.name.lowercase() },
                ),
                ParameterDef(
                    name = "risk_level",
                    description = "Filter by tool risk level.",
                    enumValues = ToolRiskLevel.entries.map { it.name },
                ),
                ParameterDef(
                    name = "include_high_risk",
                    type = "boolean",
                    description = "Include HIGH_RISK tools in the listing.",
                ),
                ParameterDef("query", description = "Text query matched against tool name and description."),
            ),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = emptyList(),
        defaultEnabled = true,
        auditLog = false,
    )

    private val json = Json {
        encodeDefaults = true
        prettyPrint = true
    }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val filters = ToolListingFilters(
            enabled = args["enabled"]?.toBooleanStrictOrNull(),
            source = args["source"]?.let(::parseSource),
            riskLevel = args["risk_level"]?.let(::parseRiskLevel),
            includeHighRisk = args["include_high_risk"]?.toBooleanStrictOrNull() ?: false,
            query = args["query"].orEmpty(),
        )
        val items = ToolListing.list(registeredToolsProvider(), filters)
        return ToolResult.success(json.encodeToString(ListToolsResponse(items)))
    }

    private fun parseSource(value: String): ToolSource? {
        return ToolSource.entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
    }

    private fun parseRiskLevel(value: String): ToolRiskLevel? {
        return ToolRiskLevel.entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
    }
}

@Serializable
data class ListToolsResponse(
    val tools: List<com.heyanle.priestess.bot.tool.ToolListingItem>,
)
