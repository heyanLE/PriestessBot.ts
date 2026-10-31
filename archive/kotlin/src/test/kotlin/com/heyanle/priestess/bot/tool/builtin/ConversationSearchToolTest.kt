package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.conversation.MessageRole
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.testConversationCase
import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConversationSearchToolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `searches current session by default and does not cross sessions`() = runBlocking {
        val conversationCase = testConversationCase("conversation-search-current")
        val current = conversationCase.getOrCreate("fake-platform", "session-1")
        val other = conversationCase.getOrCreate("fake-platform", "session-2")
        conversationCase.storeMessage(current.id, MessageRole.USER, "alpha current session")
        conversationCase.storeMessage(other.id, MessageRole.USER, "alpha other session")
        val tool = ConversationSearchTool { conversationCase }

        val result = tool.execute(
            AgentToolContext(platform = FakePlatform(), session = FakePlatform.fakeSession(id = "session-1")),
            mapOf("query" to "alpha"),
        )

        assertTrue(result.success)
        val response = json.decodeFromString<ConversationSearchResponse>(result.output)
        assertEquals(1, response.results.size)
        assertEquals(current.id, response.results.single().conversationId)
        assertEquals("alpha current session", response.results.single().content)
    }

    @Test
    fun `supports explicit conversation role time and limit filters`() = runBlocking {
        val conversationCase = testConversationCase("conversation-search-filters")
        val conversation = conversationCase.getOrCreate("telegram", "room-1")
        conversationCase.storeMessage(conversation.id, MessageRole.USER, "first alpha")
        Thread.sleep(2)
        val cutoff = System.currentTimeMillis()
        Thread.sleep(2)
        conversationCase.storeMessage(conversation.id, MessageRole.ASSISTANT, "second alpha")
        conversationCase.storeMessage(conversation.id, MessageRole.ASSISTANT, "third alpha")
        val tool = ConversationSearchTool { conversationCase }

        val result = tool.execute(
            AgentToolContext(),
            mapOf(
                "conversation_id" to conversation.id,
                "query" to "alpha",
                "role" to "assistant",
                "since_ms" to cutoff.toString(),
                "limit" to "1",
            ),
        )

        val response = json.decodeFromString<ConversationSearchResponse>(result.output)
        assertEquals(1, response.results.size)
        assertEquals("assistant", response.results.single().role)
        assertTrue(response.results.single().createdAt >= cutoff)
        assertTrue(response.results.single().snippet.contains("alpha"))
    }

    @Test
    fun `requires current session or explicit conversation id`() = runBlocking {
        val tool = ConversationSearchTool { testConversationCase("conversation-search-missing-scope") }

        val result = tool.execute(AgentToolContext(), mapOf("query" to "anything"))

        assertEquals("MISSING_SCOPE", result.errorCode)
    }
}
