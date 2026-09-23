package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkspaceSkillToolsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `skills list view and manage work against workspace skill directory`() = runBlocking {
        val root = Files.createTempDirectory("skill-tools")
        Files.createDirectories(root.resolve("skills"))
        val context = AgentToolContext(
            metadata = mapOf(
                "workspaceRootDir" to root.toString(),
                "workspaceId" to "default",
            ),
        )
        val manage = SkillManageTool()

        val created = manage.execute(
            context,
            mapOf(
                "action" to "create",
                "name" to "research",
                "content" to "---\nname: research\ndescription: Research helper\n---\n# Research\n",
            ),
        )
        assertTrue(created.success)

        val listed = SkillsListTool().execute(context, emptyMap())
        val listResponse = json.decodeFromString<SkillsListResponse>(listed.output)
        assertEquals(1, listResponse.count)
        assertEquals("research", listResponse.skills.single().name)

        val viewed = SkillViewTool().execute(context, mapOf("name" to "research"))
        val viewResponse = json.decodeFromString<SkillViewResponse>(viewed.output)
        assertTrue(viewResponse.content.contains("# Research"))

        val patched = manage.execute(
            context,
            mapOf(
                "action" to "patch",
                "name" to "research",
                "old_string" to "# Research",
                "new_string" to "# Deep Research",
            ),
        )
        assertTrue(patched.success)

        val deleted = manage.execute(context, mapOf("action" to "delete", "name" to "research"))
        assertTrue(deleted.success)

        val listedAfterDelete = SkillsListTool().execute(context, emptyMap())
        val afterDeleteResponse = json.decodeFromString<SkillsListResponse>(listedAfterDelete.output)
        assertEquals(0, afterDeleteResponse.count)
    }

    @Test
    fun `skill view rejects unknown skill`() = runBlocking {
        val root = Files.createTempDirectory("skill-view-missing")
        val context = AgentToolContext(metadata = mapOf("workspaceRootDir" to root.toString()))

        val result = SkillViewTool().execute(context, mapOf("name" to "missing"))

        assertFalse(result.success)
        assertEquals("SKILL_NOT_FOUND", result.errorCode)
    }
}
