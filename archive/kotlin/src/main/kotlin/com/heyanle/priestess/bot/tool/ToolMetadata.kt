package com.heyanle.priestess.bot.tool

enum class ToolSource {
    BUILTIN,
    PLUGIN,
    MCP,
}

data class ToolMetadata(
    val source: ToolSource = ToolSource.BUILTIN,
    val owner: String? = null,
    val statusReason: String? = null,
)

data class RegisteredTool(
    val tool: FunctionTool,
    val metadata: ToolMetadata = ToolMetadata(),
) {
    val schema: ToolSchema
        get() = tool.schema
}
