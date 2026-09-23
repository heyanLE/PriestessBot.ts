package com.heyanle.priestess.bot.tool

/**
 * Abstract base class for all tools.
 *
 * Each tool has a [schema] describing its name, description, and parameters,
 * and an [execute] method that performs the actual tool logic.
 *
 * This follows the same pattern as [Platform] in the platform layer:
 * metadata + execute.
 */
abstract class FunctionTool {
    /**
     * Metadata and JSON Schema describing this tool.
     */
    abstract val schema: ToolSchema

    /** Controls whether the Agent runner may replace a large result with a reference. */
    open val resultMaterialization: ToolResultMaterialization = ToolResultMaterialization.AUTO

    /**
     * Execute this tool with the given arguments.
     *
     * @param context The agent context providing access to platform, session, etc.
     * @param args Named arguments from the LLM tool call, parsed from JSON.
     * @return ToolResult indicating success or failure.
     */
    abstract suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult
}

enum class ToolResultMaterialization {
    AUTO,
    INLINE,
}
