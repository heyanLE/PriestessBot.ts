package com.heyanle.priestess.bot.skill

import com.heyanle.priestess.bot.pipeline.PermissionGroup

/**
 * 技能接口，用于判断并处理特定类型的用户消息。
 *
 * 技能按优先级从高到低评估；当 [canHandle] 返回 true 时调用 [execute]，
 * 若没有技能可处理消息，则由 [DefaultSkill] 兜底。
 */
interface Skill {
    /** 技能唯一名称，用于日志记录和注册。 */
    val name: String

    /** 面向用户或管理界面的技能说明。 */
    val description: String

    /**
     * 可选的 SKILL.md 内容，用于注入模型提示。
     *
     * 由真实技能目录驱动的实现应在这里暴露解析后的 SKILL.md 文本；
     * 下方默认渲染逻辑只作为旧内置技能的兼容兜底。
     */
    val skillMarkdown: String?
        get() = null

    /**
     * 技能优先级，数值越高越先被评估。
     */
    val priority: Int

    val requiredPermissionGroup: PermissionGroup
        get() = PermissionGroup.OPERATOR

    /**
     * 判断该技能是否可以处理给定消息。
     *
     * @param message 待评估的用户消息文本。
     * @return 如果该技能应处理消息则返回 true。
     */
    suspend fun canHandle(message: String): Boolean

    /**
     * 执行技能逻辑并返回响应，仅在 [canHandle] 为 true 时调用。
     *
     * @param message 待处理的用户消息文本。
     * @return 技能生成的响应文本。
     */
    suspend fun execute(message: String): String

    /**
     * 将技能渲染为可注入流水线的 Markdown 提示文档。
     */
    fun promptMarkdown(settings: Map<String, String> = emptyMap()): String {
        skillMarkdown?.takeIf { it.isNotBlank() }?.let { markdown ->
            if (settings.isEmpty()) return markdown.trim()
            return buildString {
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
        return buildString {
            append("# Skill: ")
            append(name)
            append("\n\n## Description\n")
            append(description.ifBlank { "No description provided." })
            append("\n\n## Priority\n")
            append(priority)
            if (settings.isNotEmpty()) {
                append("\n\n## Settings\n")
                settings.entries.sortedBy { it.key }.forEach { (key, value) ->
                    append("- ")
                    append(key)
                    append(": ")
                    append(value)
                    append("\n")
                }
            }
        }.trim()
    }
}
