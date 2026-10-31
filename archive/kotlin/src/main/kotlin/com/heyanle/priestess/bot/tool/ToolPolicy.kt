package com.heyanle.priestess.bot.tool

fun interface ToolPolicy {
    fun check(context: AgentToolContext, tool: FunctionTool, args: Map<String, String>): ToolPolicyDecision

    companion object {
        fun allowAll(): ToolPolicy = ToolPolicy { _, tool, _ ->
            ToolPolicyDecision.allowed(tool.schema.auditLog)
        }

        fun configured(config: ToolPolicyConfig): ToolPolicy = ConfiguredToolPolicy(config)
    }
}

data class ToolPolicyConfig(
    val enabledTools: Set<String>? = null,
    val disabledTools: Set<String> = emptySet(),
    val allowedRiskLevels: Set<ToolRiskLevel> = ToolRiskLevel.entries.toSet(),
    val availableCapabilities: Set<String> = emptySet(),
    val confirmedTools: Set<String> = emptySet(),
)

class ConfiguredToolPolicy(
    private val config: ToolPolicyConfig,
) : ToolPolicy {
    override fun check(context: AgentToolContext, tool: FunctionTool, args: Map<String, String>): ToolPolicyDecision {
        val schema = tool.schema
        if (schema.name in config.disabledTools) {
            return ToolPolicyDecision.denied(
                code = ToolPolicyDenialCode.DISABLED_TOOL,
                message = "Tool '${schema.name}' is disabled",
                auditLog = schema.auditLog,
            )
        }
        if (config.enabledTools != null && schema.name !in config.enabledTools) {
            return ToolPolicyDecision.denied(
                code = ToolPolicyDenialCode.DISABLED_TOOL,
                message = "Tool '${schema.name}' is not enabled",
                auditLog = schema.auditLog,
            )
        }
        if (schema.riskLevel !in config.allowedRiskLevels) {
            return ToolPolicyDecision.denied(
                code = ToolPolicyDenialCode.DISALLOWED_RISK,
                message = "Tool '${schema.name}' risk level ${schema.riskLevel} is not allowed",
                auditLog = schema.auditLog,
            )
        }
        val missingCapabilities = schema.requiredCapabilities.filter { capability ->
            !isCapabilityAvailable(capability, context)
        }
        if (missingCapabilities.isNotEmpty()) {
            return ToolPolicyDecision.denied(
                code = ToolPolicyDenialCode.MISSING_CAPABILITY,
                message = "Tool '${schema.name}' missing required capabilities: ${missingCapabilities.joinToString()}",
                missingCapabilities = missingCapabilities,
                auditLog = schema.auditLog,
            )
        }
        if (schema.riskLevel == ToolRiskLevel.HIGH_RISK && schema.name !in config.confirmedTools) {
            return ToolPolicyDecision.denied(
                code = ToolPolicyDenialCode.CONFIRMATION_REQUIRED,
                message = "Tool '${schema.name}' requires confirmation",
                auditLog = schema.auditLog,
            )
        }
        return ToolPolicyDecision.allowed(schema.auditLog)
    }

    private fun isCapabilityAvailable(capability: String, context: AgentToolContext): Boolean {
        return when (capability) {
            ToolCapabilities.PLATFORM -> context.platform != null || capability in config.availableCapabilities
            ToolCapabilities.SESSION -> context.session != null || capability in config.availableCapabilities
            else -> capability in config.availableCapabilities
        }
    }
}

data class ToolPolicyDecision(
    val allowed: Boolean,
    val code: ToolPolicyDenialCode? = null,
    val message: String = "",
    val missingCapabilities: List<String> = emptyList(),
    val auditLog: Boolean = false,
) {
    val reason: String
        get() = message

    companion object {
        fun allowed(auditLog: Boolean = false): ToolPolicyDecision = ToolPolicyDecision(
            allowed = true,
            auditLog = auditLog,
        )

        fun denied(
            code: ToolPolicyDenialCode,
            message: String,
            missingCapabilities: List<String> = emptyList(),
            auditLog: Boolean = false,
        ): ToolPolicyDecision = ToolPolicyDecision(
            allowed = false,
            code = code,
            message = message,
            missingCapabilities = missingCapabilities,
            auditLog = auditLog,
        )
    }
}

enum class ToolPolicyDenialCode {
    DISABLED_TOOL,
    DISALLOWED_RISK,
    MISSING_CAPABILITY,
    UNAVAILABLE_DEPENDENCY,
    CONFIRMATION_REQUIRED,
    INSUFFICIENT_PERMISSION,
}

typealias ToolPermission = ToolPolicyDecision
