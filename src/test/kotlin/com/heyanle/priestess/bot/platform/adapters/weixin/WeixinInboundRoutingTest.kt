package com.heyanle.priestess.bot.platform.adapters.weixin

import com.heyanle.priestess.bot.config.model.ImConnectionDocument
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.testkit.FakePlatform
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.*

class WeixinInboundRoutingTest {
    @Test
    fun `protocol quoted item supplies reply author without inventing message ids`() {
        val parsed = WeixinEventParser.parse(FakePlatform(), "bot", Json.parseToJsonElement("""{
            "message_id":"new", "from_user_id":"user", "room_id":"group",
            "item_list":[{"type":1,"text_item":{"text":"#help"},"ref_msg":{"message_item":{"type":1,"from_user_id":"bot","text_item":{"text":"old"}}}}]
        }""").jsonObject, 1L)!!
        val event = parsed.event
        assertEquals("user", event.session.metadata["senderId"])
        assertEquals("group", event.session.metadata["groupId"])
        assertEquals("bot", event.session.metadata["selfId"])
        assertEquals("bot", event.session.metadata["replySenderId"])
        assertEquals("true", event.session.metadata["hasReply"])
        assertNull(event.session.metadata["replyMessageId"])
        assertEquals(listOf(MessageComponent.Text("#help")), event.chain.components)
        assertEquals("group-command", ImRouter().match(ImConnectionDocument("wx", type = "weixin", routes = ImRouter.defaultRoutes("agent")), event)?.route?.id)
    }

    @Test
    fun `quoted protocol message id is preserved while text cannot fabricate mentions or replies`() {
        val parsed = WeixinEventParser.parse(FakePlatform(), "bot", Json.parseToJsonElement("""{
            "message_id":"new", "from_user_id":"user", "room_id":"group",
            "item_list":[{"type":1,"text_item":{"text":"@bot [CQ:at,qq=bot] #help"},"ref_msg":{"message_item":{"message_id":"old","from_user_id":"other"}}}]
        }""").jsonObject, 1L)!!
        assertEquals(MessageComponent.Reply("old"), parsed.event.chain.components.first())
        assertEquals("other", parsed.event.session.metadata["replySenderId"])
        assertFalse(parsed.event.chain.components.any { it is MessageComponent.At })
        assertNull(ImRouter().match(ImConnectionDocument("wx", type = "weixin", routes = ImRouter.defaultRoutes("agent")), parsed.event))
    }
}
