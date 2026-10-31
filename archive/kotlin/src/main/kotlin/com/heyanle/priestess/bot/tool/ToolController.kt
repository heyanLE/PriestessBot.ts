package com.heyanle.priestess.bot.tool

import com.heyanle.priestess.bot.core.controller.BaseController

/**
 * 工具控制器，负责维护已注册工具和聚合 ToolSet 视图并承接工具模块生命周期。
 */
class ToolController : BaseController("ToolController") {

    private val tools = mutableListOf<RegisteredTool>()
    private val toolSet = ToolSet()

    fun register(tool: FunctionTool, metadata: ToolMetadata = ToolMetadata()) {
        tools.removeAll { it.schema.name == tool.schema.name }
        tools.add(RegisteredTool(tool, metadata))
        toolSet.removeByName(tool.schema.name)
        toolSet.add(tool)
    }

    fun registerAll(newTools: Collection<FunctionTool>) {
        newTools.forEach { register(it) }
    }

    fun unregister(name: String) {
        tools.removeAll { it.schema.name == name }
        toolSet.removeByName(name)
    }

    fun get(name: String): FunctionTool? = toolSet.get(name)

    fun getAll(): List<FunctionTool> = tools.map { it.tool }

    fun getRegisteredTools(): List<RegisteredTool> = tools.toList()

    fun getToolSet(): ToolSet = toolSet

    fun toOpenAIFormat() = toolSet.toOpenAIFormat()

    fun size(): Int = tools.size

    fun isEmpty(): Boolean = tools.isEmpty()

    fun scanAndRegister(classLoader: ClassLoader = Thread.currentThread().contextClassLoader) = Unit

    override suspend fun stop() {
        tools.clear()
        toolSet.clear()
        super.stop()
    }
}
