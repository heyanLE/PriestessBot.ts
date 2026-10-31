package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema

/**
 * 健康检查工具，返回服务端门面提供的非敏感运行时健康摘要。
 */
class HealthCheckTool(
    private val healthSnapshotProvider: () -> String,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "health_check",
        description = "Return a non-sensitive runtime health summary aligned with Dashboard health.",
        parameters = ToolParameters(),
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = emptyList(),
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        return ToolResult.success(healthSnapshotProvider())
    }
}
