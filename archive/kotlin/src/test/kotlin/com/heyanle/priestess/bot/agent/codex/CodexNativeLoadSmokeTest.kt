package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.ExternalAgentTurn
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.WireProtocol
import com.heyanle.priestess.bot.config.model.ToolInjectionMode
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.testkit.FakeTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolSchema
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.observability.trace.ExecutionStatus
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceController
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceInput
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.FileVisitResult
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Run with PRIESTESS_CODEX_JNI_LIB set after building the native library. */
class CodexNativeLoadSmokeTest {
    @Test
    fun `native library creates and closes an isolated engine`() {
        val library = System.getenv("PRIESTESS_CODEX_JNI_LIB")?.takeIf(String::isNotBlank) ?: return
        val home = Files.createTempDirectory("priestess-codex-jni-smoke-")
        val options = buildJsonObject { put("codex_home", home.toString()) }.toString()
        CodexNativeSession.open(Path.of(library), options).use { }
    }

    @Test
    fun `invalid JSON and stale native handles fail without reaching Codex`() {
        val library = System.getenv("PRIESTESS_CODEX_JNI_LIB")?.takeIf(String::isNotBlank) ?: return
        CodexNativeBridge.load(Path.of(library))
        assertFailsWith<IllegalStateException> { CodexNativeBridge.create("{") }
        val home = Files.createTempDirectory("priestess-codex-jni-handle-")
        val handle = CodexNativeBridge.create(buildJsonObject { put("codex_home", home.toString()) }.toString())
        CodexNativeBridge.close(handle)
        assertFailsWith<IllegalStateException> { CodexNativeBridge.close(handle) }
    }

    @Test
    fun `closing a native engine while an event poll is pending does not crash the JVM`() = runBlocking {
        val library = System.getenv("PRIESTESS_CODEX_JNI_LIB")?.takeIf(String::isNotBlank) ?: return@runBlocking
        CodexNativeBridge.load(Path.of(library))
        val home = Files.createTempDirectory("priestess-codex-jni-close-")
        val workspace = Files.createDirectories(home.resolve("workspace"))
        val provider = EffectiveProviderConnection("mock", "openai", true, "http://127.0.0.1:9/v1",
            GuardedSecret.of("fake-token"), null, emptyMap(), WireProtocol.OPENAI_RESPONSES)
        val handle = CodexNativeBridge.create(CodexProviderBootstrap.engineOptions(home.resolve("codex"), provider))
        var closed = false
        try {
            val threadId = Json.parseToJsonElement(CodexNativeBridge.startThread(handle,
                CodexProviderBootstrap.threadParams(workspace, "gpt-5.1", "Test shutdown."))).jsonObject["thread_id"]!!.jsonPrimitive.content
            for (index in 0 until 100) {
                val event = Json.parseToJsonElement(CodexNativeBridge.pollEvent(handle, threadId, 20)).jsonObject
                if (event["status"]!!.jsonPrimitive.content == "timeout") break
                event["sequence"]?.jsonPrimitive?.content?.toLongOrNull()?.let { CodexNativeBridge.ackEvent(handle, threadId, it) }
            }
            val polling = async(Dispatchers.IO) { CodexNativeBridge.pollEvent(handle, threadId, 5_000) }
            delay(25)
            CodexNativeBridge.close(handle)
            closed = true
            val result = withTimeout(10_000) { polling.await() }
            assertTrue(Json.parseToJsonElement(result).jsonObject["status"]?.jsonPrimitive?.content in setOf("event", "closed", "timeout"))
        } finally {
            if (!closed) runCatching { CodexNativeBridge.close(handle) }
        }
    }

    @Test
    fun `native turn completes through injected Responses endpoint without login`() = runBlocking {
        val library = System.getenv("PRIESTESS_CODEX_JNI_LIB")?.takeIf(String::isNotBlank) ?: return@runBlocking
        val authorization = AtomicReference<String>()
        val requestBody = AtomicReference<String>()
        val requestCount = AtomicInteger()
        val database = DatabaseController("file:${UUID.randomUUID()}?mode=memory&cache=shared")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/responses") { exchange ->
            authorization.set(exchange.requestHeaders.getFirst("Authorization"))
            requestBody.set(exchange.requestBody.bufferedReader().use { it.readText() })
            val number = requestCount.incrementAndGet()
            val events = listOf(
                """{"type":"response.created","response":{"id":"resp-${number}"}}""",
                """{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg-${number}","content":[{"type":"output_text","text":"Hello from JNI"}]}}""",
                """{"type":"response.completed","response":{"id":"resp-${number}","usage":{"input_tokens":2,"input_tokens_details":null,"output_tokens":3,"output_tokens_details":null,"total_tokens":5}}}""",
            )
            val body = events.joinToString("") { event ->
                val type = Json.parseToJsonElement(event).jsonObject["type"]!!.jsonPrimitive.content
                "event: $type\ndata: $event\n\n"
            }.toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/v1/models") { exchange ->
            val body = """{"data":[{"id":"gpt-5.1"}]}""".toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val home = Files.createTempDirectory("priestess-codex-jni-turn-")
            val workspace = Files.createDirectories(home.resolve("workspace"))
            val provider = EffectiveProviderConnection(
                id = "mock", type = "openai", enabled = true,
                endpoint = "http://127.0.0.1:${server.address.port}/v1",
                credential = GuardedSecret.of("mock-only-token"), credentialReference = null,
                settings = emptyMap(), protocol = WireProtocol.OPENAI_RESPONSES,
            )
            val platform = FakePlatform()
            val traces = ExecutionTraceController(DatabaseCase(database))
            val trace = traces.start(ExecutionTraceInput(platform.metadata.name, "session", input = "Say hello"))
            val context = AgentContext(
                agent = Agent("agent", "Reply briefly.", "gpt-5.1", type = AgentType.CODEX),
                conversationId = "mock-conversation", platform = platform,
                session = MessageSession("session", SessionType.PRIVATE, platform.metadata.name),
                messages = mutableListOf(),
                metadata = mapOf(
                    "workspaceId" to "workspace",
                    "agentConfigDirectory" to home.resolve("config").toString(),
                    "agentTempDirectory" to workspace.toString(),
                ),
                executionTrace = trace,
            )
            val runner = CodexExternalAgentRunner(Path.of(library))
            try {
                val response = runner.run(ExternalAgentTurn(context, provider, "Say hello", ToolInjectionMode.NONE))
                assertEquals("Hello from JNI", assertIs<AgentResponse.Final>(response).content)
                assertNoCredentialOnDisk(home.resolve("config/codex-home"), "mock-only-token")
            } finally {
                runner.stop()
            }
            val resumed = CodexExternalAgentRunner(Path.of(library))
            try {
                val response = resumed.run(ExternalAgentTurn(context, provider, "Say hello again", ToolInjectionMode.NONE))
                assertEquals("Hello from JNI", assertIs<AgentResponse.Final>(response).content)
            } finally {
                resumed.stop()
            }
            assertEquals(2, requestCount.get())
            assertEquals("Bearer mock-only-token", authorization.get())
            assertTrue(requestBody.get().contains("Say hello again"))
            assertNoCredentialOnDisk(home.resolve("config/codex-home"), "mock-only-token")
            trace.complete(ExecutionStatus.SUCCEEDED, "Hello from JNI")
            val detail = traces.detail(trace.id)!!
            assertEquals(10L, detail.execution.totalTokens, detail.events.joinToString { "${it.type}:${it.data}" })
            assertEquals(2, detail.events.count { it.type == "codex.usage" })
            assertTrue(detail.events.none { it.type == "llm.request" || it.type == "llm.response" })
        } finally {
            server.stop(0)
            database.stop()
        }
    }

    @Test
    fun `native dynamic tool call returns to the model through JNI`() = runBlocking {
        val library = System.getenv("PRIESTESS_CODEX_JNI_LIB")?.takeIf(String::isNotBlank) ?: return@runBlocking
        val requestCount = AtomicInteger()
        val continuation = AtomicReference<String>()
        val narrowedRequest = AtomicReference<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/v1/responses") { exchange ->
            val request = exchange.requestBody.bufferedReader().use { it.readText() }
            val requestNumber = requestCount.incrementAndGet()
            val first = requestNumber == 1
            if (requestNumber == 2) continuation.set(request)
            if (requestNumber == 3) narrowedRequest.set(request)
            val events = if (first) listOf(
                """{"type":"response.created","response":{"id":"resp-tool-1"}}""",
                """{"type":"response.output_item.done","item":{"type":"function_call","call_id":"native-call-1","name":"lookup","arguments":"{\"city\":\"Paris\"}"}}""",
                """{"type":"response.completed","response":{"id":"resp-tool-1","usage":{"input_tokens":1,"input_tokens_details":null,"output_tokens":1,"output_tokens_details":null,"total_tokens":2}}}""",
            ) else listOf(
                """{"type":"response.created","response":{"id":"resp-tool-${requestNumber}"}}""",
                """{"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg-tool-${requestNumber}","content":[{"type":"output_text","text":"Tool result received"}]}}""",
                """{"type":"response.completed","response":{"id":"resp-tool-${requestNumber}","usage":{"input_tokens":2,"input_tokens_details":null,"output_tokens":2,"output_tokens_details":null,"total_tokens":4}}}""",
            )
            val body = events.joinToString("") { event ->
                val type = Json.parseToJsonElement(event).jsonObject["type"]!!.jsonPrimitive.content
                "event: $type\ndata: $event\n\n"
            }.toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val home = Files.createTempDirectory("priestess-codex-jni-tool-")
            val provider = EffectiveProviderConnection(
                id = "mock", type = "openai", enabled = true,
                endpoint = "http://127.0.0.1:${server.address.port}/v1",
                credential = GuardedSecret.of("mock-only-token"), credentialReference = null,
                settings = emptyMap(), protocol = WireProtocol.OPENAI_RESPONSES,
            )
            val workspace = Files.createDirectories(home.resolve("workspace"))
            val tool = FakeTool(
                schema = ToolSchema("lookup", "Look up a city", ToolParameters(
                    properties = listOf(ParameterDef("city", description = "City name")), required = listOf("city"),
                )),
                result = ToolResult.success("dynamic-ok"),
            )
            val platform = FakePlatform()
            val context = AgentContext(
                agent = Agent("agent", "Use lookup when requested.", "gpt-5.1", type = AgentType.CODEX, effectiveToolIds = setOf("lookup")),
                conversationId = "conversation", platform = platform,
                session = MessageSession("session", SessionType.PRIVATE, platform.metadata.name),
                messages = mutableListOf(), metadata = mapOf(
                    "workspaceId" to "workspace",
                    "agentConfigDirectory" to home.resolve("config").toString(),
                    "agentTempDirectory" to workspace.toString(),
                ),
            )
            val runner = CodexExternalAgentRunner(Path.of(library), ToolCase(ToolController().apply { register(tool) }))
            try {
                val first = runner.run(ExternalAgentTurn(context, provider, "Look up Paris", ToolInjectionMode.MULTI))
                assertEquals("Tool result received", assertIs<AgentResponse.Final>(first).content)
                assertEquals("Paris", tool.calls.single()["city"])

                val second = runner.run(ExternalAgentTurn(context, provider, "Answer without tools", ToolInjectionMode.NONE))
                assertEquals("Tool result received", assertIs<AgentResponse.Final>(second).content)
                assertNoCredentialOnDisk(home.resolve("config/codex-home"), "mock-only-token")
            } finally {
                runner.stop()
            }
            assertEquals(3, requestCount.get())
            assertTrue(continuation.get().contains("dynamic-ok"))
            val advertised = Json.parseToJsonElement(narrowedRequest.get()).jsonObject["tools"]?.jsonArray.orEmpty()
            assertTrue(advertised.none { it.jsonObject["name"]?.jsonPrimitive?.content == "lookup" })
            assertNoCredentialOnDisk(home.resolve("config/codex-home"), "mock-only-token")
        } finally {
            server.stop(0)
        }
    }

    private fun assertNoCredentialOnDisk(home: Path, credential: String) {
        val leaked = mutableListOf<Path>()
        Files.walkFileTree(home, object : SimpleFileVisitor<Path>() {
            override fun visitFile(path: Path, attrs: BasicFileAttributes): FileVisitResult {
                try {
                    if (Files.readAllBytes(path).toString(Charsets.ISO_8859_1).contains(credential)) leaked.add(path)
                } catch (_: NoSuchFileException) {
                    // Codex may remove transient files during shutdown.
                }
                return FileVisitResult.CONTINUE
            }

            override fun visitFileFailed(path: Path, error: java.io.IOException): FileVisitResult {
                if (error is NoSuchFileException) return FileVisitResult.CONTINUE
                throw error
            }
        })
        assertTrue(leaked.isEmpty(), "Codex persisted the provider credential in: $leaked")
    }
}
