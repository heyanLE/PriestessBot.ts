package com.heyanle.priestess.bot.agent

import com.heyanle.priestess.bot.config.model.EffectiveAgent
import com.heyanle.priestess.bot.agent.type.AgentTypeRegistry
import com.heyanle.priestess.bot.core.controller.BaseController

/**
 * Agent 控制器，负责将配置转换为运行时 Agent 实例。
 */
class AgentController : BaseController("AgentController") {
    fun createAgent(effective: EffectiveAgent): Agent {
        val definition = effective.definition
        val type = AgentTypeRegistry.of(definition.type)
        val compression = definition.context.compression
        val toolResults = definition.context.toolResults
        val compressStrategy = CompressStrategy.fromConfigName(compression.strategy)
            ?: error("Unsupported compiled compression strategy '${compression.strategy}'")
        return Agent(
            name = definition.id,
            instructions = definition.instructions,
            model = definition.model,
            type = definition.type,
            preset = type.internalPreset ?: com.heyanle.priestess.bot.config.model.AgentPreset.NORMAL,
            providerName = effective.provider.id,
            temperature = definition.generation.temperature,
            maxOutputTokens = definition.generation.maxOutputTokens,
            maxSteps = definition.execution.maxSteps,
            toolTimeoutMs = definition.execution.toolTimeoutMillis,
            compressStrategy = compressStrategy,
            maxContextTokens = compression.maxTokens,
            maxContextRounds = compression.maxRounds,
            toolResultInlineTokens = toolResults.inlineTokens,
            toolResultPreviewTokens = toolResults.previewTokens,
            toolResultTtlSeconds = toolResults.ttlSeconds,
            toolResultMaxBytes = toolResults.maxBytes,
            toolResultStoreMaxBytes = toolResults.storeMaxBytes,
            effectiveToolIds = effective.toolIds,
            deniedToolIds = emptySet(),
            allowedRiskLevels = definition.toolPolicy.allowedRiskLevels.toSet(),
            minimumToolPermissionGroups = definition.toolPolicy.minimumPermissionGroups,
            strictPermissionToolFiltering = true,
        )
    }
}
