package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.observability.trace.TraceCategory
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolResult
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** Immutable per-turn tool authorization; ToolCase rechecks policy and arguments at execution. */
internal class CodexToolDispatcher(
    private val context: AgentContext,
    private val toolCase: ToolCase,
) {
    private val allowed: Map<String, FunctionTool> = (toolCase.getAll() + context.scopedTools)
        .distinctBy { it.schema.name }
        .filter { tool ->
            val name = tool.schema.name
            val permission = maxOf(tool.schema.requiredPermissionGroup,
                context.agent.minimumToolPermissionGroups[name] ?: com.heyanle.priestess.bot.pipeline.PermissionGroup.OPERATOR)
            name != "unload_skill" &&
                (context.agent.effectiveToolIds == null || name in context.agent.effectiveToolIds) &&
                name !in context.agent.deniedToolIds &&
                tool.schema.riskLevel in context.agent.allowedRiskLevels &&
                context.permissionGroup.satisfies(permission)
        }
        .associateBy { it.schema.name }

    init {
        val collisions = allowed.keys intersect NATIVE_TOOL_NAMES
        require(collisions.isEmpty()) { "Codex native tool names collide with Agent tools: ${collisions.sorted()}" }
    }

    val dynamicTools: JsonArray = buildJsonArray {
        allowed.values.forEach { tool ->
            val function = tool.schema.toOpenAIFormat()["function"]!!.jsonObject
            add(buildJsonObject {
                put("type", "function")
                put("name", tool.schema.name)
                put("description", tool.schema.description)
                put("inputSchema", function["parameters"]!!)
            })
        }
    }

    fun isAllowed(name: String): Boolean = name in allowed

    suspend fun execute(callId: String, name: String, arguments: JsonObject): ToolResult {
        if (name !in allowed) return ToolResult.error("Tool unavailable for this turn")
        context.executionTrace?.record(TraceCategory.TOOL, "codex.tool.call", buildJsonObject {
            put("callId", callId); put("name", name); put("argumentBytes", arguments.toString().length)
        })
        val startedAt = System.nanoTime()
        val names = allowed.keys.sorted().joinToString(",")
        val toolContext = AgentToolContext(
            conversationId = context.conversationId,
            platform = context.platform,
            session = context.session,
            agentName = context.agent.name,
            model = context.agent.model,
            metadata = context.metadata + ("workspaceToolNames" to names),
            scopedTools = context.scopedTools.filter { it.schema.name in allowed },
            skillState = context.skillState,
            permissionGroup = context.permissionGroup,
            minimumToolPermissionGroups = context.agent.minimumToolPermissionGroups,
            responseIntent = context.responseIntent,
        )
        val executed = toolCase.execute(toolContext, name, arguments.toString(), context.agent.toolTimeoutMs)
        val result = if (name == "use_skill" && executed.success) {
            val skillName = arguments["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val document = context.skillState.peek(skillName)
            if (document == null) ToolResult.error("Loaded skill is no longer available") else {
                val content = buildString {
                    append("Skill: ").append(document.name)
                    document.sourcePath?.let { append("\nSource: ").append(it) }
                    append("\n\n").append(document.markdown)
                }
                if (content.length > MAX_SKILL_CHARS) ToolResult.error("Skill document exceeds the Codex tool result limit")
                else ToolResult.success(content)
            }
        } else executed
        return result.also {
            context.executionTrace?.record(TraceCategory.TOOL, "codex.tool.result", buildJsonObject {
                put("callId", callId); put("name", name); put("success", result.success)
                put("resultBytes", (if (result.success) result.output else result.error).length)
            }, durationMillis = (System.nanoTime() - startedAt).coerceAtLeast(0) / 1_000_000)
        }
    }

    companion object {
        internal val NATIVE_TOOL_NAMES = setOf("exec_command", "apply_patch", "view_image", "web_search")
        private const val MAX_SKILL_CHARS = 60_000
    }
}
