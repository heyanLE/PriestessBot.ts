package com.heyanle.priestess.bot.core.di

import com.heyanle.priestess.bot.agent.context.ContextManager
import com.heyanle.priestess.bot.agent.context.TokenCounter
import com.heyanle.priestess.bot.agent.AgentCase
import com.heyanle.priestess.bot.agent.AgentController
import com.heyanle.priestess.bot.PriestessRuntime
import com.heyanle.priestess.bot.config.resolve.ConfigurableToolDescriptor
import com.heyanle.priestess.bot.config.resolve.ConfigurationCompiler
import com.heyanle.priestess.bot.config.runtime.ConfigurationRuntimeService
import com.heyanle.priestess.bot.config.runtime.EffectiveConfigStore
import com.heyanle.priestess.bot.config.runtime.RuntimeConfigurationCase
import com.heyanle.priestess.bot.config.source.ProcessConfigurationPath
import com.heyanle.priestess.bot.config.runtime.databaseConfig
import com.heyanle.priestess.bot.config.runtime.permissionConfig
import com.heyanle.priestess.bot.config.runtime.serverConfig
import com.heyanle.priestess.bot.conversation.ConversationCase
import com.heyanle.priestess.bot.conversation.ConversationController
import com.heyanle.priestess.bot.conversation.MessageHistory
import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.core.db.DatabaseController
import com.heyanle.priestess.bot.knowledge.KnowledgeCase
import com.heyanle.priestess.bot.knowledge.KnowledgeController
import com.heyanle.priestess.bot.memory.MemoryCase
import com.heyanle.priestess.bot.memory.MemoryController
import com.heyanle.priestess.bot.observability.ObservabilityCase
import com.heyanle.priestess.bot.observability.ObservabilityController
import com.heyanle.priestess.bot.pipeline.PipelineCase
import com.heyanle.priestess.bot.pipeline.PipelineController
import com.heyanle.priestess.bot.persona.PersonaCase
import com.heyanle.priestess.bot.persona.PersonaController
import com.heyanle.priestess.bot.persona.PersonaMemoryInjector
import com.heyanle.priestess.bot.persona.PersonaPermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionDeniedMessageResolver
import com.heyanle.priestess.bot.pipeline.PermissionResolver
import com.heyanle.priestess.bot.pipeline.CommandCase
import com.heyanle.priestess.bot.plugin.PluginCase
import com.heyanle.priestess.bot.plugin.PluginExtensionRegistry
import com.heyanle.priestess.bot.plugin.PluginController
import com.heyanle.priestess.bot.platform.PlatformCase
import com.heyanle.priestess.bot.platform.PlatformController
import com.heyanle.priestess.bot.platform.PlatformRegistry
import com.heyanle.priestess.bot.platform.registerBuiltinPlatforms
import com.heyanle.priestess.bot.platform.adapters.weixin.WeixinQrLoginService
import com.heyanle.priestess.bot.provider.ProviderCase
import com.heyanle.priestess.bot.provider.ProviderController
import com.heyanle.priestess.bot.reminder.ReminderCase
import com.heyanle.priestess.bot.reminder.ReminderController
import com.heyanle.priestess.bot.server.DashboardService
import com.heyanle.priestess.bot.server.ConfigurationManagementService
import com.heyanle.priestess.bot.server.PriestessBotServer
import com.heyanle.priestess.bot.server.RuntimeHealthProvider
import com.heyanle.priestess.bot.server.ServerCase
import com.heyanle.priestess.bot.server.ServerController
import com.heyanle.priestess.bot.skill.SkillCase
import com.heyanle.priestess.bot.skill.SkillController
import com.heyanle.priestess.bot.skill.DefaultSkill
import com.heyanle.priestess.bot.tool.ToolCase
import com.heyanle.priestess.bot.tool.ToolController
import com.heyanle.priestess.bot.tool.ToolExecutor
import com.heyanle.priestess.bot.tool.ToolResultOverflowStore
import com.heyanle.priestess.bot.tool.builtin.registerBuiltinTools
import com.heyanle.priestess.bot.workspace.RealMcpServerConnector
import com.heyanle.priestess.bot.workspace.WorkspaceCase
import com.heyanle.priestess.bot.workspace.WorkspaceController
import org.koin.dsl.module
import org.koin.core.qualifier.named

val coreModule = module {

    single { EffectiveConfigStore() }
    single {
        val scope = this
        RuntimeConfigurationCase(
            effectiveStore = get(),
            ensureStarted = {
                val result = scope.get<ConfigurationRuntimeService>().startup()
                check(result.success) {
                    "Configuration activation failed: " + result.diagnostics.joinToString { "${it.code}: ${it.message}" }
                }
            },
        )
    }
    single { ConfigurationCompiler(mcpConnector = RealMcpServerConnector()) }
    single { ObservabilityController() }
    single { ObservabilityCase(controller = get()) }

    single {
        DatabaseController(dbPath = get<RuntimeConfigurationCase>().current().databaseConfig().path)
    }
    single { DatabaseCase(controller = get()) }
    single(named("platformDatabase")) {
        val application = checkNotNull(get<RuntimeConfigurationCase>().current().application)
        val root = com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource()
            .resolveDirectory(ProcessConfigurationPath.current().path, application.platformDirectory)
        DatabaseCase(DatabaseController(root.resolve("resources.sqlite").toString()))
    }

    single { ConversationController(db = get<DatabaseCase>()) }
    single { MessageHistory(db = get<DatabaseCase>()) }
    single { ConversationCase(controller = get(), history = get()) }
    single { KnowledgeController(db = get<DatabaseCase>()) }
    single { KnowledgeCase(controller = get()) }
    single { MemoryController(db = get(named("platformDatabase"))) }
    single { MemoryCase(controller = get()) }
    single { PersonaController(db = get(named("platformDatabase"))) }
    single { PersonaCase(controller = get()) }
    single { PersonaMemoryInjector(personaCase = get(), memoryCase = get()) }
    single<PermissionDeniedMessageResolver> { PersonaPermissionDeniedMessageResolver(personaCase = get()) }
    single { PermissionResolver { get<RuntimeConfigurationCase>().current().permissionConfig() } }
    single { CommandCase() }
    single { ReminderController(db = get<DatabaseCase>()) }
    single { ReminderCase(controller = get()) }

    single {
        val controller = ToolController()
        val scope = this
        registerBuiltinPlatforms()
        val toolCase = ToolCase(
            controller = controller,
            executorProvider = {
                ToolExecutor(
                    registry = controller,
                    observabilityCase = scope.get(),
                    permissionDeniedMessageResolver = scope.get(),
                )
            },
        )
        registerBuiltinTools(
            registry = toolCase,
            knowledgeCaseProvider = { get<KnowledgeCase>() },
            serverCaseProvider = { get<ServerCase>() },
            conversationCaseProvider = { get<ConversationCase>() },
            memoryCaseProvider = { get<MemoryCase>() },
            reminderCaseProvider = { get<ReminderCase>() },
            workspaceCaseProvider = { get<WorkspaceCase>() },
            overflowStore = get(),
        )
        toolCase
    }

    single { ProviderController(runtimeConfig = get()) }
    single { ProviderCase(controller = get()) }

    single { TokenCounter() }
    single { ToolResultOverflowStore() }
    single { ContextManager(tokenCounter = get()) }
    single { AgentController() }
    single { AgentCase(controller = get(), contextManager = get(), overflowStore = get()) }
    single { SkillController().apply { register(DefaultSkill()) } }
    single { SkillCase(controller = get()) }
    single {
        val scope = this
        ConfigurationRuntimeService(
            configPath = ProcessConfigurationPath.current().path,
            compiler = get(),
            store = get(),
            registeredTools = {
                val runtime = scope.get<ToolCase>().getRegisteredTools().map { registered ->
                    ConfigurableToolDescriptor(registered.schema.name, registered.schema.riskLevel, registered.schema.defaultEnabled)
                }
                val platforms = PlatformRegistry.getDeclaredTools().map { tool ->
                    ConfigurableToolDescriptor(tool.schema.name, tool.schema.riskLevel, tool.schema.defaultEnabled)
                }
                (runtime + platforms).distinctBy { it.id }
            },
            availableSkills = { scope.get<SkillCase>().getAll().mapTo(linkedSetOf()) { it.name } },
            applicationSource = com.heyanle.priestess.bot.config.application.ApplicationConfigurationSource(),
        )
    }
    single { ConfigurationManagementService(runtime = get()) }
    single { com.heyanle.priestess.bot.server.ApplicationManagementService(runtime = get(), personas = get(), memories = get()) }
    single { com.heyanle.priestess.bot.resources.AgentSkillCatalog(runtime = get(), sourcePath = ProcessConfigurationPath.current().path) }
    single { com.heyanle.priestess.bot.observability.trace.ExecutionTraceController(db = get()) }
    single {
        WorkspaceController(
            effectiveStore = get(),
            configurationRuntime = get(),
        )
    }
    single { WorkspaceCase(controller = get()) }

    single { PluginExtensionRegistry() }
    single {
        PluginController(
            runtimeConfig = get(),
            extensionRegistry = get(),
            toolCase = get(),
            providerCase = get(),
        )
    }
    single { PluginCase(controller = get(), extensionRegistry = get()) }

    single {
        PipelineController(
            runtimeConfig = get(),
            conversationCase = get(),
            agentCase = get(),
            providerCase = get(),
            toolCase = get(),
            skillCase = get(),
            personaMemoryInjector = get(),
            commandCase = get(),
            permissionResolver = get(),
            permissionDeniedMessageResolver = get(),
            observabilityCase = get(),
            effectiveConfigStore = get(),
            executionTraces = get(),
            agentSkillCatalog = get(),
        )
    }
    single { PipelineCase(controller = get()) }

    single {
        val scope = this
        PlatformCase(
            pipelineCaseProvider = { scope.get<PipelineCase>() },
            controllerProvider = { scope.get<PlatformController>() },
        )
    }
    single { PlatformController(runtimeConfig = get(), platformCase = get()) }
    single { WeixinQrLoginService(runtimeConfig = get(), platformCase = get()) }

    single {
        RuntimeHealthProvider(
            platformCase = get(),
            providerCase = get(),
            toolCase = get(),
            pluginCase = get(),
            configurationRuntime = get(),
            runtimeConfig = get(),
        )
    }

    single {
        DashboardService(
            platformCase = get(),
            providerCase = get(),
            toolCase = get(),
            conversationCase = get(),
            pluginCase = get(),
            agentCase = get(),
            knowledgeCase = get(),
            observabilityCase = get(),
            healthProvider = get(),
            workspaceCase = get(),
            personaCase = get(),
            memoryCase = get(),
            configurationManagement = get(),
            pipelineCase = get(),
            weixinQrLoginService = get(),
            applicationManagement = get(),
            agentSkillCatalog = get(),
            executionTraces = get(),
        )
    }
    single {
        PriestessBotServer(config = get<RuntimeConfigurationCase>().current().serverConfig(), service = get())
    }
    single { ServerController(server = get()) }
    single { ServerCase(controller = get(), healthProvider = get()) }
    single {
        PriestessRuntime(
            platformCase = get(),
            pipelineCase = get(),
            serverCase = get(),
            pluginCase = get(),
            providerCase = get(),
            toolCase = get(),
            skillCase = get(),
            workspaceCase = get(),
            observabilityCase = get(),
            databaseCase = get(),
            overflowStore = get(),
            configurationRuntimeService = get(),
            effectiveConfigStore = get(),
            weixinQrLoginService = get(),
            platformResourceDatabase = get(named("platformDatabase")),
        )
    }
}
