package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.observability.ObservabilityCase
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import com.heyanle.priestess.bot.pipeline.PermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionMessageContext
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * 工具执行器，负责解析工具名、校验参数、执行工具并记录调用指标。
 */
class ToolExecutor(
    private val registry: ToolController,
    private val observabilityCase: ObservabilityCase = ObservabilityCase.standalone(),
    private val policy: ToolPolicy = ToolPolicy.allowAll(),
    private val defaultTimeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS,
    private val permissionDeniedMessageResolver: PermissionDeniedMessageResolver = PermissionDeniedMessageResolver.Default,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * 执行单个工具调用。
     *
     * @param context 智能体工具上下文。
     * @param toolCallName 工具调用名称。
     * @param argumentsJson LLM 工具调用传入的 JSON 参数。
     * @return 带成功或错误状态的工具结果。
     */
    suspend fun execute(
        context: AgentToolContext,
        toolCallName: String,
        argumentsJson: String,
        timeoutMillis: Long = defaultTimeoutMillis,
    ): ToolResult {
        val tool = context.scopedTools.firstOrNull { it.schema.name == toolCallName }
            ?: registry.get(toolCallName)
            ?: return ToolResult.error("Unknown tool: $toolCallName").also {
                recordToolCall(toolCallName, "error")
            }
        val workspaceAllowedTools = workspaceToolNames(context)
        if (workspaceAllowedTools != null && tool.schema.name !in workspaceAllowedTools) {
            return ToolResult.permissionDenied(
                ToolPolicyDecision.denied(
                    code = ToolPolicyDenialCode.DISABLED_TOOL,
                    message = "Tool '${tool.schema.name}' is not enabled in workspace",
                    auditLog = tool.schema.auditLog,
                ),
            ).also {
                recordToolCall(tool.schema.name, "permission_denied")
            }
        }

        val args = try {
            parseArguments(argumentsJson)
        } catch (e: Exception) {
            return ToolResult.error("Failed to parse arguments for tool '$toolCallName': ${e.message}").also {
                recordToolCall(tool.schema.name, "error")
            }
        }

        val validationError = validateArguments(tool, args)
        if (validationError != null) {
            return ToolResult.error(validationError).also {
                recordToolCall(tool.schema.name, "error")
            }
        }

        val requiredPermissionGroup = maxOf(
            tool.schema.requiredPermissionGroup,
            context.minimumToolPermissionGroups[tool.schema.name] ?: PermissionGroup.OPERATOR,
        )
        if (!context.permissionGroup.satisfies(requiredPermissionGroup)) {
            return ToolResult.permissionDenied(
                ToolPolicyDecision.denied(
                    code = ToolPolicyDenialCode.INSUFFICIENT_PERMISSION,
                    message = permissionDeniedMessageResolver.resolve(
                        PermissionMessageContext(
                            workspaceId = context.metadata["workspaceId"].orEmpty(),
                            agentName = context.agentName,
                        ),
                    ) + " current=${context.permissionGroup} required=$requiredPermissionGroup",
                    auditLog = tool.schema.auditLog,
                ),
            ).also { recordToolCall(tool.schema.name, "permission_denied") }
        }

        val decision = policy.check(context, tool, args)
        if (!decision.allowed) {
            return ToolResult.permissionDenied(decision).also {
                recordToolCall(tool.schema.name, "permission_denied")
            }
        }

        return try {
            withTimeout(timeoutMillis.coerceAtLeast(1)) {
                tool.execute(context, args)
            }.also {
                recordToolCall(tool.schema.name, if (it.success) "success" else "error")
            }
        } catch (e: TimeoutCancellationException) {
            currentCoroutineContext().ensureActive()
            ToolResult.timeout(toolCallName, timeoutMillis).also {
                recordToolCall(tool.schema.name, "timeout")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ToolResult.error("Tool '$toolCallName' execution failed: ${e.message}").also {
                recordToolCall(tool.schema.name, "error")
            }
        }
    }

    private fun validateArguments(tool: FunctionTool, args: Map<String, String>): String? {
        val missing = tool.schema.parameters.required.filter { it !in args || args[it].isNullOrBlank() }
        if (missing.isNotEmpty()) {
            return "Missing required parameter(s) for tool '${tool.schema.name}': ${missing.joinToString()}"
        }
        return null
    }

    /**
     * 按顺序执行多个工具调用。
     *
     * @param context 智能体工具上下文。
     * @param toolCalls (工具调用 ID、工具名、参数 JSON) 三元组列表。
     * @return 工具调用 ID 到执行结果的映射。
     */
    suspend fun executeBatch(
        context: AgentToolContext,
        toolCalls: List<Triple<String, String, String>>, // (id, name, arguments)
        timeoutMillis: Long = defaultTimeoutMillis,
    ): Map<String, ToolResult> {
        val results = mutableMapOf<String, ToolResult>()
        for ((id, name, arguments) in toolCalls) {
            results[id] = execute(context, name, arguments, timeoutMillis)
        }
        return results
    }

    private fun recordToolCall(toolName: String, status: String) {
        observabilityCase.recordToolCall(toolName, status)
    }

    private fun workspaceToolNames(context: AgentToolContext): Set<String>? {
        val raw = context.metadata["workspaceToolNames"]
            ?: context.metadata["workspace_tool_names"]
            ?: return null
        return raw.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toSet()
    }

    /**
     * 把 JSON 参数字符串解析为字符串键值表。
     */
    private fun parseArguments(argumentsJson: String): Map<String, String> {
        if (argumentsJson.isBlank()) return emptyMap()

        val jsonElement = json.parseToJsonElement(argumentsJson)
        val jsonObj = jsonElement.jsonObject

        val result = mutableMapOf<String, String>()
        for ((key, value) in jsonObj) {
            // 将 JSON 值统一转换为字符串形式。
            result[key] = when {
                value.toString().startsWith("\"") -> {
                    // 字符串值去掉外层引号。
                    value.toString().removeSurrounding("\"")
                }
                else -> value.toString()
            }
        }
        return result
    }

    companion object {
        const val DEFAULT_TIMEOUT_MILLIS = 30_000L
    }
}
