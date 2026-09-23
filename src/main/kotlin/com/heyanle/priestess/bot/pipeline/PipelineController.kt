package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.runtime.commandConfig
import com.heyanle.priestess.bot.config.runtime.permissionConfig
import com.heyanle.priestess.bot.config.runtime.pipelineConfig
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.core.controller.BaseController
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.pipeline.stages.PrepareWorkspaceStage
import com.heyanle.priestess.bot.pipeline.stages.ImRouteStage
import com.heyanle.priestess.bot.pipeline.stages.ResolvePermissionStage
import com.heyanle.priestess.bot.pipeline.stages.CommandStage
import com.heyanle.priestess.bot.pipeline.stages.PreProcessStage
import com.heyanle.priestess.bot.pipeline.stages.ProcessStage
import com.heyanle.priestess.bot.pipeline.stages.RateLimitStage
import com.heyanle.priestess.bot.pipeline.stages.RespondStage
import com.heyanle.priestess.bot.pipeline.stages.ResultDecorateStage
import com.heyanle.priestess.bot.pipeline.stages.WakingCheckStage
import com.heyanle.priestess.bot.pipeline.stages.WhitelistCheckStage
import com.heyanle.priestess.bot.persona.PersonaMemoryInjector
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.skill.SkillCase
import com.heyanle.priestess.bot.tool.ToolCase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.withTimeoutOrNull

/**
 * 消息流水线控制器，负责按固定顺序组织阶段并承接系统生命周期。
 *
 * 阶段组合保留在控制器内部，外部只通过 PipelineCase 投递平台消息。
 */
class PipelineController private constructor(
    private val stageProvider: () -> List<Stage>,
    private val observabilityCase: ObservabilityCase = ObservabilityCase.standalone(),
    private val drainTimeoutMillis: Long = DEFAULT_DRAIN_TIMEOUT_MILLIS,
    private val effectiveConfigStore: EffectiveConfigStore? = null,
) : BaseController("PipelineController") {

    private val activeMessageJobs = mutableSetOf<Job>()
    @Volatile
    private var shuttingDown = false

    constructor(
        runtimeConfig: RuntimeConfigurationCase,
        conversationCase: ConversationCase,
        agentCase: AgentCase,
        providerCase: ProviderCase,
        toolCase: ToolCase,
        skillCase: SkillCase? = null,
        personaMemoryInjector: PersonaMemoryInjector? = null,
        commandCase: CommandCase = CommandCase(),
        permissionResolver: PermissionResolver = PermissionResolver { runtimeConfig.current().permissionConfig() },
        permissionDeniedMessageResolver: PermissionDeniedMessageResolver = PermissionDeniedMessageResolver.Default,
        observabilityCase: ObservabilityCase = ObservabilityCase.standalone(),
        drainTimeoutMillis: Long = DEFAULT_DRAIN_TIMEOUT_MILLIS,
        effectiveConfigStore: EffectiveConfigStore? = null,
        executionTraces: com.heyanle.priestess.bot.observability.trace.ExecutionTraceController? = null,
        agentSkillCatalog: com.heyanle.priestess.bot.resources.AgentSkillCatalog? = null,
    ) : this({
        buildStages(
            runtimeConfig = runtimeConfig,
            conversationCase = conversationCase,
            agentCase = agentCase,
            providerCase = providerCase,
            toolCase = toolCase,
            skillCase = skillCase,
            personaMemoryInjector = personaMemoryInjector,
            commandCase = commandCase,
            permissionResolver = permissionResolver,
            permissionDeniedMessageResolver = permissionDeniedMessageResolver,
            observabilityCase = observabilityCase,
            executionTraces = executionTraces,
            agentSkillCatalog = agentSkillCatalog,
        )
    }, observabilityCase, drainTimeoutMillis, effectiveConfigStore)

    internal constructor(
        testStages: List<Stage>,
        @Suppress("UNUSED_PARAMETER") testOnly: Unit,
        observabilityCase: ObservabilityCase = ObservabilityCase.standalone(),
        drainTimeoutMillis: Long = DEFAULT_DRAIN_TIMEOUT_MILLIS,
        effectiveConfigStore: EffectiveConfigStore? = null,
    ) : this({ testStages }, observabilityCase, drainTimeoutMillis, effectiveConfigStore)

    fun process(event: MessageEvent): Job {
        return process(event, null)
    }

    fun process(event: MessageEvent, onComplete: ((PipelineExecutionResult) -> Unit)?): Job {
        if (shuttingDown) {
            logger.warn {
                "[PIPELINE-090] Reject message while shutting down platform=${event.platform.metadata.name}, " +
                    "session=${event.session.id}"
            }
            return Job().also { it.cancel(CancellationException("Pipeline is shutting down")) }
        }

        val job = launchTask("process-message") {
            val startedAtNanos = System.nanoTime()
            val platformName = event.platform.metadata.name
            var status = "completed"
            val orderedStages = stageProvider().sortedBy { it.order.level }
            var completion: PipelineExecutionResult? = null
            try {
                logger.info {
                    "[PIPELINE-040] PipelineController start platform=${event.platform.metadata.name}, " +
                        "session=${event.session.id}, stages=${orderedStages.size}"
                }
                val ctx = PipelineContext(event)
                try {
                    effectiveConfigStore?.current()?.let { ctx.pinConfiguration(checkNotNull(effectiveConfigStore).acquire()) }
                    executePipeline(ctx, orderedStages, 0)
                    completion = ctx.toExecutionResult()
                    ctx.executionTrace?.complete(
                        when {
                            ctx.agentResponse is com.heyanle.priestess.bot.agent.AgentResponse.Error -> com.heyanle.priestess.bot.observability.trace.ExecutionStatus.FAILED
                            ctx.isStopped -> com.heyanle.priestess.bot.observability.trace.ExecutionStatus.SKIPPED
                            completion.status == "ERROR" -> com.heyanle.priestess.bot.observability.trace.ExecutionStatus.FAILED
                            else -> com.heyanle.priestess.bot.observability.trace.ExecutionStatus.SUCCEEDED
                        }, completion.content, completion.error,
                    )
                    logger.info {
                        "[PIPELINE-049] PipelineController done platform=${event.platform.metadata.name}, " +
                            "session=${event.session.id}, stopped=${ctx.isStopped}"
                    }
                } catch (error: Exception) {
                    ctx.executionTrace?.complete(
                        if (error is CancellationException) com.heyanle.priestess.bot.observability.trace.ExecutionStatus.CANCELLED else com.heyanle.priestess.bot.observability.trace.ExecutionStatus.FAILED,
                        error = error.message,
                    )
                    throw error
                } finally {
                    ctx.releaseConfiguration()
                }
            } catch (e: Exception) {
                status = "failed"
                completion = PipelineExecutionResult("ERROR", "", error = e.message ?: e::class.simpleName)
                throw e
            } finally {
                observabilityCase.recordPipelineMessage(platformName, status, elapsedMillis(startedAtNanos))
                completion?.let { result -> runCatching { onComplete?.invoke(result) } }
            }
        }
        synchronized(activeMessageJobs) {
            activeMessageJobs.add(job)
        }
        job.invokeOnCompletion {
            synchronized(activeMessageJobs) {
                activeMessageJobs.remove(job)
            }
        }
        return job
    }

    private fun PipelineContext.toExecutionResult(): PipelineExecutionResult {
        val response = agentResponse
        val error = (response as? com.heyanle.priestess.bot.agent.AgentResponse.Error)?.message
        val content = decoratedResponse?.takeIf { it.isNotBlank() }
            ?: responseChain?.textContent?.takeIf { it.isNotBlank() }
            ?: directResponse
            ?: (response as? com.heyanle.priestess.bot.agent.AgentResponse.Final)?.content
            ?: error.orEmpty()
        return PipelineExecutionResult(
            status = if (error == null && content.isNotBlank()) "FINAL" else "ERROR",
            content = content,
            trace = configurationTrace,
            selectedAgentId = shared["subAgentSelectionAgent"] as? String,
            selectedRouteId = shared["subAgentSelectionRoute"] as? String,
            selectionReason = shared["subAgentSelectionReason"] as? String,
            error = error,
        )
    }

    suspend fun drain(timeoutMillis: Long = drainTimeoutMillis): Boolean {
        shuttingDown = true
        val jobs = synchronized(activeMessageJobs) { activeMessageJobs.toList() }
        if (jobs.isEmpty()) return true
        logger.info { "Draining ${jobs.size} in-flight pipeline job(s)" }
        val completed = withTimeoutOrNull(timeoutMillis.coerceAtLeast(0)) {
            jobs.joinAll()
            true
        } ?: false
        if (!completed) {
            logger.warn { "Pipeline drain timed out after ${timeoutMillis}ms; cancelling remaining work" }
        }
        return completed
    }

    override suspend fun stop() {
        drain()
        super.stop()
    }

    private suspend fun executePipeline(ctx: PipelineContext, orderedStages: List<Stage>, stageIndex: Int) {
        if (stageIndex >= orderedStages.size) return
        if (ctx.isStopped) return

        val stage = orderedStages[stageIndex]
        val postProcess = try {
            logger.info { "[PIPELINE-04${stage.order.level}] Enter stage ${stage.order.level}:${stage.name}" }
            stage.process(ctx)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.error(e) { "[PIPELINE-59${stage.order.level}] Stage '${stage.name}' failed" }
            throw e
        }

        logger.info {
            "[PIPELINE-14${stage.order.level}] Exit stage ${stage.order.level}:${stage.name}, stopped=${ctx.isStopped}"
        }
        executePipeline(ctx, orderedStages, stageIndex + 1)

        if (postProcess != null) try {
            logger.info { "[PIPELINE-24${stage.order.level}] Collect post stage ${stage.order.level}:${stage.name}" }
            postProcess.collect {}
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.error(e) { "[PIPELINE-69${stage.order.level}] Stage '${stage.name}' post-processing failed" }
        }
    }

    companion object {
        const val DEFAULT_DRAIN_TIMEOUT_MILLIS = 10_000L

        private fun buildStages(
            runtimeConfig: RuntimeConfigurationCase,
            conversationCase: ConversationCase,
            agentCase: AgentCase,
            providerCase: ProviderCase,
            toolCase: ToolCase,
            skillCase: SkillCase?,
            personaMemoryInjector: PersonaMemoryInjector?,
            commandCase: CommandCase,
            permissionResolver: PermissionResolver,
            permissionDeniedMessageResolver: PermissionDeniedMessageResolver,
            observabilityCase: ObservabilityCase,
            executionTraces: com.heyanle.priestess.bot.observability.trace.ExecutionTraceController?,
            agentSkillCatalog: com.heyanle.priestess.bot.resources.AgentSkillCatalog?,
        ): List<Stage> {
            val config = runtimeConfig.current()
            val pipeline = config.pipelineConfig()
            return listOf(
                ImRouteStage(executions = executionTraces),
                WakingCheckStage(pipeline),
                WhitelistCheckStage(pipeline),
                RateLimitStage(pipeline),
                PrepareWorkspaceStage(),
                ResolvePermissionStage(permissionResolver),
                CommandStage(
                    configProvider = { runtimeConfig.current().commandConfig() },
                    commandCase = commandCase,
                    conversationCase = conversationCase,
                    permissionDeniedMessageResolver = permissionDeniedMessageResolver,
                ),
                PreProcessStage(
                    pipelineConfig = pipeline,
                    conversationCase = conversationCase,
                    agentCase = agentCase,
                    personaMemoryInjector = personaMemoryInjector,
                    skillCase = skillCase,
                    permissionDeniedMessageResolver = permissionDeniedMessageResolver,
                    agentSkillCatalog = agentSkillCatalog,
                ),
                ProcessStage(
                    agentCase = agentCase,
                    providerCase = providerCase,
                    toolCase = toolCase,
                    observabilityCase = observabilityCase,
                ),
                ResultDecorateStage(),
                RespondStage(),
            )
        }

        private fun elapsedMillis(startedAtNanos: Long): Long {
            return ((System.nanoTime() - startedAtNanos).coerceAtLeast(0L)) / 1_000_000L
        }
    }
}
