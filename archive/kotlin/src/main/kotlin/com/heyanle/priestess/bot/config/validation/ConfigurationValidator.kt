package com.heyanle.priestess.bot.config.validation

import com.heyanle.priestess.bot.agent.CompressStrategy
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ConfigurationDiagnostic
import com.heyanle.priestess.bot.config.model.DiagnosticSeverity
import com.heyanle.priestess.bot.config.model.ToolPolicyDocument
import com.heyanle.priestess.bot.config.model.ToolResultSettingsDocument
import com.heyanle.priestess.bot.config.model.WireProtocol
import com.heyanle.priestess.bot.agent.type.AgentTypeRegistry
import com.heyanle.priestess.bot.config.model.AgentEngine
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.WorkspaceCatalogEntryDocument
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import java.nio.file.Path

class ConfigurationValidator {
    fun validateGlobal(document: AppConfigDocument, source: String): List<ConfigurationDiagnostic> {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        if (document.schemaVersion != AppConfigDocument.CURRENT_SCHEMA_VERSION) {
            diagnostics.error("CONFIG_SCHEMA_VERSION_UNSUPPORTED", source, "schemaVersion", "Unsupported schema version ${document.schemaVersion}")
        }
        duplicates(document.platforms.map { it.id }).forEach {
            diagnostics.error("CONFIG_PLATFORM_ID_DUPLICATE", source, "platforms", "Duplicate platform id '$it'")
        }
        duplicates(document.providers.map { it.id }).forEach {
            diagnostics.error("CONFIG_PROVIDER_ID_DUPLICATE", source, "providers", "Duplicate provider id '$it'")
        }
        duplicates(document.workspaces.entries.map { it.id }).forEach {
            diagnostics.error("CONFIG_WORKSPACE_ID_DUPLICATE", source, "workspaces.entries", "Duplicate Workspace id '$it'")
        }
        document.platforms.forEachIndexed { index, platform ->
            validateId(platform.id, source, "platforms[$index].id", "platform", diagnostics)
            if (platform.type.isBlank()) diagnostics.error("CONFIG_PLATFORM_TYPE_BLANK", source, "platforms[$index].type", "Platform type must not be blank")
            platform.defaultWorkspaceId?.takeIf { it.isNotBlank() }?.let { workspaceId ->
                if (document.workspaces.entries.none { it.id == workspaceId && it.enabled }) {
                    diagnostics.error(
                        "CONFIG_PLATFORM_WORKSPACE_MISSING",
                        source,
                        "platforms[$index].defaultWorkspaceId",
                        "Platform '${platform.id}' references unknown or disabled Workspace '$workspaceId'",
                    )
                }
            }
            platform.credentialRefs.forEach { (name, reference) ->
                if (name.isBlank() || reference.key.isBlank()) {
                    diagnostics.error("CONFIG_CREDENTIAL_REFERENCE_INVALID", source, "platforms[$index].credentialRefs", "Credential reference names and keys must not be blank")
                }
            }
        }
        document.providers.forEachIndexed { index, provider ->
            validateId(provider.id, source, "providers[$index].id", "provider", diagnostics)
            if (provider.type.isBlank()) diagnostics.error("CONFIG_PROVIDER_TYPE_BLANK", source, "providers[$index].type", "Provider type must not be blank")
            val resolvedProtocol = WireProtocol.resolve(provider.type, provider.protocol)
            if (provider.protocol != null && resolvedProtocol == null) {
                diagnostics.error(
                    "CONFIG_PROVIDER_PROTOCOL_UNKNOWN", source, "providers[$index].protocol",
                    "Provider '${provider.id}' declares unknown protocol '${provider.protocol}'",
                )
            } else if (resolvedProtocol != null && WireProtocol.supportedFor(provider.type)?.contains(resolvedProtocol) == false) {
                diagnostics.error(
                    "CONFIG_PROVIDER_PROTOCOL_UNSUPPORTED", source, "providers[$index].protocol",
                    "Provider '${provider.id}' of type '${provider.type}' does not support protocol '${resolvedProtocol.name}'",
                )
            }
            if (provider.credentialRef?.key?.isBlank() == true) {
                diagnostics.error("CONFIG_CREDENTIAL_REFERENCE_INVALID", source, "providers[$index].credentialRef.key", "Credential reference key must not be blank")
            }
        }
        document.workspaces.entries.forEachIndexed { index, workspace ->
            validateWorkspaceCatalogEntry(workspace, source, index, diagnostics)
        }
        val defaultWorkspace = document.workspaces.entries.find { it.id == document.workspaces.defaultWorkspaceId }
        if (defaultWorkspace == null || !defaultWorkspace.enabled) {
            diagnostics.error(
                "CONFIG_DEFAULT_WORKSPACE_MISSING",
                source,
                "workspaces.defaultWorkspaceId",
                "Default Workspace '${document.workspaces.defaultWorkspaceId}' is missing or disabled",
            )
        }
        val runtime = document.runtime
        if (runtime.server.port !in 1..65_535) diagnostics.error("CONFIG_SERVER_PORT_INVALID", source, "runtime.server.port", "Server port must be between 1 and 65535")
        if (runtime.reload.intervalMillis < 250) diagnostics.error("CONFIG_RELOAD_INTERVAL_INVALID", source, "runtime.reload.intervalMillis", "Reload interval must be at least 250 ms")
        if (runtime.reload.stabilityWindowMillis < 0) diagnostics.error("CONFIG_RELOAD_STABILITY_INVALID", source, "runtime.reload.stabilityWindowMillis", "Reload stability window must not be negative")
        if (runtime.pipeline.rateLimitPerMinute <= 0) diagnostics.error("CONFIG_RATE_LIMIT_INVALID", source, "runtime.pipeline.rateLimitPerMinute", "Rate limit must be positive")
        if (runtime.pipeline.maxHistoryMessages < 0) diagnostics.error("CONFIG_HISTORY_LIMIT_INVALID", source, "runtime.pipeline.maxHistoryMessages", "History limit must not be negative")
        return diagnostics
    }

    fun validateWorkspace(
        document: WorkspaceConfigDocument,
        catalogEntry: WorkspaceCatalogEntryDocument,
        providers: Set<String>,
        providerConnections: Map<String, EffectiveProviderConnection> = emptyMap(),
        availableToolIds: Set<String>,
        availableSkillIds: Set<String>,
        mcpToolIds: Set<String> = emptySet(),
        source: String,
    ): List<ConfigurationDiagnostic> {
        val diagnostics = mutableListOf<ConfigurationDiagnostic>()
        if (document.schemaVersion != WorkspaceConfigDocument.CURRENT_SCHEMA_VERSION) {
            diagnostics.error("WORKSPACE_SCHEMA_VERSION_UNSUPPORTED", source, "schemaVersion", "Unsupported Workspace schema version ${document.schemaVersion}")
        }
        if (document.id != catalogEntry.id) {
            diagnostics.error("WORKSPACE_ID_MISMATCH", source, "id", "Workspace id '${document.id}' does not match catalog id '${catalogEntry.id}'")
        }
        validateId(document.id, source, "id", "Workspace", diagnostics)
        if (document.name.isBlank()) diagnostics.error("WORKSPACE_NAME_BLANK", source, "name", "Workspace name must not be blank")

        duplicates(document.agents.map { it.id }).forEach { diagnostics.error("WORKSPACE_AGENT_ID_DUPLICATE", source, "agents", "Duplicate Agent id '$it'") }
        duplicates(document.orchestration.routes.map { it.id }).forEach { diagnostics.error("WORKSPACE_ROUTE_ID_DUPLICATE", source, "orchestration.routes", "Duplicate route id '$it'") }
        duplicates(document.skills.map { it.id }).forEach { diagnostics.error("WORKSPACE_SKILL_ID_DUPLICATE", source, "skills", "Duplicate skill id '$it'") }
        duplicates(document.mcpServers.map { it.id }).forEach { diagnostics.error("WORKSPACE_MCP_ID_DUPLICATE", source, "mcpServers", "Duplicate MCP server id '$it'") }
        duplicates(document.personas.map { it.id }).forEach { diagnostics.error("WORKSPACE_PERSONA_ID_DUPLICATE", source, "personas", "Duplicate persona id '$it'") }

        val enabledAgents = document.agents.filter { it.enabled }.associateBy { it.id }
        if (document.primaryAgentId !in enabledAgents) {
            diagnostics.error("WORKSPACE_PRIMARY_AGENT_MISSING", source, "primaryAgentId", "Primary Agent '${document.primaryAgentId}' is missing or disabled")
        }
        document.orchestration.defaultAgentId?.let { defaultId ->
            if (defaultId !in enabledAgents) diagnostics.error("WORKSPACE_DEFAULT_AGENT_MISSING", source, "orchestration.defaultAgentId", "Default Agent '$defaultId' is missing or disabled")
        }
        document.orchestration.routes.forEachIndexed { index, route ->
            validateId(route.id, source, "orchestration.routes[$index].id", "route", diagnostics)
            if (route.targetAgentId !in enabledAgents) {
                diagnostics.error("WORKSPACE_ROUTE_AGENT_MISSING", source, "orchestration.routes[$index].targetAgentId", "Route '${route.id}' targets missing or disabled Agent '${route.targetAgentId}'")
            }
        }
        val personaIds = document.personas.filter { it.enabled }.map { it.id }.toSet()
        val knownTools = availableToolIds + mcpToolIds
        document.agents.forEachIndexed { index, agent ->
            validateId(agent.id, source, "agents[$index].id", "Agent", diagnostics)
            val type = AgentTypeRegistry.of(agent.type)
            val protocol = providerConnections[agent.providerRef]?.protocol
            if (agent.enabled && !type.available) diagnostics.error(
                "WORKSPACE_AGENT_TYPE_UNAVAILABLE", source, "agents[$index].type",
                "Agent '${agent.id}' type '${agent.type}' is not available in this runtime",
            )
            if (protocol != null && protocol !in type.llmProtocols) diagnostics.error(
                "WORKSPACE_AGENT_PROTOCOL_UNSUPPORTED", source, "agents[$index].providerRef",
                "Agent '${agent.id}' type '${agent.type}' does not support '${protocol.name}'",
            )
            if (type.engine == AgentEngine.CODEX && protocol == null) diagnostics.error(
                "WORKSPACE_AGENT_PROTOCOL_REQUIRED", source, "agents[$index].providerRef",
                "Agent '${agent.id}' type CODEX requires OPENAI_RESPONSES",
            )
            if (agent.enabled && type.engine == AgentEngine.CODEX && providerConnections[agent.providerRef]?.credential == null) diagnostics.error(
                "WORKSPACE_AGENT_CREDENTIAL_REQUIRED", source, "agents[$index].providerRef",
                "Agent '${agent.id}' type CODEX requires a resolved provider credential",
            )
            if (agent.providerRef !in providers) diagnostics.error("WORKSPACE_AGENT_PROVIDER_MISSING", source, "agents[$index].providerRef", "Agent '${agent.id}' references unknown or disabled provider '${agent.providerRef}'")
            if (agent.model.isBlank()) diagnostics.error("WORKSPACE_AGENT_MODEL_BLANK", source, "agents[$index].model", "Agent '${agent.id}' model must not be blank")
            if (agent.generation.temperature !in 0.0..2.0) diagnostics.error("WORKSPACE_AGENT_TEMPERATURE_INVALID", source, "agents[$index].generation.temperature", "Agent temperature must be between 0 and 2")
            if (agent.generation.maxOutputTokens != null && agent.generation.maxOutputTokens <= 0) diagnostics.error("WORKSPACE_AGENT_OUTPUT_TOKENS_INVALID", source, "agents[$index].generation.maxOutputTokens", "Max output tokens must be positive")
            if (agent.context.compression.maxRounds <= 0 || agent.context.compression.maxTokens <= 0) diagnostics.error("WORKSPACE_AGENT_CONTEXT_INVALID", source, "agents[$index].context.compression", "Context limits must be positive")
            // The allowlist comes from the strategy enum itself, so it cannot drift from the compiler.
            if (agent.context.compression.strategy !in CompressStrategy.configNames) diagnostics.error(
                "WORKSPACE_AGENT_COMPRESSION_UNSUPPORTED",
                source,
                "agents[$index].context.compression.strategy",
                "Compression strategy must be one of ${CompressStrategy.configNames.sorted().joinToString()}",
            )
            validateToolResultSettings(
                settings = agent.context.toolResults,
                source = source,
                path = "agents[$index].context.toolResults",
                diagnostics = diagnostics,
            )
            if (agent.execution.maxSteps <= 0 || agent.execution.toolTimeoutMillis <= 0) diagnostics.error("WORKSPACE_AGENT_EXECUTION_INVALID", source, "agents[$index].execution", "Execution limits must be positive")
            agent.personaRef?.let { persona ->
                if (persona !in personaIds) diagnostics.error("WORKSPACE_AGENT_PERSONA_MISSING", source, "agents[$index].personaRef", "Agent '${agent.id}' references unknown or disabled persona '$persona'")
            }
            validateToolPolicy(agent.toolPolicy, knownTools, source, "agents[$index].toolPolicy", diagnostics)
        }
        validateToolPolicy(document.toolPolicy, knownTools, source, "toolPolicy", diagnostics)
        document.skills.filter { it.enabled && it.id !in availableSkillIds }.forEachIndexed { index, skill ->
            diagnostics.error("WORKSPACE_SKILL_MISSING", source, "skills[$index].id", "Workspace references unavailable skill '${skill.id}'")
        }
        document.mcpServers.forEachIndexed { index, server ->
            validateId(server.id, source, "mcpServers[$index].id", "MCP server", diagnostics)
            if (server.transport == "stdio" && server.command.isBlank()) diagnostics.error("WORKSPACE_MCP_COMMAND_MISSING", source, "mcpServers[$index].command", "stdio MCP server '${server.id}' requires command")
            if (server.transport != "stdio" && server.url.isBlank()) diagnostics.error("WORKSPACE_MCP_URL_MISSING", source, "mcpServers[$index].url", "MCP server '${server.id}' requires URL")
        }
        if (document.memory.maxInjectedMemories < 0) diagnostics.error("WORKSPACE_MEMORY_LIMIT_INVALID", source, "memory.maxInjectedMemories", "Memory injection limit must not be negative")
        return diagnostics
    }

    private fun validateWorkspaceCatalogEntry(
        entry: WorkspaceCatalogEntryDocument,
        source: String,
        index: Int,
        diagnostics: MutableList<ConfigurationDiagnostic>,
    ) {
        validateId(entry.id, source, "workspaces.entries[$index].id", "Workspace", diagnostics)
        if (entry.directory.isBlank()) {
            diagnostics.error("CONFIG_WORKSPACE_DIRECTORY_BLANK", source, "workspaces.entries[$index].directory", "Workspace directory must not be blank")
        } else {
            val path = runCatching { Path.of(entry.directory).normalize() }.getOrNull()
            if (path == null || path.toString() == "/" || (!path.isAbsolute && path.startsWith(".."))) {
                diagnostics.error("CONFIG_WORKSPACE_DIRECTORY_UNSAFE", source, "workspaces.entries[$index].directory", "Workspace directory is unsafe")
            }
        }
        duplicates(entry.selectionRules.map { it.id }).forEach {
            diagnostics.error("CONFIG_WORKSPACE_RULE_ID_DUPLICATE", source, "workspaces.entries[$index].selectionRules", "Duplicate Workspace selection rule id '$it'")
        }
    }

    private fun validateToolPolicy(
        policy: ToolPolicyDocument,
        knownTools: Set<String>,
        source: String,
        path: String,
        diagnostics: MutableList<ConfigurationDiagnostic>,
    ) {
        duplicates(policy.allow).forEach { diagnostics.error("WORKSPACE_TOOL_ALLOW_DUPLICATE", source, "$path.allow", "Tool '$it' is allowed more than once") }
        duplicates(policy.deny).forEach { diagnostics.error("WORKSPACE_TOOL_DENY_DUPLICATE", source, "$path.deny", "Tool '$it' is denied more than once") }
        (policy.allow.toSet() intersect policy.deny.toSet()).forEach {
            diagnostics.error("WORKSPACE_TOOL_POLICY_CONTRADICTORY", source, path, "Tool '$it' is both allowed and denied")
        }
        (policy.allow + policy.deny).filter { it !in knownTools }.distinct().forEach {
            diagnostics.error("WORKSPACE_TOOL_UNKNOWN", source, path, "Tool policy references unknown tool '$it'")
        }
        duplicates(policy.allowedRiskLevels).forEach {
            diagnostics.error("WORKSPACE_TOOL_RISK_DUPLICATE", source, "$path.allowedRiskLevels", "Risk level '$it' is listed more than once")
        }
        policy.minimumPermissionGroups.keys.filter(String::isBlank).forEach {
            diagnostics.error("WORKSPACE_TOOL_MINIMUM_PERMISSION_INVALID", source, "$path.minimumPermissionGroups", "Tool name must not be blank")
        }
    }

    private fun validateToolResultSettings(
        settings: ToolResultSettingsDocument,
        source: String,
        path: String,
        diagnostics: MutableList<ConfigurationDiagnostic>,
    ) {
        if (settings.inlineTokens <= 0) {
            diagnostics.error("WORKSPACE_TOOL_RESULT_INLINE_TOKENS_INVALID", source, "$path.inlineTokens", "Inline tool-result tokens must be positive")
        }
        if (settings.previewTokens <= 0 || settings.previewTokens > settings.inlineTokens) {
            diagnostics.error(
                "WORKSPACE_TOOL_RESULT_PREVIEW_TOKENS_INVALID",
                source,
                "$path.previewTokens",
                "Preview tool-result tokens must be positive and not exceed inlineTokens",
            )
        }
        if (settings.ttlSeconds <= 0) {
            diagnostics.error("WORKSPACE_TOOL_RESULT_TTL_INVALID", source, "$path.ttlSeconds", "Tool-result TTL must be positive")
        }
        if (settings.maxBytes <= 0) {
            diagnostics.error("WORKSPACE_TOOL_RESULT_MAX_BYTES_INVALID", source, "$path.maxBytes", "Maximum tool-result bytes must be positive")
        }
        if (settings.storeMaxBytes <= 0 || settings.storeMaxBytes < settings.maxBytes) {
            diagnostics.error(
                "WORKSPACE_TOOL_RESULT_STORE_BYTES_INVALID",
                source,
                "$path.storeMaxBytes",
                "Total tool-result storage must be positive and at least maxBytes",
            )
        }
    }

    private fun validateId(
        id: String,
        source: String,
        path: String,
        label: String,
        diagnostics: MutableList<ConfigurationDiagnostic>,
    ) {
        if (!ID_PATTERN.matches(id)) diagnostics.error("CONFIG_ID_INVALID", source, path, "$label id '$id' must match ${ID_PATTERN.pattern}")
    }

    private fun <T> duplicates(values: List<T>): Set<T> = values.groupingBy { it }.eachCount().filterValues { it > 1 }.keys

    private fun MutableList<ConfigurationDiagnostic>.error(code: String, source: String, path: String, message: String) {
        add(ConfigurationDiagnostic(code, DiagnosticSeverity.ERROR, message, source, path))
    }

    companion object {
        private val ID_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
    }
}
