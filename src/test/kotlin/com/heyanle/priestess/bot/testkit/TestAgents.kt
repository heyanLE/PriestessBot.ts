package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.platform.MessageSession
import com.heyanle.priestess.bot.platform.Platform
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.tool.FunctionTool

fun testAgent(
    maxSteps: Int = 5,
    toolTimeoutMs: Long = 30_000L,
): Agent = Agent(
    name = "test-agent",
    instructions = "You are a test agent.",
    model = "fake-model",
    providerName = "fake-provider",
    maxSteps = maxSteps,
    toolTimeoutMs = toolTimeoutMs,
)

fun testAgentContext(
    agent: Agent = testAgent(),
    platform: Platform? = null,
    session: MessageSession? = null,
    messages: MutableList<ConversationMessage> = mutableListOf(ConversationMessage.user("hello")),
    metadata: Map<String, String> = emptyMap(),
    scopedTools: List<FunctionTool> = emptyList(),
    skillState: PipelineSkillState = PipelineSkillState(),
): AgentContext = AgentContext(
    agent = agent,
    conversationId = "conversation-1",
    platform = platform,
    session = session,
    messages = messages,
    metadata = metadata,
    scopedTools = scopedTools,
    skillState = skillState,
)
