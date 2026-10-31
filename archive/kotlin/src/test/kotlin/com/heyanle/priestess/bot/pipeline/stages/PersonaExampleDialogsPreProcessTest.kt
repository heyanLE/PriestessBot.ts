package com.heyanle.priestess.bot.pipeline.stages

import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.agent.AgentResponse
import com.heyanle.priestess.bot.config.PipelineConfig
import com.heyanle.priestess.bot.config.model.AgentDefinitionDocument
import com.heyanle.priestess.bot.config.model.AppConfigDocument
import com.heyanle.priestess.bot.config.model.EffectiveAgent
import com.heyanle.priestess.bot.config.model.EffectiveConfigVersion
import com.heyanle.priestess.bot.config.model.EffectiveProviderConnection
import com.heyanle.priestess.bot.config.model.EffectiveWorkspaceSnapshot
import com.heyanle.priestess.bot.config.model.PersonaDefinitionDocument
import com.heyanle.priestess.bot.config.model.SourceFingerprint
import com.heyanle.priestess.bot.config.model.WorkspaceConfigDocument
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.conversation.ConversationController
import com.heyanle.priestess.bot.conversation.MessageHistory
import com.heyanle.priestess.bot.conversation.MessageRole
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryController
import com.heyanle.priestess.bot.persona.PersonaCase
import com.heyanle.priestess.bot.persona.PersonaController
import com.heyanle.priestess.bot.persona.PersonaExampleDialog
import com.heyanle.priestess.bot.persona.PersonaMemoryInjector
import com.heyanle.priestess.bot.persona.PersonaUpsertRequest
import com.heyanle.priestess.bot.pipeline.PipelineContext
import com.heyanle.priestess.bot.platform.MessageComponent
import com.heyanle.priestess.bot.platform.MessageEvent
import com.heyanle.priestess.bot.platform.SessionType
import com.heyanle.priestess.bot.provider.model.ToolCall
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.testkit.testPipelineContext
import com.heyanle.priestess.bot.testkit.testRuntimeConfiguration
import java.nio.file.Files
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertContains
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class PersonaExampleDialogsPreProcessTest {
    @Test
    fun `example dialogs are labeled style instructions outside actual conversation history`() = runBlocking {
        val fixture = Fixture()
        try {
            val ctx = fixture.context()
            val conversation = fixture.conversations.getOrCreate(ctx.event.platform.metadata.name, ctx.event.session.id)
            fixture.conversations.storeMessage(conversation.id, MessageRole.USER, "Earlier question")
            fixture.conversations.storeMessage(conversation.id, MessageRole.ASSISTANT, "Earlier answer")
            val postProcess = fixture.stage.process(ctx)

            assertEquals(
                listOf(
                    ConversationMessage.user("Earlier question"),
                    ConversationMessage.assistant("Earlier answer"),
                ),
                ctx.agentContext!!.messages.toList(),
            )
            val instructions = ctx.agentContext!!.agent.instructions
            assertContains(instructions, "Fictional style examples")
            assertContains(instructions, "not conversation history")
            assertContains(instructions, "The task failed.")
            assertContains(instructions, "Keep the logs; I will inspect the failed step.")
            assertFalse(ctx.agentContext!!.messages.any { it.content.orEmpty().contains("The task failed.") })
            ctx.agentContext!!.messages.add(ConversationMessage.user(ctx.modelUserContent))
            ctx.agentResponse = AgentResponse.Final("Final answer")
            postProcess.toList()

            assertEquals(
                listOf("Earlier question", "Earlier answer", ctx.modelUserContent, "Final answer"),
                fixture.conversations.getMessages(conversation.id).map { it.content },
            )
            assertEquals("sender-1", identity(ctx.modelUserContent)["sender_user_id"]?.jsonPrimitive?.content)
            assertEquals("What should I do now?", ctx.modelUserContent.substringAfter("</platform_message_context>\n\n"))
        } finally {
            fixture.close()
        }
    }

    @Test
    fun `group history retains each sender identity without relabeling legacy messages or duplicating tools`() = runBlocking {
        val fixture = Fixture()
        try {
            val first = fixture.context("101", "群友甲", "message-a", SessionType.GROUP)
            val conversation = fixture.conversations.getOrCreate(first.event.platform.metadata.name, first.event.session.id)
            val oldCall = ToolCall("legacy-tool", "lookup", "{}")
            fixture.conversations.storeMessage(conversation.id, MessageRole.USER, "Legacy question without identity")
            fixture.conversations.storeMessage(conversation.id, MessageRole.ASSISTANT, "", Json.encodeToString(listOf(oldCall)))
            fixture.conversations.storeMessage(conversation.id, MessageRole.TOOL, "legacy result", toolCallId = oldCall.id)
            fixture.conversations.storeMessage(conversation.id, MessageRole.ASSISTANT, "Legacy answer")

            val firstPost = fixture.stage.process(first)
            val firstMessages = first.agentContext!!.messages
            assertEquals("Legacy question without identity", firstMessages.last { it.role == "user" }.content)
            firstMessages.add(ConversationMessage.user(first.modelUserContent))
            firstMessages.add(ConversationMessage.assistant("", listOf(ToolCall("tool-a", "lookup", "{}"))))
            firstMessages.add(ConversationMessage.tool("tool-a", "lookup", "result a"))
            first.agentResponse = AgentResponse.Final("Answer to A")
            firstPost.toList()

            val second = fixture.context("202", "群友乙", "message-b", SessionType.GROUP)
            val secondPost = fixture.stage.process(second)
            val replayedFirst = second.agentContext!!.messages.last { it.role == "user" }.content!!
            assertEquals(first.modelUserContent, replayedFirst)
            assertEquals("101", identity(replayedFirst)["sender_user_id"]?.jsonPrimitive?.content)
            assertEquals("群友甲", identity(replayedFirst)["sender_name"]?.jsonPrimitive?.content)
            second.agentContext!!.messages.add(ConversationMessage.user(second.modelUserContent))
            second.agentContext!!.messages.add(ConversationMessage.assistant("", listOf(ToolCall("tool-b", "lookup", "{}"))))
            second.agentContext!!.messages.add(ConversationMessage.tool("tool-b", "lookup", "result b"))
            second.agentResponse = AgentResponse.Final("Answer to B")
            secondPost.toList()

            val stored = fixture.conversations.getMessages(conversation.id)
            val users = stored.filter { it.role == MessageRole.USER }.map { it.content!! }
            assertEquals(listOf("Legacy question without identity", first.modelUserContent, second.modelUserContent), users)
            assertFalse(users.first().contains("platform_message_context"))
            assertEquals("202", identity(users.last())["sender_user_id"]?.jsonPrimitive?.content)
            assertEquals("群友乙", identity(users.last())["sender_name"]?.jsonPrimitive?.content)
            assertEquals("message-a", identity(users[1])["message_id"]?.jsonPrimitive?.content)
            assertEquals("message-b", identity(users[2])["message_id"]?.jsonPrimitive?.content)
            assertEquals(12, stored.size)
            assertEquals(listOf("legacy-tool", "tool-a", "tool-b"), stored.filter { it.role == MessageRole.TOOL }.map { it.toolCallId })
            assertEquals(listOf("legacy-tool", "tool-a", "tool-b"), stored.mapNotNull { it.toolCalls }
                .flatMap { Json.decodeFromString<List<ToolCall>>(it) }.map { it.id })

            // Loading a third turn must replay the saved per-message facts verbatim.
            val next = fixture.context("303", "群友丙", "message-c", SessionType.GROUP)
            fixture.stage.process(next)
            assertEquals(users, next.agentContext!!.messages.filter { it.role == "user" }.map { it.content })
            assertContains(next.agentContext!!.agent.instructions, "Fictional style examples")
            assertFalse(stored.any { it.content.orEmpty().contains("The task failed.") })
            assertEquals(12, fixture.conversations.getMessages(conversation.id).size)
        } finally {
            fixture.close()
        }
    }

    private fun identity(content: String): JsonObject = Json.parseToJsonElement(
        content.substringAfter("<platform_message_context>\n").substringBefore("\n</platform_message_context>"),
    ).jsonObject

    private class Fixture {
        private val databasePath = Files.createTempFile("persona-example-pipeline", ".sqlite")
        private val database = DatabaseController(databasePath.toString())
        private val databaseCase = DatabaseCase(database)
        val conversations = ConversationCase(ConversationController(databaseCase), MessageHistory(databaseCase))
        private val personaController = PersonaController(databaseCase)
        private val memoryController = MemoryController(databaseCase)
        private val persona = personaController.upsert(PersonaUpsertRequest(
            id = "persona-a",
            workspaceId = "workspace-a",
            name = "Operations helper",
            exampleDialogs = listOf(PersonaExampleDialog("The task failed.", "Keep the logs; I will inspect the failed step.")),
        ))
        private val definition = AgentDefinitionDocument(
            id = "assistant", instructions = "Base instructions", providerRef = "provider-a", model = "model-a",
        )
        private val provider = EffectiveProviderConnection(
            id = "provider-a", type = "openai", enabled = true, endpoint = "https://example.invalid",
            credential = null, credentialReference = null, settings = emptyMap(),
        )
        private val workspace = EffectiveWorkspaceSnapshot(
            version = EffectiveConfigVersion(0), fingerprint = SourceFingerprint("workspace-a"),
            sourcePath = "/tmp/workspace-a/workspace.yaml",
            config = WorkspaceConfigDocument(
                id = "workspace-a", name = "Workspace A", primaryAgentId = definition.id,
                agents = listOf(definition), personas = listOf(PersonaDefinitionDocument(id = persona.id)),
            ),
            agents = mapOf(definition.id to EffectiveAgent(definition, provider, emptySet())),
            availableToolIds = emptySet(),
        )
        private val runtime = testRuntimeConfiguration().apply {
            publish(AppConfigDocument(), mapOf(workspace.config.id to workspace), mapOf(provider.id to provider))
        }
        private val contexts = mutableListOf<PipelineContext>()
        val stage = PreProcessStage(
            pipelineConfig = PipelineConfig(), conversationCase = conversations, agentCase = AgentCase(),
            personaMemoryInjector = PersonaMemoryInjector(PersonaCase(personaController), MemoryCase(memoryController)),
        )

        fun context(
            senderId: String = "sender-1",
            senderName: String = "Test sender",
            messageId: String = "message-1",
            sessionType: SessionType = SessionType.PRIVATE,
        ): PipelineContext {
            val base = testPipelineContext(
                text = "What should I do now?", sessionId = "session-a", senderId = senderId, sessionType = sessionType,
            ).event
            val ctx = PipelineContext(MessageEvent(
                platform = base.platform,
                session = base.session.copy(metadata = base.session.metadata + ("senderName" to senderName)),
                chain = base.chain,
                messageId = messageId,
            ))
            val lease = runtime.store.acquire()
            ctx.pinConfiguration(lease)
            ctx.pinEffectiveWorkspace(lease.snapshot.workspaces.getValue(workspace.config.id), "test")
            contexts.add(ctx)
            return ctx
        }

        suspend fun close() {
            contexts.forEach { it.releaseConfiguration() }
            database.stop()
            Files.deleteIfExists(databasePath)
        }
    }
}
