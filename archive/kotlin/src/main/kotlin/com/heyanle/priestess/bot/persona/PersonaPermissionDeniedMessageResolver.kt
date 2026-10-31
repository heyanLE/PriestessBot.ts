package com.heyanle.priestess.bot.persona

import com.heyanle.priestess.bot.pipeline.PermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionMessageContext

class PersonaPermissionDeniedMessageResolver(
    private val personaCase: PersonaCase,
) : PermissionDeniedMessageResolver {
    override fun resolve(context: PermissionMessageContext): String {
        if (context.workspaceId.isBlank()) return PermissionDeniedMessageResolver.DEFAULT_MESSAGE
        return personaCase.resolve(context.workspaceId, context.agentName)
            ?.errorMessages
            ?.permissionDenied
            ?.trim()
            ?.takeIf(String::isNotBlank)
            ?: PermissionDeniedMessageResolver.DEFAULT_MESSAGE
    }
}
