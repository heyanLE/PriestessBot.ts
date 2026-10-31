package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HealthCheckToolTest {
    @Test
    fun `returns health summary json from server case boundary`() = runBlocking {
        val tool = HealthCheckTool {
            """
            {
              "status": "UP",
              "components": {"server": "UP"},
              "diagnostics": {"registeredTools": "3"}
            }
            """.trimIndent()
        }

        val result = tool.execute(AgentToolContext(), emptyMap())

        assertTrue(result.success)
        assertTrue(result.output.contains(""""status": "UP""""))
        assertTrue(result.output.contains(""""registeredTools": "3""""))
        assertFalse(result.output.contains("secret-provider-key"))
    }

    @Test
    fun `throws when health dependency is unavailable`() = runBlocking {
        val tool = HealthCheckTool { error("Health dependency is unavailable") }

        val error = assertFailsWith<IllegalStateException> {
            tool.execute(AgentToolContext(), emptyMap())
        }

        assertEquals("Health dependency is unavailable", error.message)
    }
}
