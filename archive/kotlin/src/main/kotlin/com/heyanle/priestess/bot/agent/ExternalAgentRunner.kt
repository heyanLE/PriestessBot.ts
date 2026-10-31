package com.heyanle.priestess.bot.agent

import com.heyanle.priestess.bot.config.model.AgentEngine
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.ToolInjectionMode
import java.util.concurrent.ConcurrentHashMap

/** One complete external-engine turn; no ChatProvider or ContextManager crosses this boundary. */
data class ExternalAgentTurn(
    val context: AgentContext,
    val provider: EffectiveProviderConnection,
    val userContent: String,
    val toolInjectionMode: ToolInjectionMode,
)

fun interface ExternalAgentRunner {
    suspend fun run(turn: ExternalAgentTurn): AgentResponse
}

interface ManagedExternalAgentRunner : ExternalAgentRunner {
    suspend fun stop()
}

/** Runtime-owned registrations. An absent external runner is a clear failure, never an internal fallback. */
class ExternalAgentRunnerRegistry {
    private val runners = ConcurrentHashMap<AgentEngine, ExternalAgentRunner>()

    fun register(engine: AgentEngine, runner: ExternalAgentRunner) {
        require(engine != AgentEngine.INTERNAL) { "INTERNAL uses AgentCase's built-in runners" }
        runners[engine] = runner
    }

    fun unregister(engine: AgentEngine) { runners.remove(engine) }
    fun get(engine: AgentEngine): ExternalAgentRunner? = runners[engine]

    suspend fun stop() {
        runners.values.filterIsInstance<ManagedExternalAgentRunner>().forEach { it.stop() }
        runners.clear()
    }
}
