package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.testkit.testConversationCase
import com.heyanle.priestess.bot.testkit.testKnowledgeCase
import com.heyanle.priestess.bot.testkit.testMemoryCase
import com.heyanle.priestess.bot.testkit.testReminderCase
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BuiltinToolsRegistrationTest {
    @Test
    fun `registers all v3 core tools when dependencies are available`() {
        val controller = ToolController()
        val registry = ToolCase(controller)
        registerBuiltinTools(
            registry = registry,
            knowledgeCaseProvider = { testKnowledgeCase("builtin-registration-knowledge") },
            serverCaseProvider = { error("not used") },
            conversationCaseProvider = { testConversationCase("builtin-registration-conversation") },
            memoryCaseProvider = { testMemoryCase("builtin-registration-memory") },
            reminderCaseProvider = { testReminderCase("builtin-registration-reminder") },
        )

        val tools = controller.getRegisteredTools().associateBy { it.schema.name }
        val expected = setOf(
            "list_tools",
            "use_skill",
            "unload_skill",
            "skills_list",
            "skill_view",
            "skill_manage",
            "health_check",
            "fetch_url",
            "conversation_search",
            "memory_save",
            "memory_recall",
            "memory_delete",
            "create_reminder",
            "list_reminders",
            "delete_reminder",
            "web_search",
            "web_extract",
            "terminal",
            "process",
            "read_terminal",
            "read_file",
            "write_file",
            "patch",
            "search_files",
        )

        assertTrue(tools.keys.containsAll(expected))
        assertNull(tools["early_reply"])
        assertNull(tools["send_message"])
        expected.forEach { toolName ->
            assertNull(tools.getValue(toolName).metadata.statusReason, "$toolName should be available")
        }
        assertEquals(true, tools.getValue("memory_recall").schema.defaultEnabled)
        assertEquals(true, tools.getValue("list_reminders").schema.defaultEnabled)
    }
}
