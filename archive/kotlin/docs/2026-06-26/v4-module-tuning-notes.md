# v4 分模块调优记录

## 协作角色

- 架构审计角色：检查 case 门面、跨模块依赖和构造注入边界。
- 流程排障角色：检查信息处理流、ReAct tool 调用和上下文消息保留链路。
- 验证角色：在每一步修改前后补充最小测试或现有测试覆盖点。

## 本轮只读证据

- `PipelineController` 负责构造完整消息处理 stage 列表，并把多个模块依赖传入 `PreProcessStage` 与 `ProcessStage`。
- `PreProcessStage` 当前直接依赖 `ConversationCase`、`AgentCase`、`SubAgentOrchestrator`、`WorkspaceController`、`PersonaMemoryInjector`、`SkillCase`。
- `ProcessStage` 当前直接依赖 `ProviderCase`、`ToolExecutor`、`ToolController`、`ContextManager`。
- `ReActRunner` 在收到 tool call 后，会把 assistant tool-call 消息和 tool result 消息追加到 `AgentContext.messages`。
- 当前消息由 `ProcessStage` 追加为 `ConversationMessage.user(ctx.textContent)`，之后进入 `ReActRunner.stepUntilDone()`。
- `ContextManager.compress()` 每次 LLM 调用前都会基于 `AgentContext.messages` 做压缩；tool 调用后的第二轮 LLM 请求也会重新经过压缩。
- `TokenWindowStrategy` 和 `LLMCompressStrategy` 的 fallback 会按 token 窗口从末尾回收消息；已有测试覆盖了保留 tool observation，但没有明确断言“tool 调用后的第二轮请求仍保留当前 user 消息”。

## 已发现的边界风险

### pipeline 包

- `PreProcessStage` 承担了会话读取、历史转换、agent 创建、子 agent 选择、workspace 解析、persona/memory 注入、skill state 注入、持久化等职责。
- 这些职责跨越 conversation、agent、workspace、persona、memory、skill 等模块，后续如果严格执行“跨模块只能依赖 case”，需要先确认 `PipelineController`/stage 是否属于编排层，还是也要受普通模块边界限制。
- `PreProcessStage` 直接依赖 `WorkspaceController`，这和“跨模块引用只能依赖 case”存在疑似冲突。
- `ProcessStage` 直接依赖 `ToolController`，同时 `ReActRunner` 也直接依赖 `ToolController`；这和“跨模块引用只能依赖 case”存在疑似冲突。
- `PipelineController` 构造参数混入 `ContextManager`、`ToolExecutor`、`ToolController`、`SubAgentOrchestrator`、`WorkspaceController`、`PersonaMemoryInjector` 等非 case 依赖。
- `ProcessStage` 直接实例化 `ReActRunner`，pipeline 包因此直接知道 agent runner 实现。
- `PipelineCase` 注入同包 `PipelineController` 本身可接受，但 API 直接接收 `platform.MessageEvent`；如果跨模块 model/entity 也禁止，需要单独处理。

### agent 包

- `SubAgentOrchestrator` 直接依赖 `ProviderCase`、`ToolExecutor`、`ToolController`、`ContextManager`。
- `ReActRunner` 直接依赖 `ToolExecutor`、`ToolController`、`ContextManager`、`ChatProvider`。
- 如果 agent 包被定义为纯领域执行模块，则这些依赖可能需要通过 case 或接口收口；如果 agent runner 被视为编排实现，则需单独确认规则边界。
- `SubAgentOrchestrator` 还 import 了 `provider.model.ConversationMessage` 和 `server.AgentChatEventDto`，存在 agent 反向感知 server DTO 的疑似边界问题。
- `AgentCase.createAgent(config: AgentConfig)` 直接依赖 config 模块模型；如果跨模块 model 也必须经 case，则需要后续重构。

### server 包

- `DashboardService` 直接依赖多个 case，同时也直接依赖 `ConfigController`、`PlatformController`、`ToolController`、`WorkspaceController` 等 controller。
- dashboard/server 是否作为应用编排层豁免，需要确认。
- `DashboardService` 直接 import 并实例化 `ReActRunner`。
- `RuntimeHealthProvider` 直接依赖 `ConfigController`、`PlatformController`、`ToolController`，同时混用若干 case。

### plugin 包

- `PluginController` 直接依赖 `ToolController`、`ProviderController`。
- `DefaultPluginContext` 暴露并使用 `ToolController`、`ProviderController` 级别能力；这可能需要插件专用门面或通过 `ToolCase`/`ProviderCase` 收口。

### workspace/skill/reminder 包

- `WorkspaceController` 直接依赖 `ToolController`，同时依赖 `SkillCase`；`ToolController` 是疑似违规点。
- `SkillCase.getWorkspaceSkillState(snapshot: WorkspaceSnapshot)` 直接使用 workspace 模块模型；是否违规取决于跨模块 model 规则。
- `ReminderCase.deliverDue(platform: Platform, ...)` 直接依赖 platform 模块类型；如果 case API 也必须只面向本模块数据，需要调整。

### runtime/di

- `core.di.CoreModule` 是集中装配位置，当前同时装配 controller 和 case。
- `PriestessRuntime` 直接依赖多个 controller 进行停止流程。
- 需要确认 DI/runtime 是否允许直接依赖 controller，或也要全部通过 case 暴露生命周期能力。
- 如果 composition root 允许看到 controller，则 `CoreModule` 可先视为装配例外；如果不允许，它会成为最大集中违规面。

### tests

- 架构测试和系统测试中大量手工装配 controller/case 混合对象。
- 需要确认测试是否也必须遵守“跨模块只能依赖 case”，否则后续架构守卫容易产生大量误报。

## 当前问题的可能链路

问题：信息处理流开始后，如果调用 tool，会丢失当前上下文消息。

当前可见链路：

1. 平台消息进入 `PipelineController.process()`。
2. `PreProcessStage` 读取历史消息，创建 `AgentContext(messages = history)`。
3. `ProcessStage` 追加当前用户消息到 `AgentContext.messages`。
4. `ReActRunner` 第一轮调用 `ContextManager.compress()`，再调用 provider。
5. provider 返回 tool call 时，`ReActRunner` 追加 assistant tool-call 消息。
6. tool 执行完成后，`ReActRunner` 追加 tool result 消息。
7. 第二轮调用 provider 前，再次调用 `ContextManager.compress()`。

需优先验证的缺口：

- 第二轮 provider request 是否仍包含当前 user 消息。
- 压缩触发时，当前 user 消息、assistant tool-call 消息、tool result 消息是否会被作为一个完整当前回合保留。
- 历史持久化时，`MessageRole.TOOL` 的 `name` 当前由 `content` 回填，是否影响后续 provider 适配器对 tool 消息的格式要求。
- `TokenWindowStrategy` 从末尾按 token 回收时，可能在 tool observation 较长、`maxContextTokens` 较小时保留 assistant/tool 片段但挤掉本轮 user。
- `MessageHistory.getRecentMessages()` 按消息条数截取，不按完整轮次截取；上一轮 tool 结构可能被恢复成不完整历史片段。
- `PreProcessStage` 持久化时用 `indexOfLast { role == "user" && content == ctx.textContent }` 定位本轮 user；如果历史里有相同内容或当前 user 不在内存消息中，持久化范围可能异常。

## 建议的第一步候选

候选 A：先处理 `pipeline` 包。

- 原因：用户反馈的问题发生在信息处理流，且 `pipeline` 是当前跨模块依赖最集中的包。
- 第一步只做验证测试：补一个失败用例，断言 tool 调用后的第二轮 LLM request 仍包含当前 user 消息。
- 通过这个测试决定后续是否改 `ContextManager`/压缩策略，或调整 `ProcessStage` 的消息组装方式。
- 子角色一致建议：优先从 `pipeline` 开始，因为它同时覆盖 bug 入口和模块边界最大风险面。

候选 B：先处理 `agent` 包。

- 原因：tool 调用后的第二轮请求由 `ReActRunner` 发起，压缩策略也在 agent context 下。
- 第一步只做验证测试：直接测 `ReActRunner` 在压缩触发时保留当前 user + assistant tool-call + tool result。
- 这能更快定位 bug，但不会马上解决 pipeline 的跨模块边界问题。

候选 C：先做架构边界守卫。

- 原因：可以把“case 不能注入其他模块类、跨模块只能依赖 case”的规则写成架构测试，避免后续调优反复回退。
- 风险：需要先确认 runtime、DI、server、pipeline 编排层是否豁免，否则测试规则会过宽或过严。

## 暂停确认点

请确认第一步从哪个候选开始：

- A：pipeline 包，先复现 tool 后丢上下文消息。
- B：agent 包，先隔离验证 ReAct/tool/压缩链路。
- C：架构边界守卫，先定义并固化 case 依赖规则。

未确认前不进入代码修改。
