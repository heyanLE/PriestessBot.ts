package com.heyanle.priestess.bot.tool

import kotlinx.serialization.Serializable

/**
 * Result returned from a tool execution.
 */
@Serializable
data class ToolResult(
    val success: Boolean,
    val output: String = "",
    val error: String = "",
    val errorCode: String? = null,
    val policyDenialCode: ToolPolicyDenialCode? = null,
    val missingCapabilities: List<String> = emptyList(),
) {
    companion object {
        fun success(output: String) = ToolResult(success = true, output = output)
        fun error(message: String, errorCode: String? = null) = ToolResult(
            success = false,
            error = message,
            errorCode = errorCode,
        )

        fun timeout(toolName: String, timeoutMillis: Long): ToolResult = ToolResult(
            success = false,
            error = "Tool '$toolName' timed out after ${timeoutMillis.coerceAtLeast(1)}ms",
            errorCode = "TIMEOUT",
        )

        fun permissionDenied(decision: ToolPolicyDecision): ToolResult {
            val code = decision.code ?: ToolPolicyDenialCode.DISABLED_TOOL
            val message = decision.message.ifBlank { "Permission denied" }
            return ToolResult(
                success = false,
                error = "PERMISSION_DENIED[$code]: $message",
                errorCode = "PERMISSION_DENIED",
                policyDenialCode = code,
                missingCapabilities = decision.missingCapabilities,
            )
        }
    }
}
