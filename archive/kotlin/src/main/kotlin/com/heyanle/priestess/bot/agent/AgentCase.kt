package com.heyanle.priestess.bot.agent

import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry
import com.heyanle.priestess.bot.agent.preset.AgentRunnerKind
import com.heyanle.priestess.bot.agent.runner.HarnessRunner
import com.heyanle.priestess.bot.agent.runner.ReActRunner
import com.heyanle.priestess.bot.config.model.EffectiveAgent
import com.heyanle.priestess.bot.config.model.AgentEngine
import com.heyanle.priestess.bot.agent.type.AgentTypeRegistry
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore

/**
 * Agent 模块门面，向外提供运行时 Agent 创建和执行能力。
 */
class AgentCase(
    private val controller: AgentController = AgentController(),
    private val contextManager: ContextManager = ContextManager(TokenCounter()),
    private val overflowStore: ToolResultOverflowStore = ToolResultOverflowStore(),
) {
    fun createAgent(config: EffectiveAgent): Agent = controller.createAgent(config)

    /** Picks the runner the Agent's preset names; both runners share one loop and one tool executor. */
    suspend fun runWithProvider(
        context: AgentContext,
        provider: ChatProvider,
        toolCase: ToolCase,
        hooks: AgentHooks? = null,
    ): AgentResponse {
        require(AgentTypeRegistry.of(context.agent.type).engine == AgentEngine.INTERNAL) {
            "External Agent '${context.agent.name}' cannot run through ChatProvider"
        }
        val definition = AgentPresetRegistry.of(context.agent.preset)
        val runner: AgentRunner = when (definition.runner) {
            AgentRunnerKind.REACT -> ReActRunner(
                context = context,
                provider = provider,
                toolCase = toolCase,
                contextManager = contextManager,
                overflowStore = overflowStore,
                hooks = hooks,
            )
            AgentRunnerKind.HARNESS -> HarnessRunner(
                context = context,
                provider = provider,
                toolCase = toolCase,
                contextManager = contextManager,
                overflowStore = overflowStore,
                hooks = hooks,
                maxParallelToolCalls = definition.parallelToolCalls ?: HarnessRunner.DEFAULT_MAX_PARALLEL_TOOL_CALLS,
            )
        }
        return runner.stepUntilDone()
    }
}
