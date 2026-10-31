# Testing Quality Gate

梳理时间：2026-06-24；v3 首批验收覆盖更新至 2026-06-25

本文记录 v3 testing foundation 的回归测试约定、无凭据质量门禁和模块验收覆盖。目标是让后续 Agent、tool、pipeline、Dashboard、config reload、workspace、persona、memory 的修复和新增能力都有可执行的测试入口。

## Required Gate

默认本地质量门禁：

```bash
./gradlew test
```

该命令必须在没有 Telegram、NapCat、OpenAI、Anthropic、Gemini、实时 MCP server、互联网访问、本地 secret 的环境中运行。需要外部服务的测试必须使用显式 opt-in 的命名或条件跳过，不能进入默认 gate。

## Regression Convention

修复 bug 时必须新增或更新一个能在修复前失败、修复后通过的测试。测试位置按生产模块归属放置：

- Agent/ReAct bug：`src/test/kotlin/com/heyanle/priestess/bot/agent/...`
- Tool/ToolExecutor bug：`src/test/kotlin/com/heyanle/priestess/bot/tool/...`
- Pipeline/stage bug：`src/test/kotlin/com/heyanle/priestess/bot/pipeline/...`
- Dashboard API bug：`src/test/kotlin/com/heyanle/priestess/bot/server/...`
- Config reload bug：`src/test/kotlin/com/heyanle/priestess/bot/config/...` 或 `integration/...`
- Workspace bug：`src/test/kotlin/com/heyanle/priestess/bot/workspace/...`
- Persona/memory bug：`src/test/kotlin/com/heyanle/priestess/bot/persona/...` 或 `memory/...`

命名建议：

- 单元回归：`fun \`regression <short bug behavior>\`()`
- 集成回归：`fun \`regression <handoff or lifecycle behavior>\`()`
- 系统回归：`fun \`regression <end to end behavior>\`()`

回归测试必须尽量复用 `src/test/kotlin/com/heyanle/priestess/bot/testkit` 的 fake provider、fake platform、fake tool、config、database、plugin、metrics helper，避免每个测试类复制 stub。

## Current Credential-Free Evidence

当前 testing foundation 已覆盖：

- `ArchitectureRefactorTest`
- `ReActRunnerTest`
- `ToolExecutorTest`
- `PipelineStageBasicsTest`
- `PreProcessStageTest`
- `ProcessStageTest`
- `ResultDecorateStageTest`
- `PipelineOnionFlowTest`
- `MessageFlowSystemTest`
- `ConfigReloadIntegrationTest`
- `PluginContributionIntegrationTest`
- `DashboardRoutesTest`
- `KnowledgeCaseTest`
- `KnowledgeSearchToolTest`
- `WorkspaceControllerTest`
- `WorkspacePipelineReloadTest`
- `RealWorkspaceMcpToolResolverTest`
- `PersonaControllerTest`
- `PersonaMemoryInjectorTest`
- `MemoryControllerTest`
- `MemoryToolsTest`

这些测试全部使用 in-process fake 或本地临时 SQLite，不要求平台账号、provider API key、外部 MCP server 或互联网。

## Architecture Gate

v3 新增代码结构规范也进入默认测试门禁：

- 所有继承 `BaseController` 的生产类必须以 `Controller` 结尾。
- 跨包生产依赖应优先注入 `Case`，Controller 只作为模块内部生命周期/资源管理对象；历史代码会逐步迁移，新增代码必须遵守该方向。

当前自动化覆盖：

- `ArchitectureRefactorTest.BaseController subclasses use Controller suffix`

跨包 Controller 注入规则涉及现有历史依赖，暂先作为文档规范和代码 review gate 推进；后续在逐步迁移完主要模块后再收紧为自动化扫描。

## Module Acceptance Coverage

以下测试原本随对应生产模块延后，现在已在 implementing change 中落地，并进入默认 `./gradlew test` 门禁：

- `v3-workspace-runtime`
  - workspace reload 成功后新消息使用新 snapshot。
  - workspace reload 校验失败后旧 snapshot 继续可用。
  - in-flight message 使用进入 pipeline 时的 snapshot，不受 reload 中途影响。
  - skill/MCP 配置变更可被 reload 发现并清理旧资源。
  - 覆盖入口：`WorkspaceControllerTest`、`WorkspacePipelineReloadTest`、`RealWorkspaceMcpToolResolverTest`。
- `v3-persona-memory-core`
  - persona resolution 和 prompt injection metadata。
  - memory scope 按 workspace/session/user 过滤。
  - memory save/recall/delete/expiration。
  - Agent chat/debug response 能解释注入的 persona 和 memory id。
  - 覆盖入口：`PersonaControllerTest`、`PersonaMemoryInjectorTest`、`MemoryControllerTest`、`MemoryToolsTest`、`PreProcessStageTest`、`DashboardRoutesTest`。

后续 workspace、persona、memory 的新增公开 API 或行为变更仍必须按本文回归约定补充 failing-before-fix 测试，不能只更新任务状态。
