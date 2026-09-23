package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentHooks
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolResultMaterializer
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore

/**
 * The task Agent's runner: it dispatches each step's consecutive parallel-safe tool calls concurrently
 * instead of one at a time.
 *
 * It shares the whole loop, the prompt assembly and the tool-execution collaborator with [ReActRunner];
 * the only difference is the scheduler, so the two cannot drift apart in how they run a step or record a
 * trace. A tool opts in through `ToolSchema.parallelSafe`, and anything that does not stays exclusive and
 * ordered.
 */
class HarnessRunner(
    context: AgentContext,
    provider: ChatProvider,
    toolCase: ToolCase,
    contextManager: ContextManager,
    overflowStore: ToolResultOverflowStore = ToolResultOverflowStore(),
    resultMaterializer: ToolResultMaterializer = ToolResultMaterializer(overflowStore),
    hooks: AgentHooks? = null,
    maxParallelToolCalls: Int = DEFAULT_MAX_PARALLEL_TOOL_CALLS,
) : ReActRunner(
    context = context,
    provider = provider,
    toolCase = toolCase,
    contextManager = contextManager,
    overflowStore = overflowStore,
    resultMaterializer = resultMaterializer,
    hooks = hooks,
    toolScheduler = ParallelSafeToolCallScheduler(
        maxConcurrent = maxParallelToolCalls,
        parallelSafe = { call -> declaresParallelSafety(context, toolCase, call) },
    ),
) {
    companion object {
        /** Matches the reference implementation's `maxParallelToolCalls` default. */
        const val DEFAULT_MAX_PARALLEL_TOOL_CALLS: Int = 10

        private fun declaresParallelSafety(context: AgentContext, toolCase: ToolCase, call: ToolCall): Boolean =
            resolve(context, toolCase, call.name)?.schema?.parallelSafe ?: false

        private fun resolve(context: AgentContext, toolCase: ToolCase, name: String): FunctionTool? =
            context.scopedTools.firstOrNull { it.schema.name == name } ?: toolCase.get(name)
    }
}
