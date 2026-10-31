# testing — 测试覆盖与质量体系

v3 测试目标是把项目从「能跑」推进到「能安全改」。测试负责人需要建立分层测试体系，并把每个核心模块的风险点映射为测试。

## 当前现状

当前 v3 testing foundation 已完成，默认 `./gradlew test` 覆盖 unit、integration、system 和 regression 基础入口：

- Agent/ReAct：`ReActRunnerTest` 覆盖 final、tool-call loop、provider error、tool failure、maxSteps、workspace scoped tools、tool timeout。
- Context compression：round truncation、token window、LLM compression fallback。
- Tool：`ToolSchemaTest`、`ToolPolicyTest`、`ToolExecutorTest` 以及各核心 built-in tool 测试覆盖权限、timeout、batch、metrics、schema 与错误路径。
- Pipeline：stage basics、PreProcess、Process、ResultDecorate、onion flow、workspace pinned snapshot 和系统消息链路。
- Dashboard API：`DashboardRoutesTest` 覆盖 health、metrics、config、platform、provider、tool、conversation、plugin、logs WebSocket、sub-agent、knowledge、workspace、persona/memory 和 Agent chat trace。
- Workspace：reload 成功替换、失败回滚、in-flight snapshot 隔离、MCP handle lifecycle。
- Persona/memory：persona resolution、prompt injection metadata、memory scope/delete/expiration、memory tools。
- System：`MessageFlowSystemTest` 使用 fake platform/provider/tool 覆盖 credential-free ReAct tool chain。

剩余边界：

- 默认 gate 仍保持无外部凭据；真实外部服务 smoke test 如需添加，应保持 opt-in。
- 新增 bug fix 或公开 API 仍必须补 failing-before-fix 回归测试。

## 测试分层

### Unit Tests

目标：覆盖纯逻辑、边界条件和异常路径。

必须覆盖：

- `ReActRunner`
  - 无 tool call 返回 Final。
  - 有 tool call 时追加 assistant/tool messages 后继续循环。
  - tool executor 抛异常时转换为失败 observation。
  - provider 抛异常时返回 Error。
  - maxSteps 超限返回 Error。
  - state 为 DONE/ERROR 后 step 行为。
- `ContextManager`
  - round truncation。
  - token window。
  - LLM compress fallback。
- `ToolExecutor`
  - 未知工具。
  - 参数 JSON 解析失败。
  - 工具执行异常。
  - batch 多工具顺序执行。
  - 指标记录。
- `PipelineStage`
  - 每个 stage 的 allow/block/stop 行为。
  - `PreProcessStage` 创建 AgentContext。
  - `RespondStage` final/error 发送行为。
- `WorkspaceConfig`
  - 配置解析。
  - reload 校验失败不覆盖当前快照。
- `PersonaMemory`
  - persona prompt 渲染。
  - memory scope 过滤。
  - memory expiration。

### Integration Tests

目标：验证模块间接口契约。

必须覆盖：

- Pipeline -> ReActRunner -> ToolExecutor -> Respond。
- Config reload -> ProviderController/PlatformController/PipelineController。
- Plugin load/enable -> register tool/provider/platform -> disable cleanup。
- Dashboard API -> service -> controller。
- KnowledgeSearchTool -> KnowledgeCase -> KnowledgeController。
- Workspace reload -> MCP/skill/tool/persona/memory config snapshot。

### System Tests

目标：用 mock 平台和 fake provider 验证真实消息链路。

标准场景：

1. 用户消息进入 mock platform。
2. Pipeline 创建会话并保存 user message。
3. Fake provider 先返回 tool call。
4. ToolExecutor 执行 fake tool。
5. Fake provider 读取 observation 后返回 final。
6. RespondStage 调用 mock platform sendMessage。
7. Conversation history 包含 user/assistant/tool/final。
8. Metrics 增加 pipeline、LLM、tool 指标。

系统测试不依赖真实 Telegram/NapCat/OpenAI 凭据。

## 测试目录建议

```text
src/test/kotlin/com/heyanle/priestess/bot/
  agent/runner/ReActRunnerTest.kt
  tool/ToolExecutorTest.kt
  pipeline/stages/*StageTest.kt
  workspace/WorkspaceControllerTest.kt
  persona/PersonaControllerTest.kt
  memory/MemoryControllerTest.kt
  system/MessageFlowSystemTest.kt
```

## 质量门禁

- PR 必须运行 `./gradlew test`。
- 核心模块新增 public API 必须有 unit test。
- 修复 bug 必须新增回归测试。
- 新增 tool 必须覆盖 schema、成功、参数错误、执行失败、权限拒绝。
- 新增 Dashboard API 必须覆盖 route test。
- 系统测试必须覆盖至少一条 ReAct tool call 链路。

## 验证状态

- OpenSpec `v3-testing-foundation` 已完成 41/41 个任务，并通过 `openspec validate v3-testing-foundation --strict`。
- 本地默认门禁 `./gradlew test` 已覆盖 unit、integration、system 和 regression 基础入口。
- Dashboard API、workspace reload、persona/memory、core tools、pipeline stages 和 credential-free message flow 均已有对应测试入口。

## 可执行任务

- [x] 新增 `ReActRunnerTest`，覆盖 final/tool/error/maxSteps。
- [x] 新增 `ToolExecutorTest`，覆盖解析、异常、batch、metrics。
- [x] 为 9 个 pipeline stage 建立 stage-level 单测。
- [x] 新增 fake platform/fake provider/fake tool fixture。
- [x] 新增 `MessageFlowSystemTest`。
- [x] 补齐 Dashboard API route contract 测试。
- [x] 为 workspace reload 设计失败回滚测试。
- [x] 为 persona/memory 管理设计 scope、注入、删除、过期测试。
