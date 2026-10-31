# core-tools — 核心 Tool 对齐与补齐

v3 的核心 tool 目标是：无插件情况下，Agent 也具备主流聊天 Agent 的基本行动能力。插件负责长尾业务，核心工具负责看见、查证、记住、提醒、回复和自检。

## 当前现状

已实现内建工具：

- `SystemInfoTool`
- `EarlyReplyTool`
- `SendMessageTool`
- `WebSearchTool`
- `KnowledgeSearchTool`
- `ListToolsTool`
- `HealthCheckTool`
- `FetchUrlTool`
- `ConversationSearchTool`
- `MemorySaveTool`
- `MemoryRecallTool`
- `MemoryDeleteTool`
- `CreateReminderTool`
- `ListRemindersTool`
- `DeleteReminderTool`

已实现基础设施：

- `FunctionTool`
- `ToolSchema` permission metadata
- `ToolSet`
- `ToolController`
- `ToolExecutor`
- `ToolPolicy`
- `AgentToolContext`
- agent 级 `toolTimeoutMs`
- MCP transport/client/tool wrapper

当前边界：

- 高风险工具默认不启用，需要 workspace/agent policy 显式允许。
- `fetch_url` 只允许 public HTTP(S)，会阻断 localhost/private/link-local/multicast 与 private redirect。
- reminder 当前是一次性提醒；周期提醒与 Dashboard reminder 管理属于后续扩展。
- 持久审计日志与更细的 UI policy 配置仍可继续增强。

## 验证状态

- OpenSpec `v3-core-tools` 已完成 54/54 个任务，并通过 `openspec validate v3-core-tools --strict`。
- 默认后端门禁 `./gradlew test` 已覆盖 tool schema、policy、executor、built-in tools、Dashboard tool metadata 和 workspace tool scope。
- Dashboard frontend 已通过 build/test 门禁验证 ToolView 元数据、筛选和状态展示契约。

## 核心 Tool 分层

### Level 0 默认安全工具

默认可启用，失败影响小：

- `system_info`
- `list_tools`
- `health_check`
- `knowledge_search`
- `conversation_search`
- `memory_recall`

### Level 1 会话动作工具

需要当前 platform/session：

- `send_message`
- `early_reply`
- `reply_message`
- `send_image`
- `send_file`

### Level 2 外部信息工具

需要网络或外部服务配置：

- `web_search`
- `fetch_url`
- `summarize_url`

### Level 3 状态变更工具

需要权限与审计：

- `memory_save`
- `memory_delete`
- `create_reminder`
- `list_reminders`
- `delete_reminder`

### Level 4 高风险工具

不作为 v3 默认开启：

- shell/code execution。
- 任意文件写入。
- 浏览器自动化。
- 群管理动作。
- 任意 HTTP request。

## 权限模型

新增 `ToolPermission`：

```kotlin
enum class ToolRiskLevel {
    SAFE_READ,
    SESSION_ACTION,
    EXTERNAL_READ,
    STATE_WRITE,
    HIGH_RISK,
}
```

每个 tool schema 增加：

- `riskLevel`
- `requiredCapabilities`
- `defaultEnabled`
- `auditLog`

执行前由 `ToolPolicy` 判断：

- workspace 是否启用该 tool。
- 当前 agent 是否允许该 risk level。
- 当前 session/platform 是否允许状态变更。
- 是否需要用户确认。

## v3 必做工具

### list_tools

返回当前 workspace/agent 可用 tool 列表、风险等级、是否启用。

验收：

- 可列出内建和插件注册工具。
- 可过滤 disabled/high-risk 工具。

### health_check

返回 runtime 健康摘要：database、providers、platforms、plugins、workspace reload 状态。

验收：

- 不暴露 API key、prompt、消息正文。
- 与 `/health` 数据口径一致。

### fetch_url

抓取网页正文并返回简化文本。

验收：

- 支持超时和最大字数。
- 支持拒绝内网地址和本机地址。
- 失败返回结构化错误。

### conversation_search

按会话、时间、关键词检索历史消息。

验收：

- 支持 current session 默认范围。
- 支持 limit。
- 不跨 workspace 泄露。

### memory_save / memory_recall / memory_delete

对接 v3 persona-memory 模块。

验收：

- 支持 memory type、scope、ttl。
- recall 支持 query + limit。
- delete 需要明确 memory id。

### reminder tools

基础提醒/待办：

- `create_reminder`
- `list_reminders`
- `delete_reminder`

验收：

- 支持绝对时间和相对时间解析。
- reminder 与 workspace/session/user 绑定。
- 到期后通过 platform 发送提醒。

## 可执行任务

- [x] 为 `ToolSchema` 增加权限/风险元数据。
- [x] 新增 `ToolPolicy` 和执行前校验。
- [x] 将 `Agent.toolTimeoutMs` 接入 `ToolExecutor`。
- [x] 实现 `ListToolsTool`。
- [x] 实现 `HealthCheckTool`。
- [x] 实现 `FetchUrlTool`。
- [x] 实现 `ConversationSearchTool`。
- [x] 实现 memory 三件套工具。
- [x] 实现 reminder 三件套工具。
- [x] 为所有内建工具补齐单元测试。
- [x] Dashboard ToolView 展示权限、风险、启用状态。
