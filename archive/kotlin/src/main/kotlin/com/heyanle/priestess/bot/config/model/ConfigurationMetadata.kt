package com.heyanle.priestess.bot.config.model

import kotlinx.serialization.Serializable

@Serializable
data class RawConfigRevision(val value: String)

@Serializable
data class EffectiveConfigVersion(val value: Long)

@Serializable
data class SourceFingerprint(val value: String)

@Serializable
enum class DiagnosticSeverity {
    INFO,
    WARNING,
    ERROR,
}

@Serializable
data class ConfigurationDiagnostic(
    val code: String,
    val severity: DiagnosticSeverity,
    val message: String,
    val source: String = "",
    val path: String = "",
    val suggestion: String? = null,
)

@Serializable
enum class ConfigurationSourceKind {
    COMMAND_LINE,
    ENVIRONMENT,
    DEFAULT,
    GLOBAL_DOCUMENT,
    WORKSPACE_DOCUMENT,
    MESSAGE_SELECTOR,
}

@Serializable
data class FieldProvenance(
    val sourceKind: ConfigurationSourceKind,
    val sourceLocation: String,
    val sourceRevision: String = "",
    val sourcePath: String = "",
    val redacted: Boolean = false,
)

@Serializable
enum class ConfigurationApplyMode {
    LIVE,
    RESTART_REQUIRED,
    REJECTED,
}

@Serializable
data class ConfigurationChange(
    val path: String,
    val mode: ConfigurationApplyMode,
    val summary: String = "",
)

@Serializable
data class ActivationPlan(
    val changes: List<ConfigurationChange> = emptyList(),
) {
    val livePaths: List<String>
        get() = changes.filter { it.mode == ConfigurationApplyMode.LIVE }.map { it.path }

    val restartRequiredPaths: List<String>
        get() = changes.filter { it.mode == ConfigurationApplyMode.RESTART_REQUIRED }.map { it.path }

    val rejectedPaths: List<String>
        get() = changes.filter { it.mode == ConfigurationApplyMode.REJECTED }.map { it.path }
}

@Serializable
data class PendingRestart(
    val path: String,
    val reason: String,
)

/**
 * Secret-free evidence of the exact configuration generation used by one execution.
 * This is safe to expose in logs and diagnostics APIs.
 */
@Serializable
data class ConfigurationTrace(
    val effectiveVersion: Long,
    val desiredRevision: String,
    val sourceFingerprint: String,
    val workspaceId: String? = null,
    val workspaceVersion: Long? = null,
    val workspaceFingerprint: String? = null,
    val workspaceSelectionReason: String? = null,
    val workspaceSelectionRuleId: String? = null,
    val agentId: String? = null,
    val providerId: String? = null,
    val model: String? = null,
    val toolIds: List<String> = emptyList(),
)
