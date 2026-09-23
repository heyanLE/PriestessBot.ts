package com.heyanle.priestess.bot.config.resolve

import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogDocument
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceSelectionRuleDocument

data class WorkspaceSelectionContext(
    val explicitWorkspaceId: String? = null,
    val platformId: String = "",
    val platformDefaultWorkspaceId: String? = null,
    val sessionId: String = "",
    val userId: String = "",
    val groupId: String = "",
)

data class WorkspaceSelectionResult(
    val entry: WorkspaceCatalogEntryDocument? = null,
    val reason: String = "",
    val ruleId: String? = null,
    val diagnostics: List<ConfigurationDiagnostic> = emptyList(),
) {
    val isSuccess: Boolean get() = entry != null && diagnostics.none { it.severity == DiagnosticSeverity.ERROR }
}

class WorkspaceSelector {
    fun select(catalog: WorkspaceCatalogDocument, context: WorkspaceSelectionContext): WorkspaceSelectionResult {
        val enabled = catalog.entries.filter { it.enabled }
        context.explicitWorkspaceId?.takeIf { it.isNotBlank() }?.let { requested ->
            val entry = enabled.find { it.id == requested }
            return if (entry != null) {
                WorkspaceSelectionResult(entry, "message workspace id")
            } else {
                failure("WORKSPACE_SELECTION_EXPLICIT_UNKNOWN", "Explicit Workspace '$requested' is unknown or disabled")
            }
        }

        val matches = enabled.flatMap { entry ->
            entry.selectionRules.filter { it.matches(context) }.map { rule -> RuleMatch(entry, rule) }
        }.sortedWith(
            compareByDescending<RuleMatch> { it.rule.priority }
                .thenByDescending { it.rule.specificity() }
                .thenBy { it.entry.id }
                .thenBy { it.rule.id },
        )
        val first = matches.firstOrNull()
        if (first != null) {
            val ambiguous = matches.drop(1).firstOrNull {
                it.rule.priority == first.rule.priority && it.rule.specificity() == first.rule.specificity()
            }
            if (ambiguous != null) {
                return failure(
                    "WORKSPACE_SELECTION_AMBIGUOUS",
                    "Workspace rules '${first.rule.id}' and '${ambiguous.rule.id}' match with equal priority and specificity",
                )
            }
            return WorkspaceSelectionResult(first.entry, "workspace selection rule", first.rule.id)
        }

        context.platformDefaultWorkspaceId?.takeIf { it.isNotBlank() }?.let { platformDefault ->
            enabled.find { it.id == platformDefault }?.let { return WorkspaceSelectionResult(it, "platform default workspace") }
            return failure("WORKSPACE_SELECTION_PLATFORM_DEFAULT_UNKNOWN", "Platform default Workspace '$platformDefault' is unknown or disabled")
        }
        enabled.find { it.id == catalog.defaultWorkspaceId }?.let {
            return WorkspaceSelectionResult(it, "global default workspace")
        }
        return failure("WORKSPACE_SELECTION_DEFAULT_UNKNOWN", "Global default Workspace '${catalog.defaultWorkspaceId}' is unknown or disabled")
    }

    private fun WorkspaceSelectionRuleDocument.matches(context: WorkspaceSelectionContext): Boolean {
        return (platformIds.isEmpty() || context.platformId in platformIds) &&
            (sessionIds.isEmpty() || context.sessionId in sessionIds) &&
            (userIds.isEmpty() || context.userId in userIds) &&
            (groupIds.isEmpty() || context.groupId in groupIds)
    }

    private fun WorkspaceSelectionRuleDocument.specificity(): Int {
        return listOf(platformIds, sessionIds, userIds, groupIds).count { it.isNotEmpty() }
    }

    private fun failure(code: String, message: String) = WorkspaceSelectionResult(
        diagnostics = listOf(ConfigurationDiagnostic(code, DiagnosticSeverity.ERROR, message, source = "workspace-selector")),
    )

    private data class RuleMatch(
        val entry: WorkspaceCatalogEntryDocument,
        val rule: WorkspaceSelectionRuleDocument,
    )
}
