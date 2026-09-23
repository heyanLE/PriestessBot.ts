package com.heyanle.priestess.bot.server

import com.heyanle.priestess.bot.PriestessRuntime
import com.heyanle.priestess.bot.config.ProviderConfig
import com.heyanle.priestess.bot.config.model.*
import com.heyanle.priestess.bot.config.runtime.ConfigurationOperationResult
import com.heyanle.priestess.bot.config.source.ProcessConfigurationPath
import com.heyanle.priestess.bot.core.di.coreModule
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.im.ImRouter
import com.heyanle.priestess.bot.observability.trace.ExecutionStatus
import com.heyanle.priestess.bot.observability.trace.ExecutionTracePage
import com.heyanle.priestess.bot.observability.trace.ExecutionTraceDetail
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.persona.Persona
import com.heyanle.priestess.bot.persona.PersonaExampleDialog
import com.heyanle.priestess.bot.platform.*
import com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatConfig
import com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatPlatform
import com.heyanle.priestess.bot.provider.*
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.provider.model.TokenUsage
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.http.content.TextContent
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.koin.core.KoinApplication
import org.koin.dsl.koinApplication

class DashboardRoutesTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun `persona API round trips ordered example dialogs`() = testApplication {
        val fixture = fixture()
        try {
            application { configureDashboardApplication(fixture.service, corsEnabled = false) }
            val client = createClient { install(ContentNegotiation) { json() } }
            val examples = listOf(
                PersonaExampleDialog("First user", "First assistant"),
                PersonaExampleDialog("Second user", "Second assistant"),
            )

            val saved = client.post("/api/personas") {
                contentType(ContentType.Application.Json)
                setBody(
                    PersonaUpsertDto(
                        workspaceId = "platform",
                        name = "Few-shot persona",
                        exampleDialogs = examples,
                    ),
                )
            }.body<Persona>()
            val listed = client.get("/api/personas?workspaceId=platform").body<PersonaListResponse>()

            assertEquals(examples, saved.exampleDialogs)
            assertEquals(examples, listed.personas.single { it.id == saved.id }.exampleDialogs)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun `v3 API is strict revisioned and returns only credential references`() = testApplication {
        val fixture = fixture()
        try {
            application { configureDashboardApplication(fixture.service, corsEnabled = false) }
            val client = createClient { install(ContentNegotiation) { json() } }

            assertEquals(HttpStatusCode.NotFound, client.get("/api/config").status)
            val rawResponse = client.get("/api/config/v3")
            val raw = rawResponse.body<ApplicationConfigurationView>()
            val changed = assertNotNull(raw.document).copy(
                runtime = raw.document.runtime.copy(server = raw.document.runtime.server.copy(port = 18_999)),
            )
            val preview = client.post("/api/config/v3/preview") {
                contentType(ContentType.Application.Json)
                setBody(ConfigurationContentRequest(json.encodeToString(changed)))
            }.body<ConfigurationOperationResult>()
            val unknown = client.post("/api/config/v3/preview") {
                contentType(ContentType.Application.Json)
                setBody(ConfigurationContentRequest(json.encodeToString(changed).dropLast(1) + ",\"unknown\":true}"))
            }.body<ConfigurationOperationResult>()
            val conflict = client.put("/api/config/v3") {
                contentType(ContentType.Application.Json)
                setBody(ConfigurationApplyRequest(json.encodeToString(changed), "stale"))
            }

            assertNotNull(raw.revision)
            assertTrue(preview.success)
            assertFalse(unknown.success)
            assertTrue(unknown.diagnostics.any { it.code == "APPLICATION_CONFIG_INVALID" })
            assertEquals(HttpStatusCode.Conflict, conflict.status)
            val encoded = json.encodeToString(raw)
            assertFalse(encoded.contains("GuardedSecret"))
            assertFalse(encoded.contains("\"apiKey\""))
            assertEquals(3, raw.document.schemaVersion)
            val applied = client.put("/api/config/v3") {
                contentType(ContentType.Application.Json)
                setBody(ConfigurationApplyRequest(json.encodeToString(changed), raw.revision))
            }.body<ConfigurationOperationResult>()
            assertTrue(applied.success, applied.diagnostics.joinToString())
            val current = client.get("/api/config/v3").body<ApplicationConfigurationView>()
            assertNotEquals(raw.revision, current.revision)
            assertEquals(18_999, current.document!!.runtime.server.port)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun `explicit Dashboard Agent and ordered IM route use the same compiled Agent`() = testApplication {
        val fixture = fixture()
        try {
            application { configureDashboardApplication(fixture.service, corsEnabled = false) }
            val client = createClient { install(ContentNegotiation) { json() } }
            val chat = client.post("/api/agent/chat") {
                contentType(ContentType.Application.Json)
                setBody(AgentChatRequest("hello expert", userId = "operator", agentId = "expert"))
            }.body<AgentChatResponse>()
            val platform = CapturingPlatform()
            val platformRun = fixture.pipeline.processAndAwait(
                MessageEvent(
                    platform,
                    MessageSession("platform-session", SessionType.PRIVATE, platform.metadata.name, mapOf("senderId" to "operator")),
                    MessageChain.text("hello expert"),
                ),
            )

            assertEquals("expert", chat.selectedAgentName)
            assertEquals("FINAL", chat.status)
            assertEquals("provider", chat.providerName)
            assertEquals("expert-model", chat.model)
            assertEquals(chat.content, platformRun.content)
            assertEquals(chat.selectedAgentName, platformRun.selectedAgentId)
            assertEquals(chat.runtimeVersion, platformRun.trace?.effectiveVersion)
            val executions = client.get("/api/executions?platform=napcat-test&agent=expert&provider=provider").body<ExecutionTracePage>()
            val execution = executions.items.single { it.sessionId == "platform-session" }
            assertEquals(ExecutionStatus.SUCCEEDED, execution.status)
            assertEquals(16L, execution.totalTokens)
            val detail = client.get("/api/executions/${execution.id}").body<ExecutionTraceDetail>()
            assertTrue(detail.events.any { it.type == "llm.request" })
            assertTrue(detail.events.any { it.type == "llm.response" })
            assertEquals(detail.events.map { it.seq }.sorted(), detail.events.map { it.seq })
        } finally {
            fixture.close()
        }
    }

    @Test
    fun `NapCat tools are injected only for NapCat message runs`() = runBlocking {
        val fixture = fixture()
        try {
            capturedToolSets.clear()
            capturedToolResults.clear()
            capturedRequests.clear()
            scriptedToolCalls = listOf(
                ToolCall("mention-call", "napcat_mention_user", """{"user_id":"123456"}"""),
                ToolCall("files-call", "napcat_received_files", "{}"),
            )
            val actionBodies = mutableListOf<String>()
            val napCatClient = HttpClient(MockEngine { request ->
                actionBodies += (request.body as TextContent).text
                respond(
                    """{"status":"ok","retcode":0,"data":{"message_id":123}}""",
                    HttpStatusCode.OK,
                    headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }
            fixture.pipeline.processAndAwait(
                MessageEvent(
                    NapCatPlatform(NapCatConfig(name = "napcat-test"), napCatClient),
                    MessageSession("654321", SessionType.GROUP, "napcat-test", mapOf("workspaceId" to "default", "senderId" to "123456", "senderName" to "群友", "selfId" to "999")),
                    MessageChain(
                        listOf(
                            MessageComponent.Reply("8877"),
                            MessageComponent.At("999"),
                            MessageComponent.Text("hello"),
                            MessageComponent.File("https://files.example/report.pdf", "report.pdf"),
                        ),
                    ),
                    messageId = "9988",
                ),
            )
            scriptedToolCalls = emptyList()
            fixture.pipeline.processAndAwait(
                MessageEvent(
                    CapturingPlatform("telegram"),
                    MessageSession("other", SessionType.PRIVATE, "telegram", mapOf("workspaceId" to "default", "senderId" to "operator")),
                    MessageChain.text("hello"),
                ),
            )

            assertEquals(setOf("napcat_mention_user", "napcat_received_files"), capturedToolSets.first())
            assertTrue(actionBodies.first().contains("\"type\":\"reply\""))
            assertTrue(actionBodies.first().contains("\"id\":\"8877\""))
            assertEquals(1, actionBodies.size, "Tools must not send intermediate responses")
            assertTrue(actionBodies.single().contains("\"qq\":\"123456\""))
            assertTrue(capturedToolResults.any { it.contains("report.pdf") })
            assertTrue(capturedToolResults.any { it.contains("https://files.example/report.pdf") })
            assertTrue(capturedToolSets.last().isEmpty())
            val firstRequest = capturedRequests.first()
            val userInput = firstRequest.messages.last { it.role == "user" }.content.orEmpty()
            val messageContext = Json.parseToJsonElement(userInput.lineSequence().drop(1).first()).jsonObject
            assertEquals("123456", messageContext.getValue("sender_user_id").jsonPrimitive.content)
            assertEquals("654321", messageContext.getValue("group_id").jsonPrimitive.content)
            assertEquals("999", messageContext.getValue("bot_user_id").jsonPrimitive.content)
            assertEquals("群友", messageContext.getValue("sender_name").jsonPrimitive.content)
            assertEquals("ADMIN", messageContext.getValue("permission_group").jsonPrimitive.content)
            assertEquals("primary", messageContext.getValue("agent_id").jsonPrimitive.content)
            assertContains(userInput, "[mention user_id=\"999\"]")
            assertContains(firstRequest.messages.first().content.orEmpty(), "Use sender_user_id when asked to mention the requester")
        } finally {
            scriptedToolCalls = emptyList()
            fixture.close()
        }
    }

    @Test
    fun `route preview reflects order attention and each IMs own permission lists`() = testApplication {
        val fixture = fixture()
        try {
            application { configureDashboardApplication(fixture.service, corsEnabled = false) }
            val client = createClient { install(ContentNegotiation) { json() } }
            suspend fun preview(im: String, request: ImRouteTestRequest) = client.post("/api/ims/$im/route-test") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }.body<ImRouteTestResponse>()

            val command = preview("napcat-test", ImRouteTestRequest(SessionType.GROUP, "#help", mentionsBot = true, senderId = "123456"))
            assertEquals("group-command", command.routeId)
            assertEquals("COMMAND", command.action)
            assertEquals("ADMIN", command.permissionGroup)
            val expert = preview("napcat-test", ImRouteTestRequest(SessionType.GROUP, "ask expert", replyToBot = true, senderId = "super"))
            assertEquals("expert-group", expert.routeId)
            assertEquals("expert", expert.agentId)
            assertEquals("SUPER_ADMIN", expert.permissionGroup)
            assertFalse(preview("napcat-test", ImRouteTestRequest(SessionType.GROUP, "ask expert", hasReply = true)).matched)
            assertFalse(preview("napcat-test", ImRouteTestRequest(SessionType.GROUP, "[CQ:at,qq=999] ask expert")).matched)
            assertEquals("OPERATOR", preview("telegram", ImRouteTestRequest(SessionType.PRIVATE, "hello", senderId = "123456")).permissionGroup)

            val raw = client.get("/api/config/v3").body<ApplicationConfigurationView>()
            val document = assertNotNull(raw.document)
            val reordered = document.copy(ims = document.ims.map { im ->
                if (im.id != "napcat-test") im else im.copy(enabled = false, routes = im.routes.sortedBy { if (it.id == "private-agent") 0 else 1 })
            })
            val applied = client.put("/api/config/v3") {
                contentType(ContentType.Application.Json)
                setBody(ConfigurationApplyRequest(json.encodeToString(reordered), raw.revision))
            }.body<ConfigurationOperationResult>()
            assertTrue(applied.success)
            assertEquals("primary", preview("napcat-test", ImRouteTestRequest(SessionType.PRIVATE, "ask expert")).agentId)
            assertFalse(fixture.service.applicationManagement!!.raw().document!!.ims.first { it.id == "napcat-test" }.enabled,
                "Preview must work without enabling the IM transport")
            assertTrue(capturedRequests.isEmpty(), "Route previews must never invoke a model")
        } finally { fixture.close() }
    }

    @Test
    fun `matched help command bypasses LLM and unmatched group never wakes`() = runBlocking {
        val fixture = fixture()
        try {
            val platform = CapturingPlatform()
            val session = MessageSession("group", SessionType.GROUP, platform.metadata.name, mapOf("senderId" to "operator", "selfId" to "999"))
            val command = fixture.pipeline.processAndAwait(MessageEvent(platform, session,
                MessageChain(listOf(MessageComponent.At("999"), MessageComponent.Text("#help")))))
            assertTrue(command.content.isNotBlank())
            assertTrue(platform.sent.isNotEmpty())
            assertTrue(capturedRequests.isEmpty())
            val sentBefore = platform.sent.size
            fixture.pipeline.processAndAwait(MessageEvent(platform, session, MessageChain.text("hello expert without mentioning bot")))
            assertEquals(sentBefore, platform.sent.size)
            assertTrue(capturedRequests.isEmpty())
        } finally { fixture.close() }
    }

    @Test
    fun `same IM session keeps different Agents histories separate`() = testApplication {
        val fixture = fixture()
        try {
            application { configureDashboardApplication(fixture.service, corsEnabled = false) }
            val client = createClient { install(ContentNegotiation) { json() } }
            suspend fun chat(agentId: String, message: String) = client.post("/api/agent/chat") {
                contentType(ContentType.Application.Json)
                setBody(AgentChatRequest(message, sessionId = "shared-session", userId = "same-user", agentId = agentId))
            }.body<AgentChatResponse>()
            assertEquals("FINAL", chat("primary", "PRIMARY_ONLY_RECORD").status)
            assertEquals("FINAL", chat("expert", "EXPERT_ONLY_RECORD").status)
            assertEquals("FINAL", chat("primary", "PRIMARY_SECOND_RECORD").status)
            assertEquals(3, capturedRequests.size)
            val expertInput = capturedRequests[1].messages.joinToString { it.content.orEmpty() }
            val primaryInput = capturedRequests[2].messages.joinToString { it.content.orEmpty() }
            assertFalse(expertInput.contains("PRIMARY_ONLY_RECORD"))
            assertContains(primaryInput, "PRIMARY_ONLY_RECORD")
            assertFalse(primaryInput.contains("EXPERT_ONLY_RECORD"))
            val conversations = fixture.app.koin.get<ConversationCase>().getAll().filter { it.platform == "dashboard" && it.sessionId == "shared-session" }
            assertEquals(setOf("primary", "expert"), conversations.map { it.agentId }.toSet())
            assertEquals(2, conversations.map { it.id }.distinct().size)
        } finally { fixture.close() }
    }

    private fun fixture(): Fixture {
        capturedRequests.clear()
        capturedToolSets.clear()
        capturedToolResults.clear()
        scriptedToolCalls = emptyList()
        ProviderRegistry.register(providerMetadata) { config -> StaticProvider(config) }
        val root = Files.createTempDirectory("dashboard-v3-runtime")
        val configPath = root.resolve("config.json")
        val defaults = ImRouter.defaultRoutes("primary")
        val orderedRoutes = listOf(
            defaults[0],
            ImRouteDocument("expert-group", match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.GROUP), attention = ImAttention.MENTION_OR_REPLY, textPattern = "*expert*"), action = ImRouteActionDocument(agentId = "expert")),
            defaults[1], defaults[2],
            ImRouteDocument("expert-private", match = ImRouteMatchDocument(sessionTypes = listOf(SessionType.PRIVATE), textPattern = "*expert*"), action = ImRouteActionDocument(agentId = "expert")),
            defaults[3],
        )
        val policy = ToolPolicyDocument(allow = listOf("napcat_mention_user", "napcat_received_files"))
        val document = ApplicationConfigurationDocument(
            runtime = RuntimeConfigDocument(
                server = ServerRuntimeDocument(enabled = false),
                database = DatabaseRuntimeDocument(root.resolve("test.db").toString()),
                plugins = PluginRuntimeDocument(enabled = false, directory = root.resolve("plugins").toString()),
                pipeline = PipelineRuntimeDocument(rateLimitEnabled = false),
            ),
            platformDirectory = root.resolve("platform").toString(),
            llms = listOf(ProviderConnectionDocument("provider", PROVIDER_TYPE)),
            ims = listOf(
                ImConnectionDocument("napcat-test", type = "napcat4_18_6", permission = PermissionRuntimeDocument(superAdminIds = listOf("super"), adminIds = listOf("123456")), routes = orderedRoutes),
                ImConnectionDocument("telegram", type = "telegram", routes = orderedRoutes),
            ),
            agents = listOf(
                AgentProfileDocument("primary", llm = AgentLlmDocument("provider", "primary-model"), toolPolicy = policy),
                AgentProfileDocument("expert", llm = AgentLlmDocument("provider", "expert-model"), toolPolicy = policy),
            ),
            toolPolicy = policy,
        )
        Files.writeString(configPath, json.encodeToString(document))
        ProcessConfigurationPath.configure(listOf("--config", configPath.toString()))
        val app = koinApplication { modules(coreModule) }
        val service = app.koin.get<DashboardService>()
        return Fixture(app, service, app.koin.get(), app.koin.get(), root)
    }

    private data class Fixture(
        val app: KoinApplication,
        val service: DashboardService,
        val pipeline: PipelineCase,
        val runtime: PriestessRuntime,
        val root: Path,
    ) {
        suspend fun close() {
            runtime.stop()
            app.close()
            ProviderRegistry.unregister(PROVIDER_TYPE)
            root.toFile().deleteRecursively()
        }
    }

    private class StaticProvider(override val config: ProviderConfig) : ChatProvider {
        override val metadata = providerMetadata.copy(name = config.name)
        override suspend fun textChat(request: LLMRequest): LLMResponse {
            capturedRequests += request
            capturedToolSets += request.tools.mapNotNull { tool ->
                tool["function"]?.jsonObject?.get("name")?.jsonPrimitive?.content
            }.toSet()
            capturedToolResults.addAll(
                request.messages.filter { it.role == "tool" }.mapNotNull { it.content },
            )
            if (scriptedToolCalls.isNotEmpty() && request.messages.none { it.role == "tool" }) {
                return LLMResponse(toolCalls = scriptedToolCalls)
            }
            return LLMResponse(content = "reply:${request.model}", tokenUsage = TokenUsage(11, 5, 16))
        }
        override suspend fun getModels() = listOf("primary-model", "expert-model")
        override suspend fun test() = true
    }

    private class CapturingPlatform(name: String = "napcat-test") : Platform() {
        override val metadata = PlatformMetadata(name, "Platform", false, false)
        val sent = mutableListOf<MessageChain>()
        override suspend fun run() = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? {
            sent += chain
            return "captured"
        }
    }

    companion object {
        private const val PROVIDER_TYPE = "dashboard-test-provider"
        private val providerMetadata = ProviderMetadata(PROVIDER_TYPE, "Dashboard Test", LLMKind.OPENAI, true, false, false)
        private val capturedToolSets = mutableListOf<Set<String>>()
        private val capturedToolResults = mutableListOf<String>()
        private val capturedRequests = mutableListOf<LLMRequest>()
        private var scriptedToolCalls: List<ToolCall> = emptyList()
    }
}
