package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.tool.ToolPolicyDenialCode

class UseSkillTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "use_skill",
        description = "Load a workspace skill document into the current pipeline context for later LLM turns.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("name", description = "Skill name to load.", required = true),
            ),
            required = listOf("name"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val name = args["name"]?.trim().orEmpty()
        if (name.isBlank()) {
            return ToolResult.error("name is required", "VALIDATION_ERROR")
        }
        val required = context.skillState.requiredPermissionFor(name)
        if (required != null && !context.permissionGroup.satisfies(required)) {
            return ToolResult.error(
                "PERMISSION_DENIED[${ToolPolicyDenialCode.INSUFFICIENT_PERMISSION}]: " +
                    (context.metadata["permissionDeniedMessage"] ?: "抱歉，当前权限不足，无法执行此操作。") +
                    " current=${context.permissionGroup} required=$required",
                "PERMISSION_DENIED",
            )
        }
        val loaded = context.skillState.load(name)
            ?: return ToolResult.error(
                "Skill '$name' is not available. Available skills: ${context.skillState.availableNames.joinToString(", ")}",
                "SKILL_NOT_FOUND",
            )
        return ToolResult.success("Loaded skill '${loaded.name}' into the current pipeline context.")
    }
}

class UnloadSkillTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "unload_skill",
        description = "Unload a skill document from the current pipeline context.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("name", description = "Skill name to unload.", required = true),
            ),
            required = listOf("name"),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val name = args["name"]?.trim().orEmpty()
        if (name.isBlank()) {
            return ToolResult.error("name is required", "VALIDATION_ERROR")
        }
        return if (context.skillState.unload(name)) {
            ToolResult.success("Unloaded skill '$name' from the current pipeline context.")
        } else {
            ToolResult.error("Skill '$name' was not loaded.", "SKILL_NOT_LOADED")
        }
    }
}
