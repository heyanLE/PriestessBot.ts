package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.agent.ExternalAgentTurn
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.GuardedSecret
import com.heyanle.priestess.bot.config.model.ToolInjectionMode
import com.heyanle.priestess.bot.config.model.WireProtocol
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import com.heyanle.priestess.bot.testkit.FakePlatform
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.builtin.UseSkillTool
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CodexExternalAgentRunnerTest {
    @Test
    fun `failed turn discards its native generation and starts a clean conversation`() = runBlocking {
        val root = Files.createTempDirectory("codex-runner-recover-")
        val rollout = Files.createFile(root.resolve("rollout.jsonl"))
        val ports = mutableListOf<FakePort>()
        val runner = CodexExternalAgentRunner(Path.of("unused-native-library")) { _, _ ->
            FakePort(rollout, failTurn = ports.isEmpty()).also(ports::add)
        }
        try {
            val turn = turn(root, provider("token"))
            assertIs<AgentResponse.Error>(runner.run(turn))
            val recovered = assertIs<AgentResponse.Final>(runner.run(turn))
            assertTrue(recovered.content.contains("已开始新会话"))
            assertEquals(2, ports.size)
            assertTrue(ports.first().closed)
            assertEquals(1, ports.last().starts)
            assertEquals(0, ports.last().resumes)
        } finally { runner.stop() }
    }
    @Test
    fun `conversation resumes after restart and rotates on instruction or credential change`() = runBlocking {
        val root = Files.createTempDirectory("codex-runner-test-")
        val rollout = Files.createFile(root.resolve("rollout.jsonl"))
        val ports = mutableListOf<FakePort>()
        fun runner(failResume: Boolean = false) = CodexExternalAgentRunner(Path.of("unused-native-library")) { _, _ ->
            FakePort(rollout, failResume).also(ports::add)
        }
        val provider = provider("token-one")
        val first = runner()
        val turn = turn(root, provider)
        assertEquals("answer", assertIs<AgentResponse.Final>(first.run(turn)).content)
        assertEquals("answer", assertIs<AgentResponse.Final>(first.run(turn)).content)
        assertEquals(1, ports.single().starts)
        assertEquals(0, ports.single().resumes)
        assertEquals(2, ports.single().submissions)
        assertFalse(Files.readString(root.resolve("config/codex-home/priestess-threads.json")).contains("token-one"))
        first.stop()
        assertTrue(ports.single().closed)

        val second = runner()
        assertIs<AgentResponse.Final>(second.run(turn))
        assertEquals(1, ports.last().resumes)
        assertEquals(0, ports.last().starts)

        val changedInstructions = turn.copy(context = turn.context.copy(agent = turn.context.agent.copy(instructions = "New instructions")))
        assertTrue(assertIs<AgentResponse.Final>(second.run(changedInstructions)).content.contains("已开始新会话"))
        assertEquals(1, ports.last().starts)

        val changedModel = changedInstructions.copy(context = changedInstructions.context.copy(agent = changedInstructions.context.agent.copy(model = "gpt-5.2")))
        assertTrue(assertIs<AgentResponse.Final>(second.run(changedModel)).content.contains("已开始新会话"))
        assertEquals(2, ports.last().starts)

        assertIs<AgentResponse.Final>(second.run(turn(root, provider("token-two"))))
        assertTrue(ports[1].closed)
        assertEquals(3, ports.size)
        assertEquals(1, ports.last().starts)
        assertFalse(Files.readString(root.resolve("config/codex-home/priestess-threads.json")).contains("token-two"))
        second.stop()

        val brokenResume = runner(failResume = true)
        val recovered = brokenResume.run(turn(root, provider("token-two")))
        assertTrue(assertIs<AgentResponse.Final>(recovered).content.contains("无法恢复"))
        assertEquals(1, ports.last().resumes)
        assertEquals(1, ports.last().starts)
        brokenResume.stop()
    }

    @Test
    fun `route with injected IM tools never creates a native engine`() = runBlocking {
        val root = Files.createTempDirectory("codex-runner-denied-")
        var created = 0
        val runner = CodexExternalAgentRunner(Path.of("unused")) { _, _ -> created++; FakePort(root.resolve("rollout")) }
        val response = runner.run(turn(root, provider("token")).copy(toolInjectionMode = ToolInjectionMode.MULTI))
        assertIs<AgentResponse.Error>(response)
        assertEquals(0, created)
    }

    @Test
    fun `only caller-authorized skill names enter Codex instructions`() = runBlocking {
        val root = Files.createTempDirectory("codex-runner-skills-")
        val rollout = Files.createFile(root.resolve("rollout.jsonl"))
        lateinit var port: FakePort
        val toolCase = ToolCase(ToolController().apply { register(UseSkillTool()) })
        val runner = CodexExternalAgentRunner(Path.of("unused"), toolCase) { _, _ -> FakePort(rollout).also { port = it } }
        val skills = PipelineSkillState(listOf(
            SkillPromptReference("public-skill", "Public guidance", inlineMarkdown = "public"),
            SkillPromptReference("admin-skill", "Private guidance", inlineMarkdown = "private", requiredPermissionGroup = PermissionGroup.ADMIN),
        ), permissionGroup = PermissionGroup.OPERATOR)
        val base = turn(root, provider("token"))
        val context = base.context.copy(agent = base.context.agent.copy(effectiveToolIds = setOf("use_skill")), skillState = skills)
        try {
            assertIs<AgentResponse.Final>(runner.run(base.copy(context = context, toolInjectionMode = ToolInjectionMode.MULTI)))
            val instructions = Json.parseToJsonElement(port.lastStartParams).jsonObject["developer_instructions"]!!.jsonPrimitive.content
            assertTrue(instructions.contains("public-skill"))
            assertFalse(instructions.contains("admin-skill"))
            assertFalse(instructions.contains("private"))
        } finally { runner.stop() }
    }

    @Test
    fun `independent conversations make progress while one turn is waiting`() = runBlocking {
        val root = Files.createTempDirectory("codex-runner-parallel-")
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val port = ConcurrentPort(root, firstEntered, releaseFirst)
        val runner = CodexExternalAgentRunner(Path.of("unused")) { _, _ -> port }
        val firstTurn = turn(root, provider("token")).copy(userContent = "hold")
        val secondTurn = firstTurn.copy(
            context = firstTurn.context.copy(session = MessageSession("other", SessionType.PRIVATE, firstTurn.context.platform!!.metadata.name)),
            userContent = "fast",
        )
        try {
            val first = async { runner.run(firstTurn) }
            withTimeout(2_000) { firstEntered.await() }
            val second = async { runner.run(secondTurn) }
            assertIs<AgentResponse.Final>(withTimeout(2_000) { second.await() })
            releaseFirst.complete(Unit)
            assertIs<AgentResponse.Final>(withTimeout(2_000) { first.await() })
        } finally {
            releaseFirst.complete(Unit)
            runner.stop()
        }
    }

    private fun provider(token: String) = EffectiveProviderConnection(
        id = "responses", type = "openai", enabled = true, endpoint = "https://example.test/v1",
        credential = GuardedSecret.of(token), credentialReference = null, settings = emptyMap(),
        protocol = WireProtocol.OPENAI_RESPONSES,
    )

    private fun turn(root: Path, provider: EffectiveProviderConnection): ExternalAgentTurn {
        val platform = FakePlatform()
        val context = AgentContext(
            agent = Agent(name = "agent", instructions = "Initial instructions", model = "gpt-5.1", type = AgentType.CODEX),
            conversationId = "conversation", platform = platform,
            session = MessageSession("session", SessionType.PRIVATE, platform.metadata.name),
            messages = mutableListOf(),
            metadata = mapOf(
                "workspaceId" to "workspace",
                "agentConfigDirectory" to root.resolve("config").toString(),
                "agentTempDirectory" to root.resolve("temp").toString(),
            ),
        )
        return ExternalAgentTurn(context, provider, "hello", ToolInjectionMode.NONE)
    }

    private class FakePort(private val rollout: Path, private val failResume: Boolean = false, private val failTurn: Boolean = false) : CodexNativePort {
        var starts = 0
        var resumes = 0
        var submissions = 0
        var closed = false
        var lastStartParams = ""
        private var eventSequence = 0L

        override suspend fun startThread(paramsJson: String): String {
            starts++
            lastStartParams = paramsJson
            return """{"thread_id":"started-$starts","rollout_path":"$rollout"}"""
        }
        override suspend fun resumeThread(paramsJson: String): String {
            resumes++
            if (failResume) error("simulated unusable rollout")
            val params = Json.parseToJsonElement(paramsJson).jsonObject
            assertEquals(rollout.toString(), params["rollout_path"]!!.jsonPrimitive.content)
            return """{"thread_id":"resumed-$resumes","rollout_path":"$rollout"}"""
        }
        override suspend fun submitTurn(threadId: String, requestJson: String): String {
            submissions++
            return """{"status":"started","turn_id":"turn-$submissions"}"""
        }
        override suspend fun pollEvent(threadId: String, timeoutMillis: Int): String {
            eventSequence++
            if (failTurn) return """{"status":"event","sequence":$eventSequence,"event":{"id":"turn-$submissions","msg":{"type":"task_complete","turn_id":"turn-$submissions","error":{"message":"failed"}}}}"""
            return """{"status":"event","sequence":$eventSequence,"event":{"id":"turn-$submissions","msg":{"type":"task_complete","turn_id":"turn-$submissions","last_agent_message":"answer"}}}"""
        }
        override suspend fun ackEvent(threadId: String, sequence: Long) = Unit
        override suspend fun dynamicToolResponse(threadId: String, callId: String, responseJson: String) = Unit
        override suspend fun reviewDecision(threadId: String, requestJson: String) = Unit
        override suspend fun interrupt(threadId: String) = Unit
        override fun close() { closed = true }
    }

    private class ConcurrentPort(
        private val root: Path,
        private val firstEntered: CompletableDeferred<Unit>,
        private val releaseFirst: CompletableDeferred<Unit>,
    ) : CodexNativePort {
        private val ids = AtomicInteger()
        override suspend fun startThread(paramsJson: String): String {
            val number = ids.incrementAndGet()
            val rollout = Files.createFile(root.resolve("rollout-$number.jsonl"))
            return """{"thread_id":"thread-$number","rollout_path":"$rollout"}"""
        }
        override suspend fun resumeThread(paramsJson: String): String = error("No resume expected")
        override suspend fun submitTurn(threadId: String, requestJson: String): String {
            if (requestJson.contains("hold")) {
                firstEntered.complete(Unit)
                releaseFirst.await()
            }
            return """{"status":"started","turn_id":"$threadId-turn"}"""
        }
        override suspend fun pollEvent(threadId: String, timeoutMillis: Int): String =
            """{"status":"event","sequence":1,"event":{"id":"$threadId-turn","msg":{"type":"task_complete","turn_id":"$threadId-turn","last_agent_message":"done"}}}"""
        override suspend fun ackEvent(threadId: String, sequence: Long) = Unit
        override suspend fun dynamicToolResponse(threadId: String, callId: String, responseJson: String) = Unit
        override suspend fun reviewDecision(threadId: String, requestJson: String) = Unit
        override suspend fun interrupt(threadId: String) = Unit
        override fun close() = Unit
    }
}
