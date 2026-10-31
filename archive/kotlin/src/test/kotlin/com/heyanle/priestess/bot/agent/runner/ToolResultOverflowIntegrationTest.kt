package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.testkit.FakeProvider
import com.heyanle.priestess.bot.testkit.testAgent
import com.heyanle.priestess.bot.testkit.testAgentContext
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.tool.builtin.FetchUrlTool
import com.heyanle.priestess.bot.tool.builtin.HostResolver
import com.heyanle.priestess.bot.tool.builtin.ReadToolResultTool
import com.heyanle.priestess.bot.tool.builtin.SafeUrlFetcher
import com.heyanle.priestess.bot.tool.builtin.UrlTransport
import com.heyanle.priestess.bot.tool.builtin.UrlTransportResult
import java.net.InetAddress
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ToolResultOverflowIntegrationTest {
    @Test
    fun `fetch overflow can be paged through the shared reader in one Agent loop`() = runBlocking {
        val root = Files.createTempDirectory("tool-result-agent-integration-")
        val store = ToolResultOverflowStore(root)
        try {
            val fetch = FetchUrlTool(
                SafeUrlFetcher(
                    resolver = HostResolver { listOf(InetAddress.getByName("93.184.216.34")) },
                    transport = UrlTransport { _, _ ->
                        UrlTransportResult.Response(
                            statusCode = 200,
                            contentType = "text/plain",
                            bytes = "large-page-content-".repeat(300).toByteArray(),
                        )
                    },
                ),
            )
            val reader = ReadToolResultTool(store)
            val controller = ToolController().apply {
                register(fetch)
                register(reader)
            }
            val toolCase = ToolCase(controller)
            val requests = mutableListOf<LLMRequest>()
            val fallback = FakeProvider()
            val provider = object : ChatProvider by fallback {
                override suspend fun textChat(request: LLMRequest): LLMResponse {
                    requests += request
                    return when (requests.size) {
                        1 -> LLMResponse(
                            toolCalls = listOf(
                                ToolCall("fetch-call", "fetch_url", """{"url":"https://example.com/large"}"""),
                            ),
                        )
                        2 -> {
                            val overflow = request.messages.last { it.role == "tool" }.content.orEmpty()
                            val resultId = requireNotNull(
                                Regex("result_id=([A-Za-z0-9-]+)").find(overflow)?.groupValues?.get(1),
                            )
                            LLMResponse(
                                toolCalls = listOf(
                                    ToolCall(
                                        "read-call",
                                        "read_tool_result",
                                        """{"result_id":"$resultId","offset":100,"limit":50}""",
                                    ),
                                ),
                            )
                        }
                        else -> {
                            val page = request.messages.last { it.role == "tool" }.content.orEmpty()
                            assertTrue(page.contains("\"offset\":100"))
                            assertTrue(page.contains("\"nextOffset\":150"))
                            assertTrue(page.contains("\"truncated\":true"))
                            LLMResponse(content = "retrieval complete", finishReason = "stop")
                        }
                    }
                }
            }
            val context = testAgentContext(
                agent = testAgent().copy(
                    toolResultInlineTokens = 20,
                    toolResultPreviewTokens = 5,
                    toolResultMaxBytes = 32_000,
                    toolResultStoreMaxBytes = 64_000,
                ),
            )

            val response = ReActRunner(
                context = context,
                provider = provider,
                toolCase = toolCase,
                contextManager = ContextManager(TokenCounter()),
                overflowStore = store,
            ).stepUntilDone()

            assertEquals(AgentResponse.Final("retrieval complete"), response)
            assertEquals(3, requests.size)
            assertTrue(requests[1].messages.last { it.role == "tool" }.content.orEmpty().contains("TOOL_RESULT_OVERFLOW"))
        } finally {
            store.close()
        }
    }
}
