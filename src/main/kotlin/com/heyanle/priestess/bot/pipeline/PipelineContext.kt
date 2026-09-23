package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.config.model.ConfigurationTrace
import com.heyanle.priestess.bot.config.model.EffectiveRuntimeSnapshot
import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigLease
import com.heyanle.priestess.bot.platform.MessageEvent

/**
 * Pipeline 上下文，贯穿所有阶段，携带：
 * - 原始事件引用
 * - Agent 上下文（PreProcess 阶段创建）
 * - 最终响应（Process 阶段填充）
 * - 装饰后响应（ResultDecorate 阶段填充）
 */
class PipelineContext(
    val event: MessageEvent,
) {
    /** Cross-stage metadata retained for pipeline integrations and diagnostics. */
    val shared: MutableMap<String, Any?> = linkedMapOf()

    /** Agent 执行上下文，由 PreProcessStage 创建 */
    var agentContext: AgentContext? = null

    /** Agent 最终响应，由 ProcessStage 填充 */
    var agentResponse: AgentResponse? = null

    /** 装饰后的响应文本，由 ResultDecorateStage 填充 */
    var decoratedResponse: String? = null

    /** Unified response assembled for final delivery, including attachment-only captions. */
    var responseChain: com.heyanle.priestess.bot.platform.MessageChain? = null

    var directResponse: String? = null

    var permissionGroup: PermissionGroup = PermissionGroup.OPERATOR
    var imRoute: com.heyanle.priestess.bot.im.ImRouteMatch? = null
    var selectedAgentId: String? = null
    var executionTrace: com.heyanle.priestess.bot.observability.trace.ExecutionTraceRecorder? = null

    val agentProfile: com.heyanle.priestess.bot.config.model.AgentProfileDocument?
        get() = effectiveRuntimeSnapshot?.application?.agents?.find { it.id == selectedAgentId && it.enabled }

    private var effectiveConfigLease: EffectiveConfigLease? = null

    var effectiveWorkspaceSnapshot: EffectiveWorkspaceSnapshot? = null
        private set

    var effectiveWorkspaceResolutionReason: String? = null
        private set

    var effectiveWorkspaceRuleId: String? = null
        private set

    var configurationTrace: ConfigurationTrace? = null
        internal set

    val effectiveRuntimeSnapshot: EffectiveRuntimeSnapshot?
        get() = effectiveConfigLease?.snapshot

    /** 是否应终止管道（由各阶段设置） */
    val isStopped: Boolean
        get() = event.isStopped.get()

    fun pinConfiguration(lease: EffectiveConfigLease) {
        check(effectiveConfigLease == null) { "An effective configuration generation is already pinned" }
        effectiveConfigLease = lease
        val snapshot = lease.snapshot
        configurationTrace = ConfigurationTrace(
            effectiveVersion = snapshot.version.value,
            desiredRevision = snapshot.desiredRevision.value,
            sourceFingerprint = snapshot.sourceFingerprint.value,
        )
    }

    fun pinEffectiveWorkspace(
        snapshot: EffectiveWorkspaceSnapshot,
        reason: String,
        ruleId: String? = null,
    ) {
        val runtime = checkNotNull(effectiveRuntimeSnapshot) { "Pin effective configuration before selecting a Workspace" }
        require(snapshot.version == runtime.version) {
            "Workspace generation ${snapshot.version.value} does not belong to runtime generation ${runtime.version.value}"
        }
        effectiveWorkspaceSnapshot = snapshot
        effectiveWorkspaceResolutionReason = reason
        effectiveWorkspaceRuleId = ruleId
        configurationTrace = checkNotNull(configurationTrace).copy(
            workspaceId = snapshot.config.id,
            workspaceVersion = snapshot.version.value,
            workspaceFingerprint = snapshot.fingerprint.value,
            workspaceSelectionReason = reason,
            workspaceSelectionRuleId = ruleId,
        )
    }

    fun releaseConfiguration() {
        effectiveWorkspaceSnapshot = null
        effectiveWorkspaceResolutionReason = null
        effectiveWorkspaceRuleId = null
        effectiveConfigLease?.close()
        effectiveConfigLease = null
    }

    fun stop() {
        event.stopPropagation()
    }

    val isCommandHandled: Boolean
        get() = directResponse != null

    /** 便捷：获取事件文本内容 */
    val textContent: String
        get() = event.chain.textContent

    /** The exact user input passed to the model and persisted for correctly attributed history. */
    val modelUserContent: String by lazy(LazyThreadSafetyMode.NONE) {
        com.heyanle.priestess.bot.message.InboundMessageFormatter.format(event, permissionGroup.name, selectedAgentId)
    }

    /** 便捷：获取发送者 ID（从 session metadata 中提取，fallback 为 session id） */
    val senderId: String
        get() = event.session.metadata["senderId"]
            ?: event.session.metadata["userId"]
            ?: event.session.id

    /** 便捷：是否为私聊 */
    val isPrivate: Boolean
        get() = event.session.type == com.heyanle.priestess.bot.platform.SessionType.PRIVATE
}
