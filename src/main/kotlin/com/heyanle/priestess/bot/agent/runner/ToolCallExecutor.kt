package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentHooks
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.observability.trace.TraceCategory
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolResultMaterialization
import com.heyanle.priestess.bot.tool.ToolResultMaterializationConfig
import com.heyanle.priestess.bot.tool.ToolResultMaterializer
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One executed tool call: the canonical result, the provider-visible observation, and the duration. */
data class ToolCallOutcome(
    val call: ToolCall,
    val result: ToolResult,
    val observation: String,
    val durationMillis: Long,
)

/**
 * Executes one tool call and derives the observation the provider will see.
 *
 * Every runner shares this so that materialization, overflow spilling, hook dispatch and trace recording
 * have exactly one implementation. Executing and appending are deliberately separate: a scheduler may run
 * several calls concurrently, but their observations must still be appended in submission order.
 */
class ToolCallExecutor(
    private val toolCase: ToolCase,
    private val resultMaterializer: ToolResultMaterializer,
) {
    suspend fun execute(
        context: AgentContext,
        toolContext: AgentToolContext,
        call: ToolCall,
        step: Int,
        hooks: AgentHooks?,
    ): ToolCallOutcome {
        hooks?.onToolStart(context, call.name, call.arguments)
        context.executionTrace?.toolCall(step, call.id, call.name, call.arguments)
        val started = System.nanoTime()
        val result = try {
            toolCase.execute(toolContext, call.name, call.arguments, context.agent.toolTimeoutMs)
        } catch (e: CancellationException) {
            context.executionTrace?.record(TraceCategory.TOOL, "tool.cancelled", buildJsonObject {
                put("callId", call.id); put("name", call.name)
            }, step = step, durationMillis = (System.nanoTime() - started) / 1_000_000)
            throw e
        } catch (e: Exception) {
            // A failing tool is a recorded failure, never a failed step: siblings still complete.
            ToolResult(
                success = false,
                error = "Tool execution failed: ${e.message}",
                errorCode = "TOOL_EXECUTION_FAILED",
            )
        }
        val durationMillis = (System.nanoTime() - started) / 1_000_000
        val observation = materialize(context, call, result)
        context.executionTrace?.toolResult(step, call.id, call.name, result, observation, durationMillis)
        return ToolCallOutcome(call, result, observation, durationMillis)
    }

    /** Appends the observation and reports completion. Call in submission order. */
    suspend fun appendObservation(context: AgentContext, outcome: ToolCallOutcome, hooks: AgentHooks?) {
        context.messages.add(
            ConversationMessage.tool(
                toolCallId = outcome.call.id,
                name = outcome.call.name,
                content = outcome.observation,
            ),
        )
        hooks?.onToolEnd(
            context,
            outcome.call.name,
            AgentResponse.ToolExecuted(
                toolCallId = outcome.call.id,
                toolName = outcome.call.name,
                toolResult = outcome.result,
            ),
        )
    }

    /** Whether the named tool declared itself safe to run beside its siblings. */
    fun parallelSafe(context: AgentContext, call: ToolCall): Boolean =
        resolve(context, call.name)?.schema?.parallelSafe ?: false

    private fun resolve(context: AgentContext, name: String): FunctionTool? =
        context.scopedTools.firstOrNull { it.schema.name == name } ?: toolCase.get(name)

    private fun materialize(context: AgentContext, call: ToolCall, result: ToolResult): String {
        val rawContent = if (result.success) result.output else result.error
        val tool = resolve(context, call.name)
        if (tool?.resultMaterialization == ToolResultMaterialization.INLINE) return rawContent
        return resultMaterializer.materialize(
            conversationId = context.conversationId,
            result = result,
            config = ToolResultMaterializationConfig(
                inlineTokens = context.agent.toolResultInlineTokens,
                previewTokens = context.agent.toolResultPreviewTokens,
                ttlSeconds = context.agent.toolResultTtlSeconds,
                maxResultBytes = context.agent.toolResultMaxBytes,
                maxTotalBytes = context.agent.toolResultStoreMaxBytes,
            ),
        )
    }
}
