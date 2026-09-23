package com.heyanle.priestess.bot.persona

import kotlinx.serialization.Serializable

@Serializable
data class PersonaErrorMessages(
    val permissionDenied: String = "",
)

/**
 * 一组人设示例对话。运行时会按 user、assistant 的顺序作为 few-shot 消息注入。
 */
@Serializable
data class PersonaExampleDialog(
    val user: String,
    val assistant: String,
)

/**
 * 人设档案，描述智能体在指定工作区中的表达风格和行为边界。
 */
@Serializable
data class Persona(
    val id: String,
    val workspaceId: String,
    val name: String,
    val description: String = "",
    val tone: String = "",
    val boundaries: List<String> = emptyList(),
    val systemPromptTemplate: String = "",
    val exampleDialogs: List<PersonaExampleDialog> = emptyList(),
    val enabled: Boolean = true,
    val agentNames: List<String> = emptyList(),
    val errorMessages: PersonaErrorMessages = PersonaErrorMessages(),
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

/**
 * 人设保存请求，用于创建或更新一个工作区内的人设档案。
 */
data class PersonaUpsertRequest(
    val id: String? = null,
    val workspaceId: String,
    val name: String,
    val description: String = "",
    val tone: String = "",
    val boundaries: List<String> = emptyList(),
    val systemPromptTemplate: String = "",
    val exampleDialogs: List<PersonaExampleDialog> = emptyList(),
    val enabled: Boolean = true,
    val agentNames: List<String> = emptyList(),
    val errorMessages: PersonaErrorMessages = PersonaErrorMessages(),
)
