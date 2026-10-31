package com.heyanle.priestess.bot.tool

import kotlinx.serialization.json.JsonObject

/**
 * A collection of [FunctionTool]s with format conversion support.
 *
 * ToolSet manages a mutable set of tools and can convert them
 * to various LLM tool-calling formats (OpenAI, Anthropic, Gemini).
 */
class ToolSet {
    private val tools = mutableListOf<FunctionTool>()

    /**
     * Add a tool to this set.
     */
    fun add(tool: FunctionTool) {
        tools.add(tool)
    }

    /**
     * Add multiple tools to this set.
     */
    fun addAll(tools: Collection<FunctionTool>) {
        this.tools.addAll(tools)
    }

    /**
     * Remove a tool from this set.
     */
    fun remove(tool: FunctionTool) {
        tools.remove(tool)
    }

    /**
     * Remove a tool by name.
     */
    fun removeByName(name: String) {
        tools.removeAll { it.schema.name == name }
    }

    /**
     * Clear all tools from this set.
     */
    fun clear() {
        tools.clear()
    }

    /**
     * Get the number of tools in this set.
     */
    fun size(): Int = tools.size

    /**
     * Check if the set is empty.
     */
    fun isEmpty(): Boolean = tools.isEmpty()

    /**
     * Check if the set is not empty.
     */
    fun isNotEmpty(): Boolean = tools.isNotEmpty()

    /**
     * Get a tool by name.
     */
    fun get(name: String): FunctionTool? {
        return tools.find { it.schema.name == name }
    }

    /**
     * Get all tools in this set.
     */
    fun getAll(): List<FunctionTool> = tools.toList()

    /**
     * Convert all tools to OpenAI function-calling format.
     * Each tool is represented as:
     * { "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} } }
     *
     * @return List of JsonObject suitable for the LLMRequest.tools field.
     */
    fun toOpenAIFormat(): List<JsonObject> {
        return tools.map { it.schema.toOpenAIFormat() }
    }

    /**
     * Convert all tools to Anthropic tool format.
     */
    fun toAnthropicFormat(): List<JsonObject> {
        return tools.map { it.schema.toAnthropicFormat() }
    }
}
