package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.annotation.Tool

/**
 * System information tool. Returns runtime status and available tools.
 */
@Tool(name = "system_info", description = "Get current system status, agent info, and available tools")
class SystemInfoTool(
    private val toolListProvider: () -> List<String> = { emptyList() },
) : FunctionTool() {

    override val schema = ToolSchema(
        name = "system_info",
        description = "Get information about the current system status, agent, model, available tools, and runtime metrics.",
        parameters = ToolParameters(properties = emptyList(), required = emptyList()),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val sb = StringBuilder()
        sb.appendLine("=== PriestessBot System Info ===")
        sb.appendLine()
        sb.appendLine("Agent: ${context.agentName.ifBlank { "assistant" }}, Model: ${context.model.ifBlank { "N/A" }}")
        sb.appendLine()

        context.platform?.let {
            sb.appendLine("Platform: ${it.metadata.name} (${it.metadata.displayName})")
            sb.appendLine("  Streaming: ${it.metadata.supportStreaming}, Proactive: ${it.metadata.supportProactiveMessage}")
            sb.appendLine()
        }
        context.session?.let {
            sb.appendLine("Session: ${it.id} (${it.type}, ${it.platformName})")
            sb.appendLine()
        }

        val tools = toolListProvider()
        sb.appendLine("Available Tools (${tools.size}): ${tools.sorted().ifEmpty { listOf("(none)") }.joinToString()}")
        sb.appendLine()

        val rt = Runtime.getRuntime()
        val used = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024)
        val max = rt.maxMemory() / (1024 * 1024)
        sb.appendLine("Runtime: ${used}MB/${max}MB, ${rt.availableProcessors()} CPUs, Java ${System.getProperty("java.version")}")

        return ToolResult.success(sb.toString())
    }
}
