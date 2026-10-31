package com.heyanle.priestess.bot.workspace

import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.core.controller.BaseController
import java.nio.file.Path

/** Workspace query/reload boundary backed exclusively by activated v2 snapshots. */
class WorkspaceController(
    private val effectiveStore: EffectiveConfigStore,
    private val configurationRuntime: ConfigurationRuntimeService,
    private val nowProvider: () -> Long = System::currentTimeMillis,
) : BaseController("WorkspaceController") {
    private val lock = Any()
    private val lastReloads = linkedMapOf<String, WorkspaceReloadResult>()

    fun list(): List<WorkspaceStatus> {
        val active = effectiveStore.requireCurrent()
        return active.workspaces.values.map { workspace ->
            WorkspaceStatus(
                id = workspace.config.id,
                name = workspace.config.name,
                enabled = workspace.config.enabled,
                activeSnapshotVersion = workspace.version.value,
                loadedAt = active.loadedAtEpochMillis,
                lastReload = synchronized(lock) { lastReloads[workspace.config.id] },
                diagnostics = workspace.diagnostics.map { "${it.code}: ${it.message}" },
            )
        }.sortedBy { it.id }
    }

    fun get(id: String): WorkspaceSnapshot? {
        val active = effectiveStore.requireCurrent()
        return active.workspaces[id]?.toRuntimeView(active.loadedAtEpochMillis)
    }

    fun getEffective(id: String): EffectiveWorkspaceSnapshot? = effectiveStore.requireCurrent().workspaces[id]

    fun reload(id: String): WorkspaceReloadResult {
        val before = effectiveStore.requireCurrent()
        if (id !in before.workspaces) return failedReload(id, "Workspace '$id' is not registered and active")
        val operation = configurationRuntime.reloadWorkspace(id)
        return WorkspaceReloadResult(
            workspaceId = id,
            success = operation.success,
            status = if (operation.success) "SUCCESS" else "FAILED",
            snapshotVersion = effectiveStore.current()?.workspaces?.get(id)?.version?.value,
            timestamp = nowProvider(),
            diagnostics = operation.diagnostics.map { "${it.code}: ${it.message}" },
            errorSummary = operation.diagnostics.firstOrNull()?.message.takeUnless { operation.success },
        ).also { synchronized(lock) { lastReloads[id] = it } }
    }

    fun reloadAll(): List<WorkspaceReloadResult> {
        val ids = effectiveStore.requireCurrent().workspaces.keys.sorted()
        if (ids.isEmpty()) return emptyList()
        val operation = configurationRuntime.reloadFromDisk()
        return ids.map { id ->
            WorkspaceReloadResult(
                workspaceId = id,
                success = operation.success,
                status = if (operation.success) "SUCCESS" else "FAILED",
                snapshotVersion = effectiveStore.current()?.workspaces?.get(id)?.version?.value,
                timestamp = nowProvider(),
                diagnostics = operation.diagnostics.map { "${it.code}: ${it.message}" },
                errorSummary = operation.diagnostics.firstOrNull()?.message.takeUnless { operation.success },
            ).also { synchronized(lock) { lastReloads[id] = it } }
        }
    }

    private fun failedReload(id: String, message: String): WorkspaceReloadResult {
        return WorkspaceReloadResult(
            workspaceId = id,
            success = false,
            status = "FAILED",
            snapshotVersion = effectiveStore.current()?.workspaces?.get(id)?.version?.value,
            timestamp = nowProvider(),
            diagnostics = listOf(message),
            errorSummary = message,
        ).also { synchronized(lock) { lastReloads[id] = it } }
    }

    private fun EffectiveWorkspaceSnapshot.toRuntimeView(loadedAt: Long): WorkspaceSnapshot {
        val workspace = config
        val root = configurationDirectory?.let(Path::of) ?: Path.of(sourcePath).parent
        return WorkspaceSnapshot(
            id = workspace.id,
            name = workspace.name,
            enabled = workspace.enabled,
            version = version.value,
            loadedAt = loadedAt,
            rootDir = root?.toString().orEmpty(),
            agentIds = workspace.agents.filter { it.enabled }.map { it.id },
            providerName = agents[workspace.primaryAgentId]?.provider?.id.orEmpty(),
            toolNames = availableToolIds.sorted(),
            skillDescriptors = workspace.skills.filter { it.enabled }.map {
                WorkspaceSkillDescriptor(it.id, directoryPath = root?.resolve("skills")?.resolve(it.id)?.toString().orEmpty(), skillMarkdownPath = root?.resolve("skills")?.resolve(it.id)?.resolve("SKILL.md")?.toString().orEmpty(), settings = it.settings)
            },
            skillSettings = workspace.skills.associate { it.id to it.settings },
            mcpServers = workspace.mcpServers.filter { it.enabled }.map { WorkspaceMcpServerDeclaration(it.id, true, it.transport, it.command, it.args, it.url, sourcePath = sourcePath) },
            personaIds = workspace.personas.filter { it.enabled }.map { it.id },
            memoryPolicy = WorkspaceMemoryPolicyConfig(workspace.memory.enabled, workspace.memory.allowedScopes, workspace.memory.knowledgeBaseIds, workspace.memory.maxInjectedMemories),
            diagnostics = diagnostics.map { "${it.code}: ${it.message}" },
        )
    }
}
