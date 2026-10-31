package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class WorkspaceMcpToolAdapter(
    private val serverId: String,
    private val client: WorkspaceMcpClientSession,
    private val toolDef: com.heyanle.priestess.bot.tool.mcp.McpToolDef,
) : FunctionTool() {
    override val schema: ToolSchema by lazy { buildSchema() }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        if (!client.isConnected) {
            return ToolResult.error("MCP client is not connected")
        }

        return try {
            val arguments = buildJsonObject {
                for ((key, value) in args) {
                    put(key, value)
                }
            }
            ToolResult.success(client.callTool(toolDef.name, arguments))
        } catch (e: Exception) {
            ToolResult.error("MCP tool '$serverId.${toolDef.name}' execution failed: ${e.message}")
        }
    }

    private fun buildSchema(): ToolSchema {
        val required = toolDef.inputSchema?.get("required")?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        val properties = toolDef.inputSchema?.get("properties")?.jsonObject
        val paramDefs = properties?.entries?.map { (name, propValue) ->
            val propObj = propValue.jsonObject
            ParameterDef(
                name = name,
                type = propObj["type"]?.jsonPrimitive?.content ?: "string",
                description = propObj["description"]?.jsonPrimitive?.content ?: "",
                required = name in required,
                enumValues = propObj["enum"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty(),
                items = propObj["items"]?.jsonObject?.get("type")?.jsonPrimitive?.content,
            )
        }.orEmpty()

        return ToolSchema(
            name = "$serverId.${toolDef.name}",
            description = toolDef.description,
            parameters = ToolParameters(properties = paramDefs, required = required),
            riskLevel = ToolRiskLevel.SAFE_READ,
            requiredCapabilities = listOf(ToolCapabilities.MCP),
            defaultEnabled = false,
            auditLog = true,
        )
    }
}

