package com.heyanle.priestess.bot.testkit

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.delay

class FakeTool(
    name: String = "fake_tool",
    schema: ToolSchema? = null,
    private val result: ToolResult = ToolResult.success("fake output"),
    private val failure: Throwable? = null,
    private val delayMs: Long = 0L,
) : FunctionTool() {
    val calls = mutableListOf<Map<String, String>>()

    override val schema = schema ?: ToolSchema(
        name = name,
        description = "Fake tool for tests",
        parameters = ToolParameters(
            properties = listOf(ParameterDef("value", description = "Test value")),
            required = listOf("value"),
        ),
    )

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        calls += args
        if (delayMs > 0) delay(delayMs)
        failure?.let { throw it }
        return result
    }
}
