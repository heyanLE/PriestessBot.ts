package com.heyanle.priestess.bot.persona

/**
 * 人设模块门面，向外提供人设查询、保存、删除和解析能力。
 */
class PersonaCase(
    private val controller: PersonaController,
) {
    fun list(workspaceId: String): List<Persona> = controller.list(workspaceId)

    fun get(id: String): Persona? = controller.get(id)

    fun upsert(request: PersonaUpsertRequest): Persona = controller.upsert(request)

    fun delete(id: String): Boolean = controller.delete(id)

    fun resolve(workspaceId: String, agentName: String): Persona? = controller.resolve(workspaceId, agentName)
}
