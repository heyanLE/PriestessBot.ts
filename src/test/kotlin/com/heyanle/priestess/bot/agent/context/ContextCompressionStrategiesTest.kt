package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.agent.CompressStrategy
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.testkit.testAgent
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ContextCompressionStrategiesTest {
    private val tokenCounter = TokenCounter()

    @Test
    fun `token budget never keeps an answer after removing its user turn`() = runBlocking {
        val system = ConversationMessage.system("system")
        val current = ConversationMessage.user("real request")
        val result = TokenWindowStrategy(tokenCounter).compress(listOf(
            system, ConversationMessage.user("long old question ".repeat(30)),
            ConversationMessage.assistant("old answer"), current,
        ), system, maxTokens = 20, maxRounds = 10)
        assertEquals(listOf(system, current), result)
    }

    @Test
    fun `current user survives a system prompt exceeding the soft budget`() = runBlocking {
        val system = ConversationMessage.system("large system ".repeat(100))
        val current = ConversationMessage.user("do this task")
        assertEquals(listOf(system, current), TokenWindowStrategy(tokenCounter).compress(listOf(system, current), system, 10, 1))
    }

    @Test
    fun `token window honors real turn limit even when tokens are plentiful`() = runBlocking {
        val system = ConversationMessage.system("system")
        val old = ConversationMessage.user("old")
        val current = ConversationMessage.user("current")
        assertEquals(listOf(system, current), TokenWindowStrategy(tokenCounter).compress(
            listOf(system, old, ConversationMessage.assistant("old answer"), current), system, 10000, 1,
        ))
    }

    @Test
    fun `round truncation keeps system message and latest rounds`() = runBlocking {
        val system = ConversationMessage.system("system")
        val messages = mutableListOf(system)
        repeat(4) { index ->
            messages += ConversationMessage.user("user-$index")
            messages += ConversationMessage.assistant("assistant-$index")
        }

        val result = ContextManager(tokenCounter).compress(
            agent = testAgent().copy(compressStrategy = CompressStrategy.ROUND_TRUNCATION, maxContextRounds = 2),
            messages = messages,
            systemMessage = system,
        )

        assertEquals("system", result.first().role)
        assertEquals(listOf("user-2", "assistant-2", "user-3", "assistant-3"), result.drop(1).map { it.content })
    }

    @Test
    fun `token window trims older messages and preserves system message`() = runBlocking {
        val system = ConversationMessage.system("system")
        val messages = listOf(
            system,
            ConversationMessage.user("older message with many many many tokens"),
            ConversationMessage.assistant("older response with many many many tokens"),
            ConversationMessage.user("new"),
            ConversationMessage.assistant("ok"),
        )

        val result = ContextManager(tokenCounter).compress(
            agent = testAgent().copy(compressStrategy = CompressStrategy.TOKEN_WINDOW, maxContextTokens = 15),
            messages = messages,
            systemMessage = system,
        )

        assertEquals("system", result.first().role)
        assertTrue(result.any { it.content == "new" })
        assertTrue(result.any { it.content == "ok" })
        assertTrue(result.none { it.content?.startsWith("older") == true })
    }

    @Test
    fun `token window preserves recent tool observation with system message`() = runBlocking {
        val system = ConversationMessage.system("system")
        val toolCall = ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}""")
        val messages = listOf(
            system,
            ConversationMessage.user("old old old old old old"),
            ConversationMessage.assistant("old response"),
            ConversationMessage.user("new"),
            ConversationMessage.assistant(content = "", toolCalls = listOf(toolCall)),
            ConversationMessage.tool(toolCallId = "call-1", name = "fake_tool", content = "observation"),
        )

        val result = ContextManager(tokenCounter).compress(
            agent = testAgent().copy(compressStrategy = CompressStrategy.TOKEN_WINDOW, maxContextTokens = 25),
            messages = messages,
            systemMessage = system,
        )

        assertEquals("system", result.first().role)
        assertTrue(result.any { it.role == "assistant" && it.toolCalls?.firstOrNull()?.id == "call-1" })
        assertTrue(result.any { it.role == "tool" && it.toolCallId == "call-1" && it.content == "observation" })
    }

    @Test
    fun `token window keeps tool message paired with parent assistant tool call`() = runBlocking {
        val system = ConversationMessage.system("system")
        val toolCall = ToolCall(id = "call-1", name = "fake_tool", arguments = """{"value":"abc"}""")
        val messages = listOf(
            system,
            ConversationMessage.user("old old old old old old"),
            ConversationMessage.assistant("older response with many many many tokens"),
            ConversationMessage.user("latest user"),
            ConversationMessage.assistant(content = "", toolCalls = listOf(toolCall)),
            ConversationMessage.tool(toolCallId = "call-1", name = "fake_tool", content = "tool output"),
        )

        val result = ContextManager(tokenCounter).compress(
            agent = testAgent().copy(compressStrategy = CompressStrategy.TOKEN_WINDOW, maxContextTokens = 18),
            messages = messages,
            systemMessage = system,
        )

        assertEquals("system", result.first().role)
        assertTrue(result.any { it.role == "assistant" && it.toolCalls?.any { tc -> tc.id == "call-1" } == true })
        assertTrue(result.any { it.role == "tool" && it.toolCallId == "call-1" && it.content == "tool output" })
    }

    @Test
    fun `context manager removes incomplete persisted tool-call rounds without compression`() = runBlocking {
        val system = ConversationMessage.system("system")
        val first = ToolCall(id = "call-1", name = "first", arguments = "{}")
        val second = ToolCall(id = "call-2", name = "second", arguments = "{}")
        val messages = listOf(
            system,
            ConversationMessage.user("older request"),
            ConversationMessage.assistant(content = "", toolCalls = listOf(first, second)),
            ConversationMessage.tool(toolCallId = "call-1", name = "first", content = "only one result"),
            ConversationMessage.assistant("previous final"),
            ConversationMessage.user("current request"),
        )

        val result = ContextManager(tokenCounter).compress(
            agent = testAgent().copy(maxContextTokens = 10_000, maxContextRounds = 10),
            messages = messages,
            systemMessage = system,
        )

        assertEquals(
            listOf("system", "user", "assistant", "user"),
            result.map { it.role },
        )
        assertEquals(listOf("system", "older request", "previous final", "current request"), result.map { it.content })
        assertTrue(result.none { it.role == "tool" })
    }
}
