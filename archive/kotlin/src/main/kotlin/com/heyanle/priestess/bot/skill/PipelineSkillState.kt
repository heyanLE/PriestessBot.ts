package com.heyanle.priestess.bot.skill

import java.nio.file.Files
import java.nio.file.Path
import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * 技能提示文档，保存可注入模型上下文的技能名称和 Markdown 内容。
 */
data class SkillPromptDocument(
    val name: String,
    val markdown: String,
    val sourcePath: String? = null,
)

/**
 * 工作区可见技能引用，按需加载 SKILL.md。
 */
data class SkillPromptReference(
    val name: String,
    val description: String = "",
    val markdownPath: String? = null,
    val inlineMarkdown: String? = null,
    val settings: Map<String, String> = emptyMap(),
    val requiredPermissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
) {
    fun loadDocument(): SkillPromptDocument {
        val markdown = inlineMarkdown ?: markdownPath
            ?.takeIf { it.isNotBlank() }
            ?.let { path -> Files.readString(Path.of(path)) }
            ?: ""
        val rendered = if (settings.isEmpty()) {
            markdown.trim()
        } else {
            buildString {
                append(markdown.trim())
                append("\n\n## Settings\n")
                settings.entries.sortedBy { it.key }.forEach { (key, value) ->
                    append("- ")
                    append(key)
                    append(": ")
                    append(value)
                    append("\n")
                }
            }.trim()
        }
        return SkillPromptDocument(name = name, markdown = rendered, sourcePath = markdownPath)
    }
}

/**
 * 流水线技能状态，记录当前工作区可用和已加载的技能提示文档。
 */
class PipelineSkillState(
    availableSkills: List<SkillPromptReference> = emptyList(),
    private val permissionGroup: PermissionGroup = PermissionGroup.OPERATOR,
) {
    private val availableByName = availableSkills.associateBy { it.name }
    private val loadedByName = linkedMapOf<String, SkillPromptDocument>()

    val availableNames: List<String>
        get() = availableByName.keys.sorted()

    val loadedNames: List<String>
        get() = loadedByName.keys.toList()

    fun requiredPermissionFor(name: String): PermissionGroup? =
        availableByName[name.trim()]?.requiredPermissionGroup

    fun canLoad(name: String): Boolean = requiredPermissionFor(name)?.let(permissionGroup::satisfies) ?: false

    /** Only references authorized by this run's permission are exposed to runtime readers. */
    fun authorizedReferences(): List<SkillPromptReference> = availableByName.values
        .filter { permissionGroup.satisfies(it.requiredPermissionGroup) }.sortedBy { it.name }

    fun reference(name: String): SkillPromptReference? = availableByName[name.trim()]
        ?.takeIf { permissionGroup.satisfies(it.requiredPermissionGroup) }

    /** Read without changing the set of skills injected into subsequent model turns. */
    fun peek(name: String): SkillPromptDocument? = reference(name)?.loadDocument()

    fun load(name: String): SkillPromptDocument? {
        val normalized = name.trim()
        if (!canLoad(normalized)) return null
        val document = availableByName[normalized]?.loadDocument() ?: return null
        loadedByName[normalized] = document
        return document
    }

    fun unload(name: String): Boolean {
        return loadedByName.remove(name.trim()) != null
    }

    fun renderLoadedSkillBlock(): String {
        if (loadedByName.isEmpty()) return "No skills loaded."
        return buildString {
            append("Loaded SKILL.md documents:")
            loadedByName.values.forEach { document ->
                append("\n\n---\n")
                append("Skill: ").append(document.name).append('\n')
                document.sourcePath?.let {
                    append("Skill directory: ").append(Path.of(it).parent).append('\n')
                    append("Resolve this skill's relative resource paths against its directory.\n")
                }
                append(document.markdown.trim())
            }
        }
    }

    fun renderAvailableSkillBlock(): String {
        if (availableByName.isEmpty()) return "none"
        return availableByName.values.sortedBy { it.name }.joinToString("\n") { reference ->
            val warning = if (!permissionGroup.satisfies(reference.requiredPermissionGroup)) {
                " (当前权限不足：需要 ${reference.requiredPermissionGroup})"
            } else ""
            "- ${reference.name}: ${reference.description.ifBlank { "No description." }}$warning"
        }
    }
}
