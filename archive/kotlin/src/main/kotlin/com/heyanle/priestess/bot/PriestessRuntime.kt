package com.heyanle.priestess.bot

import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.agent.ExternalAgentRunnerRegistry
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.platform.PlatformCase
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinQrLoginService
import com.heyanle.priestess.bot.plugin.PluginCase
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.server.ServerCase
import com.heyanle.priestess.bot.skill.SkillCase
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.workspace.WorkspaceCase
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import io.github.oshai.kotlinlogging.KotlinLogging

/**
 * 运行时编排器，负责启动服务并按确定顺序停止各模块生命周期入口。
 */
class PriestessRuntime private constructor(
    private val startAction: () -> Unit,
    private val stopSteps: List<StopStep>,
) {
    private val logger = KotlinLogging.logger("PriestessRuntime")

    constructor(
        platformCase: PlatformCase,
        pipelineCase: PipelineCase,
        serverCase: ServerCase,
        pluginCase: PluginCase,
        providerCase: ProviderCase,
        toolCase: ToolCase,
        skillCase: SkillCase,
        workspaceCase: WorkspaceCase,
        observabilityCase: ObservabilityCase,
        databaseCase: DatabaseCase,
        overflowStore: ToolResultOverflowStore,
        pipelineDrainTimeoutMillis: Long = PipelineCase.DEFAULT_DRAIN_TIMEOUT_MILLIS,
        configurationRuntimeService: ConfigurationRuntimeService? = null,
        effectiveConfigStore: EffectiveConfigStore? = null,
        weixinQrLoginService: WeixinQrLoginService? = null,
        platformResourceDatabase: DatabaseCase? = null,
        externalRunners: ExternalAgentRunnerRegistry? = null,
    ) : this(
        startAction = {
            configurationRuntimeService?.startup()?.let { result ->
                check(result.success) {
                    "Configuration activation failed: " + result.diagnostics.joinToString { "${it.code}: ${it.message}" }
                }
                val snapshot = effectiveConfigStore?.current()
                KotlinLogging.logger("ConfigurationRuntime").info {
                    "Activated configuration path=${configurationRuntimeService.sourcePath()}, " +
                        "revision=${result.desiredRevision}, version=${result.activeVersion}, " +
                        "workspaces=${snapshot?.workspaces?.entries?.sortedBy { it.key }?.joinToString(",") { (id, ws) -> "$id:${ws.version.value}" }.orEmpty()}, " +
                        "diagnostics=${result.diagnostics.size}, pendingRestart=${result.pendingRestartPaths.size}"
                }
            }
            configurationRuntimeService?.startConfiguredWatcher()
            platformCase.start()
            serverCase.start()
        },
        stopSteps = listOf(
            StopStep("weixin QR login") { weixinQrLoginService?.stop() },
            StopStep("platforms") { platformCase.stop() },
            StopStep("pipeline") {
                pipelineCase.drain(pipelineDrainTimeoutMillis)
                pipelineCase.stop()
            },
            StopStep("external agents") { externalRunners?.stop() },
            StopStep("server") { serverCase.stop() },
            StopStep("plugins") { pluginCase.stop() },
            StopStep("providers") { providerCase.stop() },
            StopStep("tools") { toolCase.stop() },
            StopStep("tool result overflow store") { overflowStore.close() },
            StopStep("skills") { skillCase.stop() },
            StopStep("workspace") { workspaceCase.stop() },
            StopStep("observability") { observabilityCase.stop() },
            StopStep("database") { databaseCase.stop() },
            StopStep("platform resource database") { platformResourceDatabase?.stop() },
            StopStep("configuration runtime") { configurationRuntimeService?.stop() },
            StopStep("effective config") { effectiveConfigStore?.close() },
        ),
    )

    internal constructor(
        stopSteps: List<Pair<String, suspend () -> Unit>>,
    ) : this(
        startAction = {},
        stopSteps = stopSteps.map { (name, block) -> StopStep(name, block) },
    )

    fun start() {
        startAction()
    }

    suspend fun stop() {
        logger.info { "Priestess runtime shutdown starting..." }
        for (step in stopSteps) {
            runStop(step.name, step.block)
        }
        logger.info { "Priestess runtime shutdown complete." }
    }

    private suspend fun runStop(name: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            logger.error(e) { "Failed to stop $name during runtime shutdown" }
        }
    }

    /**
     * 停止步骤，保存步骤名称和实际的挂起停止动作。
     */
    internal data class StopStep(
        val name: String,
        val block: suspend () -> Unit,
    )
}
