package com.heyanle.priestess.bot.skill

import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.workspace.WorkspaceSnapshot
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * 技能模块门面，负责对外提供技能分发、注册和工作区技能提示状态。
 */
class SkillCase(
    private val controller: SkillController,
) {
    suspend fun dispatch(message: String): String? = controller.dispatch(message)
    fun register(skill: Skill) = controller.register(skill)
    fun getAll(): List<Skill> = controller.getAll()

    fun getWorkspaceSkillState(
        snapshot: WorkspaceSnapshot,
        permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    ): PipelineSkillState {
        return PipelineSkillState(getWorkspaceSkillReferences(snapshot, permissionGroup), permissionGroup)
    }

    fun getEffectiveSkillState(
        snapshot: EffectiveWorkspaceSnapshot,
        permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    ): PipelineSkillState {
        val configured = snapshot.config.skills
            .filter { it.enabled }
            .associateBy { it.id }
        val references = controller.getAll()
            .filter { it.name in configured }
            .sortedByDescending { it.priority }
            .map { skill ->
                val settings = configured.getValue(skill.name).settings
                SkillPromptReference(
                    name = skill.name,
                    description = skill.description,
                    inlineMarkdown = skill.skillMarkdown ?: skill.promptMarkdown(),
                    settings = settings,
                    requiredPermissionGroup = skill.requiredPermissionGroup,
                )
            }
        return PipelineSkillState(references, permissionGroup)
    }

    fun getWorkspaceSkillReferences(
        snapshot: WorkspaceSnapshot,
        permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
    ): List<SkillPromptReference> {
        return snapshot.skillDescriptors
            .filter { descriptor ->
                descriptor.requiredPermissionGroup != PermissionGroup.SUPER_ADMIN ||
                    permissionGroup.satisfies(PermissionGroup.SUPER_ADMIN)
            }
            .map { descriptor ->
            SkillPromptReference(
                name = descriptor.name,
                description = descriptor.description + if (
                    descriptor.requiredPermissionGroup == PermissionGroup.ADMIN &&
                    !permissionGroup.satisfies(PermissionGroup.ADMIN)
                ) "\n当前权限不足：需要 ADMIN。" else "",
                markdownPath = descriptor.skillMarkdownPath,
                inlineMarkdown = descriptor.inlineMarkdown,
                settings = descriptor.settings,
                requiredPermissionGroup = descriptor.requiredPermissionGroup,
            )
        }
    }

    fun getWorkspaceSkillSet(snapshot: WorkspaceSnapshot): WorkspaceSkillSet {
        val allowedNames = snapshot.skillNames.toSet()
        val settings = snapshot.skillSettings
        val scopedSkills = controller.getAll()
            .filter { it.name in allowedNames }
            .sortedByDescending { it.priority }
        return WorkspaceSkillSet(
            workspaceId = snapshot.id,
            skills = scopedSkills,
            settings = settings,
        )
    }

    suspend fun stop() {
        controller.stop()
    }
}

/**
 * 工作区技能集合，负责按优先级分发消息并渲染可注入提示文档。
 */
class WorkspaceSkillSet(
    val workspaceId: String,
    private val skills: List<Skill>,
    val settings: Map<String, Map<String, String>>,
) {
    val skillNames: List<String> = skills.map { it.name }

    suspend fun dispatch(message: String): String? {
        for (skill in skills) {
            if (skill.canHandle(message)) {
                return skill.execute(message)
            }
        }
        return null
    }

    fun setting(skillName: String, key: String): String? = settings[skillName]?.get(key)

    fun documents(): List<SkillPromptDocument> {
        return skills.map { skill ->
            SkillPromptDocument(
                name = skill.name,
                markdown = skill.promptMarkdown(settings[skill.name].orEmpty()),
            )
        }
    }

    fun isEmpty(): Boolean = skills.isEmpty()
}
