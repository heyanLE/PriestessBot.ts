package com.heyanle.priestess.bot.tool

/**
 * 工具模块门面，向其他模块提供工具查询、列表转换和只读注册信息。
 */
class ToolCase(
    private val controller: ToolController,
    private val executorProvider: () -> ToolExecutor = { ToolExecutor(controller) },
) {
    private val executor: ToolExecutor by lazy(executorProvider)

    fun get(name: String): FunctionTool? = controller.get(name)
    fun getAll(): List<FunctionTool> = controller.getAll()
    fun getRegisteredTools(): List<RegisteredTool> = controller.getRegisteredTools()
    fun size(): Int = controller.size()
    fun list(filters: ToolListingFilters = ToolListingFilters()): List<ToolListingItem> {
        return ToolListing.list(controller.getRegisteredTools(), filters)
    }
    fun toOpenAIFormat() = controller.toOpenAIFormat()

    fun registerBuiltinTool(tool: FunctionTool, statusReason: String? = null) {
        controller.register(tool, ToolMetadata(statusReason = statusReason))
    }

    fun registerPluginTool(pluginId: String, tool: FunctionTool) {
        val name = tool.schema.name
        controller.unregister(name)
        controller.register(
            tool = tool,
            metadata = ToolMetadata(source = ToolSource.PLUGIN, owner = pluginId),
        )
    }

    fun unregisterPluginTool(name: String) {
        controller.unregister(name)
    }

    suspend fun execute(
        context: AgentToolContext,
        toolCallName: String,
        argumentsJson: String,
        timeoutMillis: Long = ToolExecutor.DEFAULT_TIMEOUT_MILLIS,
    ): ToolResult {
        return executor.execute(context, toolCallName, argumentsJson, timeoutMillis)
    }

    suspend fun executeBatch(
        context: AgentToolContext,
        toolCalls: List<Triple<String, String, String>>,
        timeoutMillis: Long = ToolExecutor.DEFAULT_TIMEOUT_MILLIS,
    ): Map<String, ToolResult> {
        return executor.executeBatch(context, toolCalls, timeoutMillis)
    }

    suspend fun stop() {
        controller.stop()
    }
}
