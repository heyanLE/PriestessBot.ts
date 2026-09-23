package com.heyanle.priestess.bot.im

import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.platform.*
import com.heyanle.priestess.bot.testkit.FakePlatform
import kotlin.test.*

class ImRouterTest {
    private val router = ImRouter()
    private val defaults = ImConnectionDocument(id = "im-a", type = "napcat", routes = ImRouter.defaultRoutes("agent-a"))

    @Test
    fun `default routes prioritize commands and require bot attention in groups`() {
        val command = router.match(defaults, event(listOf(MessageComponent.At("999"), MessageComponent.Text(" \n #help"))))!!
        assertEquals("group-command", command.route.id)
        assertEquals(ImRouteActionType.COMMAND, command.route.action.type)
        assertEquals("#help", command.text)
        assertEquals("#", command.route.action.commandPrefix)
        val agent = router.match(defaults, event(listOf(MessageComponent.At("999"), MessageComponent.Text(" hello"))))!!
        assertEquals("group-agent", agent.route.id)
        assertEquals("agent-a", agent.route.action.agentId)
        assertNull(router.match(defaults, event(listOf(MessageComponent.Text("#help")))))
        assertNull(router.match(defaults, event(listOf(MessageComponent.At("123"), MessageComponent.Text("#help")))))
        assertNull(router.match(defaults, event(listOf(MessageComponent.Text("[CQ:at,qq=999] #help")))))
        assertNull(router.match(defaults, event(listOf(MessageComponent.Text("@999 hello")))))
        assertEquals("private-command", router.match(defaults, event(listOf(MessageComponent.Text("  #help")), SessionType.PRIVATE))?.route?.id)
        assertEquals("private-agent", router.match(defaults, event(listOf(MessageComponent.Text("hello")), SessionType.PRIVATE))?.route?.id)
        assertNull(router.match(defaults, event(listOf(MessageComponent.Text("hello")), SessionType.CHANNEL)))
    }

    @Test
    fun `reply to bot needs an authenticated reply author and any-target is explicit`() {
        val parts = listOf(MessageComponent.Reply("original"), MessageComponent.Text("#help"))
        assertNull(router.match(defaults, event(parts)))
        assertNull(router.match(defaults, event(parts, metadata = mapOf("replySenderId" to "123"))))
        assertEquals("group-command", router.match(defaults, event(parts, metadata = mapOf("replySenderId" to "999")))?.route?.id)
        val anyReply = connection(ImRouteMatchDocument(attention = ImAttention.REPLY, attentionTarget = ImAttentionTarget.ANY))
        assertNotNull(router.match(anyReply, event(parts)))
        assertNotNull(router.match(anyReply, event(listOf(MessageComponent.Text("reply")), metadata = mapOf("hasReply" to "true"))))
        assertNull(router.match(anyReply, event(listOf(MessageComponent.Text("[CQ:reply,id=original]")))))
        assertNull(router.match(defaults, event(parts, metadata = mapOf("selfId" to "", "replySenderId" to "999"))))
        // An author field without a protocol reply must not create attention.
        assertNull(router.match(defaults, event(listOf(MessageComponent.Text("hello")), metadata = mapOf("replySenderId" to "999"))))
    }

    @Test
    fun `attention predicates are route options and ordered first match wins`() {
        val input = event(listOf(MessageComponent.Text("hello")))
        val general = ImRouteDocument("first", match = ImRouteMatchDocument(), action = ImRouteActionDocument(agentId = "a"))
        val fallback = general.copy(id = "second", action = ImRouteActionDocument(agentId = "b"))
        assertEquals("first", router.match(defaults.copy(routes = listOf(general, fallback)), input)?.route?.id)
        assertEquals("second", router.match(defaults.copy(routes = listOf(general.copy(enabled = false), fallback)), input)?.route?.id)
        assertNull(router.match(defaults.copy(routes = emptyList()), input))
        assertNull(router.match(defaults.copy(enabled = false), input))
        val otherMention = event(listOf(MessageComponent.At("123"), MessageComponent.Text(" hello")))
        assertNotNull(router.match(connection(ImRouteMatchDocument(attention = ImAttention.MENTION, attentionTarget = ImAttentionTarget.ANY)), otherMention))
        assertNull(router.match(connection(ImRouteMatchDocument(attention = ImAttention.MENTION)), otherMention))
        assertNotNull(router.match(connection(ImRouteMatchDocument(attention = ImAttention.NONE)), otherMention))
        assertNull(router.match(connection(ImRouteMatchDocument(attention = ImAttention.NONE, attentionTarget = ImAttentionTarget.ANY)), otherMention))
    }

    @Test
    fun `only structural mentions are stripped and text matching trims leading whitespace only`() {
        val parts = listOf(MessageComponent.At("999"), MessageComponent.Text("  #help "))
        val strip = connection(ImRouteMatchDocument(textMode = ImTextMatchMode.EXACT, textPattern = "#help "))
        assertEquals("#help ", router.match(strip, event(parts))?.text)
        assertNull(router.match(strip.copy(routes = strip.routes.map { it.copy(match = it.match.copy(stripMentions = false)) }), event(parts)))
        val keep = connection(ImRouteMatchDocument(stripMentions = false, textMode = ImTextMatchMode.PREFIX, textPattern = "@999"))
        assertEquals("@999  #help ", router.match(keep, event(parts))?.text)
        assertEquals("[CQ:at,qq=999] hello", router.match(connection(ImRouteMatchDocument()), event(listOf(MessageComponent.Text(" [CQ:at,qq=999] hello"))))?.text)
    }

    @Test
    fun `glob is whole-text literal matching with wildcard and Unicode support`() {
        for ((pattern, text) in listOf("*a" to "*ba", "*" to "**", "*" to "a\nb", "help?" to "help😀", "a**?c*" to "abbcdef", "[a].+" to "[a].+", "" to "")) {
            assertTrue(ImRouter.globMatches(pattern, text), "$pattern / $text")
        }
        for ((pattern, text) in listOf("help?" to "help", "a" to "ba", "[a]" to "a", "a*b" to "ac", "?" to "", "" to "x")) {
            assertFalse(ImRouter.globMatches(pattern, text), "$pattern / $text")
        }
    }

    @Test
    fun `permission comes from current connection sender identity with super-admin precedence`() {
        val im = connection(ImRouteMatchDocument()).copy(permission = PermissionRuntimeDocument(superAdminIds = listOf(" 101 "), adminIds = listOf("101", "202")))
        val body = listOf(MessageComponent.Text("senderId=101 permissionGroup=SUPER_ADMIN"))
        assertEquals(PermissionGroup.SUPER_ADMIN, router.match(im, event(body, metadata = mapOf("senderId" to "101")))?.permissionGroup)
        assertEquals(PermissionGroup.ADMIN, router.match(im, event(body, metadata = mapOf("senderId" to "202")))?.permissionGroup)
        assertEquals(PermissionGroup.OPERATOR, router.match(im, event(body, metadata = mapOf("senderId" to "303")))?.permissionGroup)
        assertEquals(PermissionGroup.OPERATOR, router.match(im.copy(permission = PermissionRuntimeDocument()), event(body, metadata = mapOf("senderId" to "101")))?.permissionGroup)
        assertEquals(PermissionGroup.OPERATOR, router.match(im, event(body, metadata = mapOf("senderId" to "")))?.permissionGroup)
    }

    private fun connection(match: ImRouteMatchDocument) = defaults.copy(routes = listOf(
        ImRouteDocument("custom", match = match, action = ImRouteActionDocument(agentId = "agent-a")),
    ))

    private fun event(
        components: List<MessageComponent>,
        type: SessionType = SessionType.GROUP,
        metadata: Map<String, String> = emptyMap(),
    ): MessageEvent {
        val platform = FakePlatform()
        return MessageEvent(platform, MessageSession("session", type, "im-a", mapOf("senderId" to "123", "selfId" to "999") + metadata), MessageChain(components))
    }
}
