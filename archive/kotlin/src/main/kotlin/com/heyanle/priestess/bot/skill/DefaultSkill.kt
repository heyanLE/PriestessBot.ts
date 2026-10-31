package com.heyanle.priestess.bot.skill

/**
 * 默认兜底技能，在没有其他技能可处理消息时返回通用提示。
 */
class DefaultSkill : Skill {

    override val name = "default"
    override val description = "Default fallback skill that handles any message no other skill can process."
    override val priority = Int.MIN_VALUE

    override suspend fun canHandle(message: String): Boolean = true

    override suspend fun execute(message: String): String {
        return "I'm sorry, but I don't have a specific skill to handle this request. " +
                "Could you please rephrase or provide more details?"
    }
}
