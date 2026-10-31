package com.heyanle.priestess.bot.im

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.SessionType

/** A decision from one connection's ordered route table; a missing decision means no processing. */
data class ImRouteMatch(
    val route: ImRouteDocument,
    val text: String,
    val permissionGroup: PermissionGroup,
)

/** Pure matching: only structured protocol components and adapter metadata establish identity. */
class ImRouter {
    fun match(im: ImConnectionDocument, event: MessageEvent): ImRouteMatch? {
        if (!im.enabled) return null
        for (route in im.routes) {
            if (!route.enabled || event.session.type !in route.match.sessionTypes) continue
            if (!matchesAttention(route.match, event)) continue
            val text = event.chain.components.joinToString("") { component ->
                when (component) {
                    is MessageComponent.Text -> component.text
                    is MessageComponent.At -> if (route.match.stripMentions) "" else "@${component.userId}"
                    else -> ""
                }
            }.trimStart()
            val matches = when (route.match.textMode) {
                ImTextMatchMode.PREFIX -> text.startsWith(route.match.textPattern)
                ImTextMatchMode.EXACT -> text == route.match.textPattern
                ImTextMatchMode.GLOB -> globMatches(route.match.textPattern, text)
            }
            if (matches) return ImRouteMatch(route, text, permission(im, event))
        }
        return null
    }

    private fun matchesAttention(match: ImRouteMatchDocument, event: MessageEvent): Boolean {
        if (match.attention == ImAttention.ANY) return true
        val selfId = event.session.metadata["selfId"]?.takeIf(String::isNotBlank)
        val mentions = event.chain.components.filterIsInstance<MessageComponent.At>()
        val hasReply = event.chain.components.any { it is MessageComponent.Reply && it.messageId.isNotBlank() } ||
            !event.session.metadata["replyMessageId"].isNullOrBlank() || event.session.metadata["hasReply"] == "true"
        val mentioned = mentions.any {
            it.userId.isNotBlank() && (match.attentionTarget == ImAttentionTarget.ANY || (selfId != null && it.userId == selfId))
        }
        val replied = hasReply && (match.attentionTarget == ImAttentionTarget.ANY ||
            (selfId != null && event.session.metadata["replySenderId"] == selfId))
        return when (match.attention) {
            ImAttention.ANY -> true
            ImAttention.MENTION -> mentioned
            ImAttention.REPLY -> replied
            ImAttention.MENTION_OR_REPLY -> mentioned || replied
            ImAttention.NONE -> !mentioned && !replied
        }
    }

    private fun permission(im: ImConnectionDocument, event: MessageEvent): PermissionGroup {
        val sender = (event.session.metadata["senderId"] ?: event.session.metadata["userId"]).orEmpty().trim()
        if (sender.isEmpty()) return PermissionGroup.OPERATOR
        if (im.permission.superAdminIds.any { it.trim() == sender }) return PermissionGroup.SUPER_ADMIN
        if (im.permission.adminIds.any { it.trim() == sender }) return PermissionGroup.ADMIN
        return PermissionGroup.OPERATOR
    }

    companion object {
        fun defaultRoutes(agentId: String): List<ImRouteDocument> = listOf(
            ImRouteDocument(
                id = "group-command", name = "群聊提及或回复机器人后执行命令",
                match = ImRouteMatchDocument(
                    sessionTypes = listOf(SessionType.GROUP), attention = ImAttention.MENTION_OR_REPLY,
                    textMode = ImTextMatchMode.PREFIX, textPattern = "#",
                ),
                action = ImRouteActionDocument(type = ImRouteActionType.COMMAND, commandPrefix = "#"),
            ),
            ImRouteDocument(
                id = "group-agent", name = "群聊提及或回复机器人后交给 Agent",
                match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.GROUP), attention = ImAttention.MENTION_OR_REPLY),
                action = ImRouteActionDocument(agentId = agentId),
            ),
            ImRouteDocument(
                id = "private-command", name = "私聊命令",
                match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.PRIVATE), textMode = ImTextMatchMode.PREFIX, textPattern = "#"),
                action = ImRouteActionDocument(type = ImRouteActionType.COMMAND, commandPrefix = "#"),
            ),
            ImRouteDocument(
                id = "private-agent", name = "私聊默认 Agent",
                match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.PRIVATE)),
                action = ImRouteActionDocument(agentId = agentId),
            ),
        )

        // Glob syntax is limited to '*' and '?'; every other character is literal, including
        // regex metacharacters. Code points make '?' match one emoji as well as one BMP character.
        internal fun globMatches(pattern: String, text: String): Boolean {
            val glob = pattern.codePoints().toArray()
            val input = text.codePoints().toArray()
            var p = 0
            var t = 0
            var star = -1
            var retry = 0
            while (t < input.size) {
                when {
                    p < glob.size && glob[p] == '*'.code -> { star = p++; retry = t }
                    p < glob.size && (glob[p] == '?'.code || glob[p] == input[t]) -> { p++; t++ }
                    star >= 0 -> { p = star + 1; t = ++retry }
                    else -> return false
                }
            }
            while (p < glob.size && glob[p] == '*'.code) p++
            return p == glob.size
        }
    }
}
