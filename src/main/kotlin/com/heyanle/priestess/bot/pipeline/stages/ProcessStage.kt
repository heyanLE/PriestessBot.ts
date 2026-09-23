package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.agent.AgentHooks
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.tool.ToolCase
import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.flow.Flow

/**
 * 执行阶段，负责选择模型供应商并通过 AgentCase 完成一次消息处理。
 */
class ProcessStage(
    private val agentCase: AgentCase,
    private val providerCase: ProviderCase,
    private val toolCase: ToolCase,
    private val hooks: AgentHooks? = null,
    private val observabilityCase: ObservabilityCase = ObservabilityCase.standalone(),
) : Stage {

    private val logger = KotlinLogging.logger {}

    override val name = "Process"
    override val order = StageOrder.PROCESS

    override suspend fun process(ctx: PipelineContext): Flow<Unit>? {
        if (ctx.isCommandHandled) return null
        val agentContext = ctx.agentContext
        if (agentContext == null) {
            logger.error { "[PIPELINE-991] AgentContext is null, cannot execute agent" }
            ctx.agentResponse = AgentResponse.Error("AgentContext not initialized")
            return null
        }

        val agent = agentContext.agent
        ctx.executionTrace?.identify(
            workspaceId = ctx.effectiveWorkspaceSnapshot?.config?.id.orEmpty(), agent = agent.name,
            provider = agent.providerName, model = agent.model,
        )
        val preferredProviderName = agentContext.metadata["providerName"]
            ?.takeIf { it.isNotBlank() }
            ?: agent.providerName.takeIf { it.isNotBlank() }
        val effectiveRuntime = checkNotNull(ctx.effectiveRuntimeSnapshot) { "Effective configuration was not pinned" }
        val provider = preferredProviderName
            ?.let(effectiveRuntime.providers::get)
            ?.let(providerCase::getEffective)

        if (provider == null) {
            logger.error { "[PIPELINE-992] Configured provider '${preferredProviderName.orEmpty()}' is unavailable for agent '${agent.name}'" }
            ctx.agentResponse = AgentResponse.Error("Configured LLM provider '${preferredProviderName.orEmpty()}' is unavailable")
            return null
        }

        agentContext.messages.add(ConversationMessage.user(ctx.modelUserContent))
        logger.info {
            "[PIPELINE-210] Process selected provider=${provider.metadata.name}, agent=${agent.name}, " +
                "model=${agent.model}, messages=${agentContext.messages.size}, tools=${toolCase.size()}"
        }

        logger.info { "[PIPELINE-220] Process executing ReAct loop agent=${agent.name}, model=${agent.model}" }
        val startedAtNanos = System.nanoTime()
        val response = agentCase.runWithProvider(
            context = agentContext,
            provider = provider,
            toolCase = toolCase,
            hooks = hooks,
        )

        val status = if (response is AgentResponse.Error) "error" else "success"
        observabilityCase.recordLlmRequest(provider.metadata.name, status, elapsedMillis(startedAtNanos))
        ctx.agentResponse = response

        when (response) {
            is AgentResponse.Final -> {
                logger.info { "[PIPELINE-229] Process final response length=${response.content.length}" }
            }
            is AgentResponse.Error -> {
                logger.info { "[PIPELINE-298] Process agent error: ${response.message}" }
            }
        else -> {
            logger.info { "[PIPELINE-299] Process ended with response type: ${response::class.simpleName}" }
        }
    }

        return null
    }

    private fun elapsedMillis(startedAtNanos: Long): Long {
        return ((System.nanoTime() - startedAtNanos).coerceAtLeast(0L)) / 1_000_000L
    }
}
