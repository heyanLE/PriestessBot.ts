package com.heyanle.priestess.bot.agent.runner

import com.heyanle.priestess.bot.agent.*
import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.ContextSummarizer
import com.heyanle.priestess.bot.agent.preset.AgentPresetRegistry
import com.heyanle.priestess.bot.agent.prompt.AgentDirectoryInstructionsRenderer
import com.heyanle.priestess.bot.agent.prompt.SystemPromptAssembler
import com.heyanle.priestess.bot.provider.ChatProvider
import com.heyanle.priestess.bot.provider.model.ConversationMessage
import com.heyanle.priestess.bot.provider.model.LLMRequest
import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolResultMaterialization
import com.heyanle.priestess.bot.tool.ToolResultMaterializationConfig
import com.heyanle.priestess.bot.tool.ToolResultMaterializer
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.pipeline.PermissionGroup
import com.heyanle.priestess.bot.observability.trace.TraceCategory
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * ReAct (Reasoning + Acting) 执行器。
 *
 * 核心循环：
 * 1. 检查上下文 → ContextManager.compress()
 * 2. 调 LLM → provider.textChat(messages, tools)
 * 3. 有 ToolCall → ToolCase.executeBatch() → 结果注入消息 → 回到步骤 1
 * 4. 无 ToolCall → Final 回答
 * 5. 超 maxSteps → Error
 */
open class ReActRunner(
    private val context: AgentContext,
    private val provider: ChatProvider,
    private val toolCase: ToolCase,
    private val contextManager: ContextManager,
    private val overflowStore: ToolResultOverflowStore = ToolResultOverflowStore(),
    private val resultMaterializer: ToolResultMaterializer = ToolResultMaterializer(overflowStore),
    private val hooks: AgentHooks? = null,
    /** How one step's tool calls are dispatched. Appended last so existing callers are unaffected. */
    private val toolScheduler: ToolCallScheduler = SerialToolCallScheduler(),
) : AgentRunner {

    private val toolCallExecutor = ToolCallExecutor(toolCase, resultMaterializer)

    /**
     * Summarization runs on this runner's own provider. It is called directly rather than through
     * [requestModel] so a compaction summary is not recorded as another step request in the trace.
     */
    private val summarizer = ContextSummarizer { messages, maxTokens ->
        provider.textChat(
            LLMRequest(
                model = context.agent.model,
                messages = messages,
                tools = emptyList(),
                temperature = 0.0,
                maxTokens = maxTokens,
            ),
        ).content
    }

    private val mutex = Mutex()

    // `final` keeps the interface override non-overridable, which is what allows the private setter on
    // an open class. Subclasses change scheduling, never the state machine.
    final override var state: AgentState = AgentState.IDLE
        private set

    private var currentStep: Int = 0
    private var finalResponseCache: AgentResponse.Final? = null
    private var systemMessage: ConversationMessage? = null

    private fun refreshSystemMessage() {
        val next = ConversationMessage.system(buildSystemPrompt())
        val current = systemMessage
        if (current == null) {
            systemMessage = next
            context.messages.add(0, next)
            return
        }
        if (current.content == next.content) return
        val index = context.messages.indexOf(current)
        if (index >= 0) {
            context.messages[index] = next
        } else {
            context.messages.add(0, next)
        }
        systemMessage = next
    }

    override suspend fun reset() = mutex.withLock {
        state = AgentState.IDLE
        currentStep = 0
        finalResponseCache = null
        systemMessage = null
        context.responseIntent.clear()
    }

    override suspend fun step(): AgentResponse = mutex.withLock {
        doStep()
    }

    override suspend fun stepUntilDone(): AgentResponse = mutex.withLock {
        hooks?.onAgentBegin(context)
        state = AgentState.RUNNING

        while (currentStep < context.agent.maxSteps && state == AgentState.RUNNING) {
            val response = doStep()
            when (response) {
                is AgentResponse.Final -> {
                    return@withLock response
                }
                is AgentResponse.Error -> {
                    state = AgentState.ERROR
                    return@withLock response
                }
                is AgentResponse.ToolExecuted -> currentStep++
                is AgentResponse.Thinking -> currentStep++
            }
        }

        if (state == AgentState.RUNNING) {
            return@withLock forceFinalResponseAfterMaxSteps()
        }

        return@withLock finalResponseCache
            ?: AgentResponse.Error("Agent ended in unexpected state: $state")
    }

    /**
     * 核心单步执行逻辑，不加锁，调用者需确保在 mutex.withLock 内调用。
     */
    private suspend fun doStep(): AgentResponse {
        if (state == AgentState.DONE) {
            return finalResponseCache ?: AgentResponse.Error("Agent is done but no final response cached")
        }
        if (state == AgentState.ERROR) {
            return AgentResponse.Error("Agent is in error state, cannot continue")
        }

        if (state == AgentState.IDLE) {
            refreshSystemMessage()
            state = AgentState.RUNNING
        }

        val stepStarted = System.nanoTime()
        context.executionTrace?.record(TraceCategory.AGENT, "step.started", step = currentStep + 1)
        return try {
            refreshSystemMessage()
            val compressed = contextManager.compress(
                agent = context.agent,
                messages = context.messages,
                systemMessage = systemMessage,
                summarizer = summarizer,
            )

            val tools = workspaceScopedTools().map { tool ->
                tool.schema.toOpenAIFormat()
            }
            val request = LLMRequest(
                model = context.agent.model,
                messages = compressed.toList(),
                tools = tools,
                temperature = context.agent.temperature,
                maxTokens = context.agent.maxOutputTokens,
            )

            val response = requestModel(request)

            if (response.hasToolCalls()) {
                handleToolCalls(response)
            } else {
                handleFinalResponse(response)
            }
        } catch (e: CancellationException) {
            context.executionTrace?.record(TraceCategory.AGENT, "step.cancelled", step = currentStep + 1)
            throw e
        } catch (e: Exception) {
            context.executionTrace?.record(TraceCategory.AGENT, "step.error", buildJsonObject {
                put("error", e.message ?: e::class.simpleName)
            }, step = currentStep + 1)
            val error = AgentResponse.Error(
                message = e.message ?: "Unknown error during agent step",
                cause = e,
            )
            state = AgentState.ERROR
            hooks?.onAgentError(context, error)
            error
        } finally {
            context.executionTrace?.record(TraceCategory.AGENT, "step.finished", buildJsonObject {
                put("state", state.name)
            }, step = currentStep + 1, durationMillis = (System.nanoTime() - stepStarted) / 1_000_000)
        }
    }

    private suspend fun requestModel(request: LLMRequest): com.heyanle.priestess.bot.provider.model.LLMResponse {
        val started = System.nanoTime()
        context.executionTrace?.llmRequest(currentStep + 1, request)
        return try {
            provider.textChat(request).also {
                context.executionTrace?.llmResponse(currentStep + 1, it, (System.nanoTime() - started) / 1_000_000)
            }
        } catch (e: Exception) {
            context.executionTrace?.record(TraceCategory.LLM, if (e is CancellationException) "llm.cancelled" else "llm.error", buildJsonObject {
                put("error", e.message ?: e::class.simpleName)
            }, step = currentStep + 1, durationMillis = (System.nanoTime() - started) / 1_000_000)
            throw e
        }
    }

    override fun isDone(): Boolean = state == AgentState.DONE || state == AgentState.ERROR

    override fun finalResponse(): AgentResponse.Final? = finalResponseCache

    private suspend fun handleToolCalls(
        response: com.heyanle.priestess.bot.provider.model.LLMResponse
    ): AgentResponse {
        val toolCalls = response.toolCalls

        val assistantMsg = ConversationMessage.assistant(
            content = response.content,
            toolCalls = toolCalls,
        )
        context.messages.add(assistantMsg)

        val toolContext = buildToolContext()
        val step = currentStep + 1

        // Execution order is the scheduler's business; append order never is. Observations are appended
        // afterwards in submission order, so a concurrent step still produces a deterministic transcript.
        val outcomes = toolScheduler.execute(toolCalls) { call ->
            toolCallExecutor.execute(context, toolContext, call, step, hooks)
        }
        outcomes.forEach { outcome ->
            toolCallExecutor.appendObservation(context, outcome, hooks)
        }

        return AgentResponse.Thinking(response.content)
    }

    private suspend fun handleFinalResponse(
        response: com.heyanle.priestess.bot.provider.model.LLMResponse
    ): AgentResponse {
        val assistantMsg = ConversationMessage.assistant(content = response.content)
        context.messages.add(assistantMsg)

        val final = AgentResponse.Final(response.content)
        finalResponseCache = final
        state = AgentState.DONE
        hooks?.onAgentDone(context, final)
        return final
    }

    private suspend fun forceFinalResponseAfterMaxSteps(): AgentResponse {
        context.messages.add(ConversationMessage.user(MAX_STEPS_REACHED_PROMPT))
        val stepStarted = System.nanoTime()
        context.executionTrace?.record(TraceCategory.AGENT, "step.started", buildJsonObject {
            put("forcedFinal", true)
        }, step = currentStep + 1)
        return try {
            refreshSystemMessage()
            val compressed = contextManager.compress(
                agent = context.agent,
                messages = context.messages,
                systemMessage = systemMessage,
                summarizer = summarizer,
            )
            val response = requestModel(
                LLMRequest(
                    model = context.agent.model,
                    messages = compressed,
                    tools = emptyList(),
                    temperature = context.agent.temperature,
                    maxTokens = context.agent.maxOutputTokens,
                ),
            )
            val content = response.content.ifBlank { "工具调用次数已达到上限，当前无法继续执行工具。" }
            val final = AgentResponse.Final(content)
            context.messages.add(ConversationMessage.assistant(content))
            finalResponseCache = final
            state = AgentState.DONE
            hooks?.onAgentDone(context, final)
            final
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val final = AgentResponse.Final(
                "已达到工具调用上限，且最终总结请求未完成。请基于已执行的工具结果继续处理，或简化后重试。",
            )
            context.messages.add(ConversationMessage.assistant(final.content))
            finalResponseCache = final
            state = AgentState.DONE
            hooks?.onAgentDone(context, final)
            final
        } finally {
            context.executionTrace?.record(TraceCategory.AGENT, "step.finished", buildJsonObject {
                put("state", state.name); put("forcedFinal", true)
            }, step = currentStep + 1, durationMillis = (System.nanoTime() - stepStarted) / 1_000_000)
        }
    }

    private fun buildToolContext(): AgentToolContext {
        return AgentToolContext(
            conversationId = context.conversationId,
            platform = context.platform,
            session = context.session,
            agentName = context.agent.name,
            model = context.agent.model,
            metadata = context.metadata + effectiveToolMetadata(),
            scopedTools = context.scopedTools,
            skillState = context.skillState,
            permissionGroup = context.permissionGroup,
            minimumToolPermissionGroups = context.agent.minimumToolPermissionGroups,
            responseIntent = context.responseIntent,
        )
    }

    private fun workspaceScopedTools(): List<FunctionTool> {
        val allowed = context.agent.effectiveToolIds ?: workspaceToolNames()
        val tools = (toolCase.getAll() + context.scopedTools)
            .distinctBy { it.schema.name }
        val workspaceVisible = if (allowed == null) {
            tools
        } else {
            tools.filter { it.schema.name in allowed }
        }
        return workspaceVisible.filter { tool ->
            val requiredPermission = requiredPermission(tool)
            val permissionAllowed = if (context.agent.strictPermissionToolFiltering) {
                context.permissionGroup.satisfies(requiredPermission)
            } else {
                requiredPermission != PermissionGroup.SUPER_ADMIN ||
                    context.permissionGroup.satisfies(PermissionGroup.SUPER_ADMIN)
            }
            tool.schema.name !in context.agent.deniedToolIds &&
                tool.schema.riskLevel in context.agent.allowedRiskLevels &&
                permissionAllowed
        }
    }

    private fun effectiveToolMetadata(): Map<String, String> {
        val names = workspaceScopedTools().map { it.schema.name }.sorted().joinToString(",")
        return mapOf("workspaceToolNames" to names)
    }

    private fun workspaceToolNames(): Set<String>? {
        val raw = context.metadata["workspaceToolNames"] ?: return null
        return raw.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toSet()
    }

    private val presetDefinition = AgentPresetRegistry.of(context.agent.preset)

    /**
     * The preset decides which sections appear and in what order; one assembler serves every preset.
     * Tool schemas travel to the provider as native function definitions, and tools the caller cannot use
     * are already filtered out by [workspaceScopedTools], so the prompt never advertises unavailable
     * capabilities.
     */
    private val systemPromptAssembler = SystemPromptAssembler(
        sections = presetDefinition.sections,
        identityTemplate = presetDefinition.identityTemplate,
        instructions = presetDefinition.instructionsDocument?.let {
            AgentDirectoryInstructionsRenderer(it.fileNames, it.maxBytes)
        },
    )

    private fun buildSystemPrompt(): String = systemPromptAssembler.assemble(context, workspaceScopedTools())

    private fun requiredPermission(tool: FunctionTool): PermissionGroup = maxOf(
        tool.schema.requiredPermissionGroup,
        context.agent.minimumToolPermissionGroups[tool.schema.name] ?: PermissionGroup.OPERATOR,
    )

    private companion object {
        const val MAX_STEPS_REACHED_PROMPT = "Maximum tool call limit reached. Stop calling tools and, based on the information already gathered, give the user a concise final answer."
    }
}
