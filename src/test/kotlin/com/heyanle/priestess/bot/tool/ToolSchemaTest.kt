package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.tool.builtin.FetchUrlTool
import com.heyanle.priestess.bot.tool.builtin.HealthCheckTool
import com.heyanle.priestess.bot.tool.builtin.KnowledgeSearchTool
import com.heyanle.priestess.bot.tool.builtin.CreateReminderTool
import com.heyanle.priestess.bot.tool.builtin.DeleteReminderTool
import com.heyanle.priestess.bot.tool.builtin.ListRemindersTool
import com.heyanle.priestess.bot.tool.builtin.ListToolsTool
import com.heyanle.priestess.bot.tool.builtin.MemoryDeleteTool
import com.heyanle.priestess.bot.tool.builtin.MemoryRecallTool
import com.heyanle.priestess.bot.tool.builtin.MemorySaveTool
import com.heyanle.priestess.bot.tool.builtin.ConversationSearchTool
import com.heyanle.priestess.bot.tool.builtin.SystemInfoTool
import com.heyanle.priestess.bot.tool.builtin.UnloadSkillTool
import com.heyanle.priestess.bot.tool.builtin.UseSkillTool
import com.heyanle.priestess.bot.tool.builtin.WebSearchTool
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ToolSchemaTest {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    @Test
    fun `schema permission metadata has backward compatible defaults`() {
        val schema = json.decodeFromString<ToolSchema>(
            """{"name":"legacy_tool","description":"legacy","parameters":{"properties":[],"required":[]}}""",
        )

        assertEquals("legacy_tool", schema.name)
        assertEquals(ToolRiskLevel.SAFE_READ, schema.riskLevel)
        assertEquals(emptyList(), schema.requiredCapabilities)
        assertTrue(schema.defaultEnabled)
        assertFalse(schema.auditLog)

        val encoded = json.encodeToString(ToolSchema.serializer(), schema)
        assertTrue(encoded.contains("riskLevel"))
        assertTrue(encoded.contains("defaultEnabled"))
        assertTrue(encoded.contains("auditLog"))
    }

    @Test
    fun `existing built in tools declare explicit permission metadata`() {
        val schemas = listOf(
            ListToolsTool { emptyList() }.schema,
            HealthCheckTool { error("not used") }.schema,
            FetchUrlTool().schema,
            ConversationSearchTool { error("not used") }.schema,
            MemorySaveTool { error("not used") }.schema,
            MemoryRecallTool { error("not used") }.schema,
            MemoryDeleteTool { error("not used") }.schema,
            CreateReminderTool { error("not used") }.schema,
            ListRemindersTool { error("not used") }.schema,
            DeleteReminderTool { error("not used") }.schema,
            UseSkillTool().schema,
            UnloadSkillTool().schema,
            SystemInfoTool().schema,
            WebSearchTool().schema,
            KnowledgeSearchTool().schema,
        ).associateBy { it.name }

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("list_tools").riskLevel)
        assertTrue(schemas.getValue("list_tools").defaultEnabled)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("health_check").riskLevel)
        assertTrue(schemas.getValue("health_check").defaultEnabled)

        assertEquals(ToolRiskLevel.EXTERNAL_READ, schemas.getValue("fetch_url").riskLevel)
        assertEquals(listOf(ToolCapabilities.NETWORK), schemas.getValue("fetch_url").requiredCapabilities)
        assertFalse(schemas.getValue("fetch_url").defaultEnabled)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("conversation_search").riskLevel)
        assertEquals(listOf(ToolCapabilities.CONVERSATION_HISTORY), schemas.getValue("conversation_search").requiredCapabilities)
        assertTrue(schemas.getValue("conversation_search").defaultEnabled)

        assertEquals(ToolRiskLevel.STATE_WRITE, schemas.getValue("memory_save").riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), schemas.getValue("memory_save").requiredCapabilities)
        assertFalse(schemas.getValue("memory_save").defaultEnabled)
        assertTrue(schemas.getValue("memory_save").auditLog)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("memory_recall").riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), schemas.getValue("memory_recall").requiredCapabilities)
        assertTrue(schemas.getValue("memory_recall").defaultEnabled)

        assertEquals(ToolRiskLevel.STATE_WRITE, schemas.getValue("memory_delete").riskLevel)
        assertEquals(listOf(ToolCapabilities.MEMORY), schemas.getValue("memory_delete").requiredCapabilities)
        assertFalse(schemas.getValue("memory_delete").defaultEnabled)
        assertTrue(schemas.getValue("memory_delete").auditLog)

        assertEquals(ToolRiskLevel.STATE_WRITE, schemas.getValue("create_reminder").riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), schemas.getValue("create_reminder").requiredCapabilities)
        assertFalse(schemas.getValue("create_reminder").defaultEnabled)
        assertTrue(schemas.getValue("create_reminder").auditLog)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("list_reminders").riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), schemas.getValue("list_reminders").requiredCapabilities)
        assertTrue(schemas.getValue("list_reminders").defaultEnabled)

        assertEquals(ToolRiskLevel.STATE_WRITE, schemas.getValue("delete_reminder").riskLevel)
        assertEquals(listOf(ToolCapabilities.REMINDER), schemas.getValue("delete_reminder").requiredCapabilities)
        assertFalse(schemas.getValue("delete_reminder").defaultEnabled)
        assertTrue(schemas.getValue("delete_reminder").auditLog)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("use_skill").riskLevel)
        assertTrue(schemas.getValue("use_skill").defaultEnabled)
        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("unload_skill").riskLevel)
        assertTrue(schemas.getValue("unload_skill").defaultEnabled)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("system_info").riskLevel)
        assertTrue(schemas.getValue("system_info").defaultEnabled)



        assertEquals(ToolRiskLevel.EXTERNAL_READ, schemas.getValue("web_search").riskLevel)
        assertEquals(listOf(ToolCapabilities.NETWORK, ToolCapabilities.PROVIDER_SEARCH), schemas.getValue("web_search").requiredCapabilities)
        assertFalse(schemas.getValue("web_search").defaultEnabled)

        assertEquals(ToolRiskLevel.SAFE_READ, schemas.getValue("knowledge_search").riskLevel)
        assertEquals(listOf(ToolCapabilities.KNOWLEDGE), schemas.getValue("knowledge_search").requiredCapabilities)
        assertTrue(schemas.getValue("knowledge_search").defaultEnabled)
    }
}
