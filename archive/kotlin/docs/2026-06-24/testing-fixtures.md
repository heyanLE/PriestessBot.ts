# Testing Fixture Ownership

梳理时间：2026-06-24

共享测试 fixture 统一归属在 `src/test/kotlin/com/heyanle/priestess/bot/testkit`。新增 Agent、tool、pipeline、Dashboard、workspace、persona、memory 测试时，应优先复用这里的 fake 和 helper，只有出现明确的新跨模块场景时才扩展 testkit。

## 已有 Fixture

- `FakeProvider`：脚本化 LLM final、tool call、多轮响应和 provider exception。
- `FakePlatform`：构造 inbound message event，捕获 outbound `sendMessage`。
- `FakeTool`：脚本化成功、失败、异常和延迟执行结果。
- `TestAgents`：创建通用 `Agent` 与 `AgentContext`。
- `TestEvents`：创建 `PipelineContext` 与常见平台消息。
- `TestDatabase`：创建临时 SQLite 和 shared in-memory conversation store。
- `TestDatabase.testKnowledgeCase`：创建无凭据本地知识库用例，覆盖 `KnowledgeCase`/`KnowledgeController` 集成路径。
- `TestConfig`：创建临时 `ConfigController`、`ConfigCase`、workspace snapshot。
- `TestPlugins`：构建本地 demo plugin jar，用于验证插件 tool/provider/platform 贡献和清理。
- `TestAssertions`：固定测试时钟和 metrics 断言。

## 使用规则

- 单元测试不要在本地测试类里重复实现 provider/platform/tool stub。
- 系统测试需要无凭据运行，默认使用 `FakePlatform`、`FakeProvider`、`FakeTool` 和 `testInMemoryConversationCase()`。
- 指标断言使用 `MetricsRegistry.assertSample(...)` 与 `assertDoesNotLeak(...)`，避免复制 Prometheus 字符串检查。
- workspace/persona/memory 集成测试优先使用真实 controller/case/runtime snapshot 路径；只有纯边界单元测试才使用 `TestWorkspaceSnapshot` 表达快照约束。
- fixture 扩展应保持小而确定，不访问 Telegram、NapCat、OpenAI、Anthropic、Gemini、实时 MCP server、互联网或本地 secret。
