package com.heyanle.priestess.bot.tool.annotation

/**
 * Annotation to mark a class as a tool that should be auto-registered
 * by the ToolController.
 *
 * Classes annotated with @Tool must extend [com.heyanle.priestess.bot.tool.FunctionTool].
 *
 * @property name The unique name of this tool (used in LLM tool calls).
 * @property description A human-readable description of what the tool does.
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class Tool(
    val name: String = "",
    val description: String = "",
)
