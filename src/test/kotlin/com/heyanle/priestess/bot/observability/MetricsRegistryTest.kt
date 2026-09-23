package com.heyanle.priestess.bot.observability

import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.ProviderConnectionDocument
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.pipeline.PipelineController
import com.heyanle.priestess.bot.pipeline.Stage
import com.heyanle.priestess.bot.pipeline.StageOrder
import com.heyanle.priestess.bot.pipeline.stages.ProcessStage
import com.heyanle.priestess.bot.platform.MessageChain
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.platform.PlatformMetadata
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.LLMKind
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.provider.ProviderController
import com.heyanle.priestess.bot.provider.ProviderMetadata
import com.heyanle.priestess.bot.provider.ProviderRegistry
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.provider.model.LLMResponse
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import com.heyanle.priestess.bot.tool.ToolExecutor
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

class MetricsRegistryTest {
    @Test
    fun `registry renders deterministic prometheus metrics and escapes labels`() {
        val registry = MetricsRegistry()
        registry.incrementCounter(
            "priestess_tool_calls_total",
            mapOf("tool" to "demo\"tool", "status" to "success"),
        )
        registry.recordDuration(
            "priestess_llm_request_duration_milliseconds",
            mapOf("provider" to "test-provider", "status" to "success"),
            42,
        )

        val output = registry.renderPrometheus()

        assertContains(output, "# HELP priestess_tool_calls_total Total tool calls attempted by agents.")
        assertContains(output, "# TYPE priestess_tool_calls_total counter")
        assertContains(output, "priestess_tool_calls_total{status=\"success\",tool=\"demo\\\"tool\"} 1")
        assertContains(
            output,
            "priestess_llm_request_duration_milliseconds_count{provider=\"test-provider\",status=\"success\"} 1",
        )
        assertContains(
            output,
            "priestess_llm_request_duration_milliseconds_sum{provider=\"test-provider\",status=\"success\"} 42",
        )
    }

    @Test
    fun `pipeline records message count and duration without message labels`() = runBlocking {
        val registry = MetricsRegistry()
        val controller = PipelineController(listOf(NoopStage()), Unit, ObservabilityCase.standalone(registry))

        controller.process(messageEvent("secret prompt")).join()

        val output = registry.renderPrometheus()
        assertContains(output, "priestess_pipeline_messages_total{platform=\"metrics-platform\",status=\"completed\"} 1")
        assertContains(output, "priestess_pipeline_duration_milliseconds_count{platform=\"metrics-platform\",status=\"completed\"} 1")
        assertFalse(output.contains("secret prompt"))
        controller.stop()
    }

    @Test
    fun `process stage records llm metrics`() = runBlocking {
        val registry = MetricsRegistry()
        val observabilityCase = ObservabilityCase.standalone(registry)
        ProviderRegistry.register(MetricsProvider().metadata) { MetricsProvider() }
        val runtime = testRuntimeConfiguration(AppConfigDocument(providers = listOf(ProviderConnectionDocument("metrics-provider", "metrics-provider"))))
        val providerController = ProviderController(runtime.case)
        val stage = ProcessStage(
            agentCase = AgentCase(),
            providerCase = ProviderCase(providerController),
            toolCase = ToolCase(ToolController()),
            observabilityCase = observabilityCase,
        )
        val ctx = PipelineContext(messageEvent("hello")).also {
            it.pinConfiguration(runtime.store.acquire())
            it.agentContext = AgentContext(
                agent = Agent(
                    name = "metrics-agent",
                    instructions = "reply",
                    model = "metrics-provider",
                    providerName = "metrics-provider",
                    maxSteps = 1,
                ),
                conversationId = "conversation-secret",
                platform = null,
                session = null,
                messages = mutableListOf(ConversationMessage.user("hello")),
            )
        }

        stage.process(ctx)

        val output = registry.renderPrometheus()
        assertContains(output, "priestess_llm_requests_total{provider=\"metrics-provider\",status=\"success\"} 1")
        assertContains(output, "priestess_llm_request_duration_milliseconds_count{provider=\"metrics-provider\",status=\"success\"} 1")
        assertFalse(output.contains("conversation-secret"))
        providerController.stop()
        ctx.releaseConfiguration()
        ProviderRegistry.unregister("metrics-provider")
    }

    @Test
    fun `tool executor records success and error metrics without arguments`() = runBlocking {
        val registry = MetricsRegistry()
        val toolController = ToolController()
        toolController.register(MetricsTool())
        val executor = ToolExecutor(toolController, ObservabilityCase.standalone(registry))

        executor.execute(AgentToolContext(agentName = "metrics-agent"), "metrics_tool", """{"secret":"value"}""")
        executor.execute(AgentToolContext(agentName = "metrics-agent"), "missing_tool", "{}")

        val output = registry.renderPrometheus()
        assertContains(output, "priestess_tool_calls_total{status=\"success\",tool=\"metrics_tool\"} 1")
        assertContains(output, "priestess_tool_calls_total{status=\"error\",tool=\"missing_tool\"} 1")
        assertFalse(output.contains("secret"))
        assertFalse(output.contains("value"))
        toolController.stop()
    }

    private class NoopStage : Stage {
        override val name = "Noop"
        override val order = StageOrder.PROCESS

        override suspend fun process(ctx: PipelineContext) = null
    }

    private class MetricsProvider : ChatProvider {
        override val metadata = ProviderMetadata(
            name = "metrics-provider",
            displayName = "Metrics Provider",
            kind = LLMKind.OPENAI,
            supportToolCalling = false,
            supportVision = false,
            supportStreaming = false,
        )
        override val config = com.heyanle.priestess.bot.config.ProviderConfig(
            name = "metrics-provider",
            type = "metrics-provider",
            model = "metrics-provider",
        )

        override suspend fun test(): Boolean = true
        override suspend fun textChat(request: LLMRequest): LLMResponse = LLMResponse("ok")
        override suspend fun getModels(): List<String> = listOf("metrics-provider")
    }

    private class MetricsTool : FunctionTool() {
        override val schema = ToolSchema("metrics_tool", "Metrics test tool")

        override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
            return ToolResult.success("ok")
        }
    }

    private class MetricsPlatform : Platform() {
        override val metadata = PlatformMetadata(
            name = "metrics-platform",
            displayName = "Metrics Platform",
            supportStreaming = false,
            supportProactiveMessage = false,
        )

        override suspend fun run(): Job = Job()
        override suspend fun terminate() = Unit
        override suspend fun sendMessage(session: MessageSession, chain: MessageChain): String? = null
    }

    private fun messageEvent(text: String): MessageEvent {
        return MessageEvent(
            platform = MetricsPlatform(),
            session = MessageSession(
                id = "session-secret",
                type = SessionType.PRIVATE,
                platformName = "metrics-platform",
            ),
            chain = MessageChain.text(text),
        )
    }

    private fun tempConfigPath(): String {
        return Files.createTempFile("priestess-metrics-config", ".json").toAbsolutePath().toString()
    }
}
