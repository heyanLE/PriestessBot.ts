package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryScope
import com.heyanle.priestess.bot.memory.MemoryScopeContext
import com.heyanle.priestess.bot.memory.MemorySearchQuery
import com.heyanle.priestess.bot.memory.MemorySearchResult
import com.heyanle.priestess.bot.memory.MemoryType
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCapabilities
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class MemorySaveTool(
    private val memoryCaseProvider: () -> MemoryCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "memory_save",
        description = "Save a scoped long-term memory for future recall.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("content", "string", "Memory content to save", required = true),
                ParameterDef("library_id", "string", "Selected memory library to write; defaults to the configured write library or the only selected library"),
                ParameterDef("type", "string", "Memory type", enumValues = MemoryType.entries.map { it.name.lowercase() }),
                ParameterDef("scope", "string", "Memory scope", enumValues = MemoryScope.entries.map { it.name.lowercase() }),
                ParameterDef("ttl_seconds", "string", "Optional time-to-live in seconds"),
                ParameterDef("tags", "array", "Optional tags", items = "string"),
                ParameterDef("confidence", "string", "Optional confidence from 0.0 to 1.0"),
            ),
            required = listOf("content"),
        ),
        riskLevel = ToolRiskLevel.STATE_WRITE,
        requiredCapabilities = listOf(ToolCapabilities.MEMORY),
        defaultEnabled = false,
        auditLog = true,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val content = args["content"]?.trim().orEmpty()
        if (content.isBlank()) {
            return ToolResult.error("content is required", "VALIDATION_ERROR")
        }
        val type = parseType(args["type"]) ?: return ToolResult.error("Unsupported memory type", "VALIDATION_ERROR")
        val scope = parseScope(args["scope"]) ?: return ToolResult.error("Unsupported memory scope", "VALIDATION_ERROR")
        memoryPolicyError(context, scope)?.let { return it }
        val libraries = context.metadata.selectedMemoryLibraryIds()
        val libraryId = args["library_id"]?.trim()?.takeIf { it.isNotBlank() }
            ?: context.metadata["memoryWriteLibraryId"]?.trim()?.takeIf { it.isNotBlank() }
            ?: if (libraries == null) "default" else libraries.singleOrNull()
            ?: return ToolResult.error("Choose library_id from the selected memory libraries", "MEMORY_LIBRARY_REQUIRED")
        memoryLibraryError(context, libraryId)?.let { return it }
        val ttlSeconds = args["ttl_seconds"]?.takeIf { it.isNotBlank() }?.toLongOrNull()
        if (args["ttl_seconds"]?.isNotBlank() == true && (ttlSeconds == null || ttlSeconds <= 0)) {
            return ToolResult.error("ttl_seconds must be a positive integer", "VALIDATION_ERROR")
        }
        val expiresAt = ttlSeconds?.let { System.currentTimeMillis() + it * 1000 }
        val tags = parseTags(args["tags"])
        val confidence = args["confidence"]?.takeIf { it.isNotBlank() }?.toDoubleOrNull()?.coerceIn(0.0, 1.0) ?: 1.0

        return runCatching {
            val record = memoryCaseProvider().save(
                content = content,
                type = type,
                scope = scope,
                scopeContext = context.toMemoryScopeContext(),
                tags = tags,
                confidence = confidence,
                expiresAt = expiresAt,
                libraryId = libraryId,
            )
            ToolResult.success(json.encodeToString(MemorySaveResponse(memoryId = record.id, expiresAt = record.expiresAt, libraryId = record.libraryId)))
        }.getOrElse {
            ToolResult.error(it.message ?: "Failed to save memory", "VALIDATION_ERROR")
        }
    }
}

class MemoryRecallTool(
    private val memoryCaseProvider: () -> MemoryCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "memory_recall",
        description = "Recall scoped long-term memories visible to the current context.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("query", "string", "Search query"),
                ParameterDef("library_id", "string", "Optional selected memory library; omitted searches all selected libraries"),
                ParameterDef("scope", "string", "Optional scope filter", enumValues = MemoryScope.entries.map { it.name.lowercase() }),
                ParameterDef("type", "string", "Optional type filter", enumValues = MemoryType.entries.map { it.name.lowercase() }),
                ParameterDef("limit", "string", "Maximum results, 1-20"),
            ),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        requiredCapabilities = listOf(ToolCapabilities.MEMORY),
        defaultEnabled = true,
        auditLog = false,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val policyLimit = memoryPolicyLimit(context)
        val limit = (args["limit"]?.toIntOrNull() ?: policyLimit).coerceIn(1, policyLimit)
        val scope = args["scope"]?.takeIf { it.isNotBlank() }?.let(::parseScope)
        val type = args["type"]?.takeIf { it.isNotBlank() }?.let(::parseType)
        if (args["scope"]?.isNotBlank() == true && scope == null) {
            return ToolResult.error("Unsupported memory scope", "VALIDATION_ERROR")
        }
        if (args["type"]?.isNotBlank() == true && type == null) {
            return ToolResult.error("Unsupported memory type", "VALIDATION_ERROR")
        }
        memoryPolicyError(context, scope)?.let { return it }
        val libraryId = args["library_id"]?.trim()?.takeIf { it.isNotBlank() }
        memoryLibraryError(context, libraryId)?.let { return it }
        val allowedScopes = context.metadata.memoryAllowedScopes()
        val results = memoryCaseProvider().search(
            MemorySearchQuery(
                query = args["query"].orEmpty(),
                scopeContext = context.toMemoryScopeContext(libraryId),
                scope = scope,
                type = type,
                limit = limit,
            ),
        ).filter { allowedScopes == null || it.record.scope.name in allowedScopes }
            .take(limit)
        return ToolResult.success(json.encodeToString(MemoryRecallResponse(results.map { it.toDto() })))
    }
}

class MemoryDeleteTool(
    private val memoryCaseProvider: () -> MemoryCase,
) : FunctionTool() {
    override val schema: ToolSchema = ToolSchema(
        name = "memory_delete",
        description = "Delete one visible memory by exact memory id.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("memory_id", "string", "Exact memory id to delete", required = true),
                ParameterDef("library_id", "string", "Optional selected memory library to restrict the deletion"),
            ),
            required = listOf("memory_id"),
        ),
        riskLevel = ToolRiskLevel.STATE_WRITE,
        requiredCapabilities = listOf(ToolCapabilities.MEMORY),
        defaultEnabled = false,
        auditLog = true,
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val id = args["memory_id"]?.trim().orEmpty()
        if (id.isBlank()) {
            return ToolResult.error("memory_id is required", "VALIDATION_ERROR")
        }
        memoryPolicyError(context, null)?.let { return it }
        val libraryId = args["library_id"]?.trim()?.takeIf { it.isNotBlank() }
        memoryLibraryError(context, libraryId)?.let { return it }
        val deleted = memoryCaseProvider().delete(id, context.toMemoryScopeContext(libraryId))
        if (!deleted) {
            return ToolResult.error("Memory not found or not visible", "NOT_FOUND")
        }
        return ToolResult.success(json.encodeToString(MemoryDeleteResponse(memoryId = id, deleted = true)))
    }
}

@Serializable
data class MemorySaveResponse(
    val memoryId: String,
    val expiresAt: Long? = null,
    val libraryId: String = "default",
)

@Serializable
data class MemoryRecallResponse(
    val results: List<MemoryRecallItem>,
)

@Serializable
data class MemoryRecallItem(
    val id: String,
    val scope: String,
    val type: String,
    val content: String,
    val tags: List<String>,
    val confidence: Double,
    val score: Double,
    val matchReason: String,
    val expiresAt: Long? = null,
    val libraryId: String = "default",
)

@Serializable
data class MemoryDeleteResponse(
    val memoryId: String,
    val deleted: Boolean,
)

private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

private fun AgentToolContext.toMemoryScopeContext(libraryId: String? = null): MemoryScopeContext {
    val metadata = this.metadata
    val platform = this.platform
    val session = this.session
    return MemoryScopeContext(
        workspaceId = if ("memoryLibraryIds" in metadata) "platform" else metadata["workspaceId"] ?: MemoryScopeContext.DEFAULT_WORKSPACE_ID,
        platformId = metadata["platformId"] ?: platform?.metadata?.name ?: session?.platformName,
        sessionId = metadata["sessionId"] ?: session?.id,
        userId = metadata["userId"] ?: metadata["senderId"] ?: session?.metadata?.get("userId") ?: session?.metadata?.get("senderId"),
        agentName = agentName.takeIf { it.isNotBlank() },
        libraryIds = libraryId?.let(::setOf) ?: metadata.selectedMemoryLibraryIds(),
        allowedScopes = metadata.memoryAllowedScopes()?.mapNotNull { value -> MemoryScope.entries.find { it.name == value } }?.toSet(),
    )
}

private fun parseScope(value: String?): MemoryScope? {
    val normalized = value?.trim()?.takeIf { it.isNotBlank() } ?: return MemoryScope.GLOBAL
    return MemoryScope.entries.find { it.name.equals(normalized, ignoreCase = true) }
}

private fun memoryPolicyError(context: AgentToolContext, scope: MemoryScope?): ToolResult? {
    if (!context.metadata.memoryEnabled()) {
        return ToolResult.error("Workspace memory policy is disabled", "WORKSPACE_MEMORY_DISABLED")
    }
    if (context.metadata.selectedMemoryLibraryIds()?.isEmpty() == true) {
        return ToolResult.error("No memory library is selected for this agent", "MEMORY_LIBRARY_DISABLED")
    }
    val allowedScopes = context.metadata.memoryAllowedScopes()
    if (scope != null && allowedScopes != null && scope.name !in allowedScopes) {
        return ToolResult.error("Memory scope '${scope.name}' is not allowed by workspace policy", "WORKSPACE_MEMORY_SCOPE_DENIED")
    }
    return null
}

private fun Map<String, String>.selectedMemoryLibraryIds(): Set<String>? {
    if ("memoryLibraryIds" !in this) return null
    return getValue("memoryLibraryIds").split(',').map(String::trim).filter(String::isNotBlank).toSet()
}

private fun memoryLibraryError(context: AgentToolContext, requested: String?): ToolResult? {
    val selected = context.metadata.selectedMemoryLibraryIds() ?: return null
    if (selected.isEmpty()) return ToolResult.error("No memory library is selected for this agent", "MEMORY_LIBRARY_DISABLED")
    if (requested != null && requested !in selected) {
        return ToolResult.error("Memory library '$requested' is not selected for this agent", "MEMORY_LIBRARY_DENIED")
    }
    return null
}

private fun memoryPolicyLimit(context: AgentToolContext): Int {
    return (context.metadata["workspaceMemoryMaxInjected"]
        ?: context.metadata["workspace_memory_max_injected"])
        ?.toIntOrNull()
        ?.coerceIn(1, 20)
        ?: 5
}

private fun Map<String, String>.memoryEnabled(): Boolean {
    return (this["workspaceMemoryEnabled"] ?: this["workspace_memory_enabled"])
        ?.toBooleanStrictOrNull()
        ?: true
}

private fun Map<String, String>.memoryAllowedScopes(): Set<String>? {
    val raw = this["workspaceMemoryAllowedScopes"]
        ?: this["workspace_memory_allowed_scopes"]
        ?: return null
    return raw.split(",")
        .map { it.trim().uppercase() }
        .filter { it.isNotBlank() }
        .toSet()
}

private fun parseType(value: String?): MemoryType? {
    val normalized = value?.trim()?.takeIf { it.isNotBlank() } ?: return MemoryType.FACT
    return MemoryType.entries.find { it.name.equals(normalized, ignoreCase = true) }
}

private fun parseTags(value: String?): List<String> {
    if (value.isNullOrBlank()) return emptyList()
    val trimmed = value.trim()
    return if (trimmed.startsWith("[")) {
        runCatching { json.decodeFromString<List<String>>(trimmed) }.getOrElse { emptyList() }
    } else {
        trimmed.split(",")
    }.map { it.trim() }.filter { it.isNotBlank() }.distinct()
}

private fun MemorySearchResult.toDto(): MemoryRecallItem {
    return MemoryRecallItem(
        id = record.id,
        scope = record.scope.name.lowercase(),
        type = record.type.name.lowercase(),
        content = record.content,
        tags = record.tags,
        confidence = record.confidence,
        score = score,
        matchReason = matchReason,
        expiresAt = record.expiresAt,
        libraryId = record.libraryId,
    )
}
