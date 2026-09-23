package com.heyanle.priestess.bot.agent

import com.heyanle.priestess.bot.config.model.AgentPreset
import com.heyanle.priestess.bot.config.model.AgentRuntimeDefaults
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * 运行时 Agent 定义，描述模型、提示词、工具步数和上下文压缩策略。
 */
data class Agent(
    val name: String,
    val instructions: String,
    val model: String,
    val preset: AgentPreset = AgentPreset.NORMAL,
    val providerName: String = "",
    val temperature: Double = 0.7,
    val maxOutputTokens: Int? = null,
    val maxSteps: Int = AgentRuntimeDefaults.MAX_STEPS,
    val toolTimeoutMs: Long = 30_000L,
    val compressStrategy: CompressStrategy = CompressStrategy.ROUND_TRUNCATION,
    val maxContextTokens: Int = AgentRuntimeDefaults.MAX_CONTEXT_TOKENS,
    val maxContextRounds: Int = 20,
    val toolResultInlineTokens: Int = 2048,
    val toolResultPreviewTokens: Int = 512,
    val toolResultTtlSeconds: Long = 1800,
    val toolResultMaxBytes: Long = 4 * 1024 * 1024,
    val toolResultStoreMaxBytes: Long = 64 * 1024 * 1024,
    val effectiveToolIds: Set<String>? = null,
    val deniedToolIds: Set<String> = emptySet(),
    val allowedRiskLevels: Set<com.heyanle.priestess.bot.tool.ToolRiskLevel> = com.heyanle.priestess.bot.tool.ToolRiskLevel.entries.toSet(),
    /** Per-Agent caller-role floors, additionally bounded by every tool's built-in minimum. */
    val minimumToolPermissionGroups: Map<String, PermissionGroup> = emptyMap(),
    val strictPermissionToolFiltering: Boolean = false,
)
