package com.heyanle.priestess.bot.tool.mcp

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Wraps an MCP server tool as a [FunctionTool].
 *
 * This makes MCP tools transparent to the Agent — they appear
 * and behave exactly like built-in tools. Execution is delegated
 * to the [McpClient.callTool] method.
 */
class McpTool(
    private val client: McpClient,
    private val toolDef: McpToolDef,
) : FunctionTool() {

    override val schema: ToolSchema by lazy {
        buildSchema()
    }

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

            val result = client.callTool(toolDef.name, arguments)
            ToolResult.success(result)
        } catch (e: Exception) {
            ToolResult.error("MCP tool '${toolDef.name}' execution failed: ${e.message}")
        }
    }

    private fun buildSchema(): ToolSchema {
        val parameters = parseParameters()

        return ToolSchema(
            name = toolDef.name,
            description = toolDef.description,
            parameters = parameters,
            riskLevel = ToolRiskLevel.SAFE_READ,
            requiredCapabilities = listOf(ToolCapabilities.MCP),
            defaultEnabled = false,
            auditLog = true,
        )
    }

    private fun parseParameters(): ToolParameters {
        val schema = toolDef.inputSchema ?: return ToolParameters()

        val required = schema["required"]?.jsonArray?.map {
            it.jsonPrimitive.content
        } ?: emptyList()

        val properties = schema["properties"]?.jsonObject ?: return ToolParameters(
            properties = emptyList(),
            required = required,
        )

        val paramDefs = properties.entries.map { (name, propValue) ->
            val propObj = propValue.jsonObject
            val type = propObj["type"]?.jsonPrimitive?.content ?: "string"
            val description = propObj["description"]?.jsonPrimitive?.content ?: ""
            val enumValues = propObj["enum"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
            val items = propObj["items"]?.jsonObject?.get("type")?.jsonPrimitive?.content

            ParameterDef(
                name = name,
                type = type,
                description = description,
                required = name in required,
                enumValues = enumValues,
                items = items,
            )
        }

        return ToolParameters(
            properties = paramDefs,
            required = required,
        )
    }
}
