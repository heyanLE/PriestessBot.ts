package com.heyanle.priestess.bot.skill

import com.heyanle.priestess.bot.core.controller.BaseController

/**
 * 技能控制器，负责维护已注册技能、按优先级分发消息并承接技能模块生命周期。
 */
class SkillController : BaseController("SkillController") {

    private val skills = mutableListOf<Skill>()

    fun register(skill: Skill) {
        skills.add(skill)
        skills.sortByDescending { it.priority }
    }

    fun registerAll(newSkills: Collection<Skill>) {
        skills.addAll(newSkills)
        skills.sortByDescending { it.priority }
    }

    fun sortByPriority() {
        skills.sortByDescending { it.priority }
    }

    suspend fun dispatch(message: String): String? {
        for (skill in skills) {
            if (skill.canHandle(message)) {
                return skill.execute(message)
            }
        }
        return null
    }

    fun getAll(): List<Skill> = skills.toList()

    fun unregister(name: String) {
        skills.removeAll { it.name == name }
    }

    fun clear() {
        skills.clear()
    }

    fun size(): Int = skills.size

    fun isEmpty(): Boolean = skills.isEmpty()
}
