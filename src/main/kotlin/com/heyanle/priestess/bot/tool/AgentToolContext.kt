package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * Context passed to tool execution.
 * Provides access to platform, session, and agent state.
 *
 * This is a lightweight context designed for tool use. The full AgentContext
 * in the agent loop is richer; tools only need this subset.
 */
data class AgentToolContext @JvmOverloads constructor(
    val conversationId: String = "",
    /**
     * The current platform instance for sending messages.
     */
    val platform: Platform? = null,

    /**
     * The current message session.
     */
    val session: MessageSession? = null,

    /**
     * The name of the current agent.
     */
    val agentName: String = "",

    /**
     * The model being used.
     */
    val model: String = "",

    /**
     * Additional metadata that tools might need.
     */
    val metadata: Map<String, String> = emptyMap(),

    /**
     * Workspace-pinned tools for this agent run. These are resolved from the
     * immutable workspace snapshot and are not registered globally.
     */
    val scopedTools: List<FunctionTool> = emptyList(),

    /**
     * Mutable per-agent-run skill loading state. Tools such as use_skill update
     * this state so later LLM turns include the loaded SKILL.md prompt block.
     */
    val skillState: PipelineSkillState = PipelineSkillState(),
    val permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    /** Per-Agent role floors chosen in the Agent's tool settings. */
    val minimumToolPermissionGroups: Map<String, PermissionGroup> = emptyMap(),
    val responseIntent: com.heyanle.priestess.bot.message.ResponseIntent = com.heyanle.priestess.bot.message.ResponseIntent(),
)
