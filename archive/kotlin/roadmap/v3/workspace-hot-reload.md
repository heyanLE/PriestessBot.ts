# workspace-hot-reload — 工作区与配置热重载

v3 新增 workspace 作为运行时配置作用域。workspace 不是简单目录，而是一组可热更新的 Agent 运行配置快照，包括 skill、MCP、tool、persona、memory、agent、provider 选择等。

## 当前现状

已有能力：

- 全局 `PriestessConfig`。
- Config reload、备份、恢复。
- Provider/Pipeline 部分热刷新。
- 插件可注册 tool/provider/platform。
- MCP client 和 transport 基础设施。
- SkillController/SkillCase 基础设施。
- Workspace 运行时模型、配置源、校验、reload/reloadAll、回滚、diff plan、pipeline pinned snapshot。
- Workspace snapshot 已解析 scoped agent、provider、tool、skill 名称、skill settings、redacted MCP server summary、真实 MCP tools、persona、memory policy。
- Workspace MCP resolver 已接入真实 MCP client/tool adapter，snapshot 会持有 closeable handles，并在 reload/close 时按 lease/refcount 延迟释放旧资源。
- `SkillCase` 已提供 workspace-scoped skill documents，可按 pinned snapshot 限定可见 skill 并读取 scoped skill settings。
- Agent system prompt 已按 AstrBot 风格拆为 `Platform`、`Role Document`、`Tools`、`Loaded Skills` 分块；`use_skill`/`unload_skill` 工具可在单次 Pipeline 运行内装载或卸载 skill 文档，后续 LLM 轮次会看到已装载的 `SKILL.md` 内容。
- Workspace 默认工具集尊重 `ToolSchema.defaultEnabled`；当 workspace 有可见 skill 时，已注册的 skill 控制工具会自动保留，避免 allowlist 切断装载链路。
- Persona 注入已按 pinned snapshot 的 `personas` 选择生效；workspace memory disabled 只关闭记忆检索，不再关闭 persona 注入。
- Dashboard 已提供 workspace 列表、详情、reload、scoped resources API 和 Workspaces 页面。

缺口：

- MCP reload 已支持候选 client 初始化、失败保留旧 client、失败候选 handle 关闭、旧 snapshot client 按 pinned lease 延迟释放；仍需真实外部 MCP server 的系统级验收覆盖。
- Workspace reload 已有 MCP candidate resolver seam：可在发布前解析 MCP runtime tools，失败时保留旧 snapshot 并关闭失败候选 handle；pinned snapshot 的 executable runtime tool view 已接入 agent 展示与执行链路，真实 `McpClient`/`McpTool` resolver 已接入主运行时。
- Skill 不再做前置自动匹配；workspace snapshot 只决定当前 Pipeline 可见的 skill 列表，是否装载由 LLM 调用 `use_skill` 决定。
- Agent/sub-agent/provider/persona/memory 已有 pinned snapshot 回归覆盖；sub-agent route、provider choice、`maxSteps` execution limit 已有确定性回归测试。
- Workspaces 页面已有无依赖 smoke test 覆盖加载、详情、reload、失败摘要、active snapshot 和 scoped resource 关键契约；当前 dashboard 尚未引入组件级前端测试依赖。

## Workspace 模型

建议新增：

```kotlin
data class WorkspaceConfig(
    val id: String,
    val name: String,
    val enabled: Boolean = true,
    val agents: List<AgentConfig> = emptyList(),
    val skills: List<SkillConfig> = emptyList(),
    val mcpServers: List<McpServerConfig> = emptyList(),
    val tools: ToolPolicyConfig = ToolPolicyConfig(),
    val personas: List<PersonaConfig> = emptyList(),
    val memory: MemoryConfig = MemoryConfig(),
)
```

运行时维护不可变快照：

```kotlin
data class WorkspaceSnapshot(
    val config: WorkspaceConfig,
    val tools: ToolSet,
    val skills: List<Skill>,
    val mcpTools: List<FunctionTool>,
    val personas: List<Persona>,
    val memoryPolicy: MemoryPolicy,
    val loadedAt: Long,
)
```

## 关键模块

### WorkspaceController

职责：

- 加载 workspace 配置。
- 校验 workspace 配置。
- 构建 `WorkspaceSnapshot`。
- 原子替换 snapshot。
- 记录 reload 结果。
- 按 session/platform/metadata 解析当前 workspace。

接口：

- `list(): List<WorkspaceStatus>`
- `get(id): WorkspaceSnapshot?`
- `resolve(context): WorkspaceSnapshot`
- `reload(id): WorkspaceReloadResult`
- `reloadAll(): List<WorkspaceReloadResult>`

### WorkspaceConfigSource

职责：

- 从主配置、目录文件或远端源读取 workspace 配置。
- 支持显式 reload。
- 可选支持 file watcher。

### WorkspaceReloadPlan

职责：

- 对比 old/new snapshot。
- 生成变更摘要。
- 标记新增/删除/修改的 skill、MCP、tool、persona、memory policy。

## 热重载规则

必须满足：

- reload 先构建新 snapshot，成功后再原子替换。
- reload 失败保留旧 snapshot。
- 正在执行的消息使用进入 pipeline 时解析到的 snapshot，不被中途替换影响。
- MCP server 变更需要关闭旧连接、建立新连接；失败时保留旧连接。
- Tool 权限变更对新消息立即生效。
- Persona/memory policy 变更对新消息立即生效。

## Dashboard API

新增建议路由：

- `GET /api/workspaces`
- `GET /api/workspaces/{id}`
- `POST /api/workspaces/{id}/reload`
- `POST /api/workspaces/reload`
- `GET /api/workspaces/{id}/tools`
- `GET /api/workspaces/{id}/mcp`
- `GET /api/workspaces/{id}/skills`
- `GET /api/workspaces/{id}/personas`
- `GET /api/workspaces/{id}/memory`

## Dashboard 页面

新增 `WorkspaceView`：

- workspace 列表和启用状态。
- reload 按钮和最近 reload 结果。
- skill/MCP/tool/persona/memory 配置摘要。
- 错误详情。
- 当前活跃 snapshot 版本。

## 可执行任务

- [x] 新增 `WorkspaceConfig`、`WorkspaceSnapshot`、`WorkspaceStatus`。
- [x] 新增 `WorkspaceController`。
- [x] 将 `PipelineContext` 增加 workspace snapshot 引用。
- [x] 将 `PreProcessStage` 接入 workspace resolve。
- [x] 将 `ToolController` 或 `ToolSet` 支持 workspace scoped tool view。
- [x] 将 MCP server 配置纳入 workspace reload client 生命周期。
- [x] 将 workspace scoped skills 接入 agent 运行时可见范围。
- [x] 将 workspace scoped skills 接入 agent prompt 构建上下文。
- [x] 新增 `use_skill`/`unload_skill` 工具，支持每个 Pipeline 运行内动态装载/卸载 skill。
- [x] 新增 Dashboard workspace API。
- [x] 新增 Dashboard `WorkspaceView`。
- [x] 补齐 reload 成功、失败、回滚、并发消息测试。
