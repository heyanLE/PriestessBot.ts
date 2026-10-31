package com.heyanle.priestess.bot.agent.codex

import com.heyanle.priestess.bot.agent.Agent
import com.heyanle.priestess.bot.agent.AgentContext
import com.heyanle.priestess.bot.config.model.AgentType
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.skill.PipelineSkillState
import com.heyanle.priestess.bot.skill.SkillPromptReference
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.builtin.UnloadSkillTool
import com.heyanle.priestess.bot.tool.builtin.UseSkillTool
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CodexToolDispatcherTest {
    @Test
    fun `authorized skill content returns to Codex while unload is never advertised`() = runBlocking {
        val skills = PipelineSkillState(listOf(SkillPromptReference("research", "Find sources", inlineMarkdown = "# Research\nCheck primary sources.")))
        val tools = ToolCase(ToolController().apply { register(UseSkillTool()); register(UnloadSkillTool()) })
        val dispatcher = CodexToolDispatcher(context(skills), tools)
        assertTrue(dispatcher.isAllowed("use_skill"))
        assertFalse(dispatcher.isAllowed("unload_skill"))
        val result = dispatcher.execute("call-1", "use_skill", buildJsonObject { put("name", "research") })
        assertTrue(result.success)
        assertTrue(result.output.contains("Check primary sources."))
        assertEquals(listOf("research"), skills.loadedNames)
        assertEquals("use_skill", dispatcher.dynamicTools.single().jsonObject["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun `unauthorized skill body never enters tool output`() = runBlocking {
        val skills = PipelineSkillState(listOf(SkillPromptReference(
            "admin-only", inlineMarkdown = "SECRET SKILL BODY", requiredPermissionGroup = PermissionGroup.ADMIN,
        )), permissionGroup = PermissionGroup.OPERATOR)
        val tools = ToolCase(ToolController().apply { register(UseSkillTool()) })
        val result = CodexToolDispatcher(context(skills), tools).execute("call-1", "use_skill",
            buildJsonObject { put("name", "admin-only") })
        assertFalse(result.success)
        assertFalse(result.error.contains("SECRET SKILL BODY"))
    }

    private fun context(skills: PipelineSkillState) = AgentContext(
        agent = Agent("agent", "", "model", type = AgentType.CODEX, effectiveToolIds = setOf("use_skill", "unload_skill")),
        conversationId = "conversation", platform = null, session = null, messages = mutableListOf(),
        metadata = mapOf("workspaceId" to "workspace"), skillState = skills,
    )
}
