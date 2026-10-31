# 导航地图

日期：2026-06-26

这是一张从“我要改什么”出发的导航表，目标是把模块、`Case` 和关键文件连起来。

## 从需求到模块

| 想做的事 | 先看模块 | 主要 `Case` | 关键文件 |
| --- | --- | --- | --- |
| 看整体架构 | `getting-started-architecture` | - | `index.md` |
| 开始写代码 | `developer-playbook` | - | `PriestessRuntime.kt`, `CoreModule.kt` |
| 改消息接入 | `platform` + `pipeline` | `PlatformCase`, `PipelineCase` | `PlatformController.kt`, `PipelineController.kt` |
| 改 LLM 推理 | `agent` + `provider` + `tool` | `AgentCase`, `ProviderCase`, `ToolCase` | `ReActRunner.kt`, `ContextManager.kt`, `ToolExecutor.kt` |
| 改上下文压缩 | `agent` | `AgentCase` | `agent/context/*` |
| 改工具执行 | `tool` | `ToolCase` | `ToolExecutor.kt`, `ToolController.kt` |
| 改 Skill 注入 | `skill` | `SkillCase` | `SkillController.kt`, `PipelineSkillState.kt` |
| 改知识查询 | `knowledge` | `KnowledgeCase` | `KnowledgeController.kt` |
| 改记忆存取 | `memory` | `MemoryCase` | `MemoryController.kt` |
| 改提醒投递 | `reminder` | `ReminderCase` | `ReminderController.kt` |
| 改角色设定 | `persona` | `PersonaCase` | `PersonaController.kt`, `PersonaMemoryInjector.kt` |
| 改 workspace | `workspace` | `WorkspaceController` | `WorkspaceConfigSource.kt`, `RealWorkspaceMcpToolResolver.kt` |
| 改配置系统 | `config` | `ConfigurationRuntimeService` | `config/model`, `config/source`, `config/resolve`, `config/runtime` |
| 改插件生命周期 | `plugin` | `PluginCase` | `PluginController.kt`, `PluginExtensionRegistry.kt` |
| 改观测和健康 | `observability` + `server` | - | `MetricsRegistry.kt`, `DashboardService.kt` |

## 从模块到入口

### 平台链路

- `PlatformCase.handleIncomingMessage(...)`
- `PipelineCase.process(...)`
- `PipelineController.process(...)`

### 推理链路

- `AgentCase.createAgent(...)`
- `ReActRunner.stepUntilDone()`
- `ContextManager.compress(...)`
- `ToolExecutor.execute(...)`

### 作用域链路

- `WorkspaceController.resolve(...)`
- `SkillCase.getWorkspaceSkillState(...)`
- `PersonaCase.resolve(...)`
- `ConversationCase.getOrCreate(...)`

## 常见问题定位

### 我只想知道消息为什么没回复

先看 `message-flow.md`，再看 `platform` 和 `pipeline`，然后检查 `RespondStage` 和对应平台 adapter。

### 我只想知道为什么模型没调用工具

先看 `llm-flow.md`，再看 `provider`、`tool` 和 `AgentContext`，然后确认 `ToolPolicy` 和 workspace 的 tool scope。

### 我只想知道为什么 skill 没生效

先看 `skill`，再看 `workspace` 的 skill scope，最后看 `ReActRunner.buildSystemPrompt()`。

### 我只想知道为什么某个配置没刷新

先看 `config`，再看 `WorkspaceController`、`ProviderController` 和订阅 Flow 的地方。

## 建议阅读顺序

1. `index.md`
2. `getting-started-architecture.md`
3. `developer-playbook.md`
4. `navigation-map.md`
5. 具体模块页
