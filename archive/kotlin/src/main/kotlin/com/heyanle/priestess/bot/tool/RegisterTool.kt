package com.heyanle.priestess.bot.tool

/**
 * Annotation to mark a class as a tool that should be auto-registered
 * by the ToolController.
 *
 * @deprecated Use [com.heyanle.priestess.bot.tool.annotation.Tool] instead.
 */
@Deprecated("Use com.heyanle.priestess.bot.tool.annotation.Tool", ReplaceWith("com.heyanle.priestess.bot.tool.annotation.Tool"))
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class RegisterTool(
    val name: String = "",
    val description: String = "",
)
