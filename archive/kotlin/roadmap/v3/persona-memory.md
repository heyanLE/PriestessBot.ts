# persona-memory — 人格与记忆管理

v3 将人格和记忆从隐含 prompt 文本提升为独立模块。目标是让 Agent 的「怎么说话」和「记住什么」可配置、可检索、可解释、可删除。

## 当前现状

已有基础：

- `Agent.instructions` 可承载系统提示词。
- Conversation history 可作为短期上下文。
- Knowledge RAG 可检索外部知识。
- Tool 系统可接入 memory save/recall。

当前已推进：

- 已新增 Persona 模型、`PersonaController`、`PersonaCase` 和 `personas` 表。
- 已新增 Memory 模型、`MemoryController`、`MemoryCase` 和 `memory_records` 表。
- 已实现 memory scope、TTL 过期、软删除、keyword/tag 检索和 match reason。
- 已接入 memory 三件套工具：`memory_save`、`memory_recall`、`memory_delete`。
- 已新增 `PersonaMemoryInjector`，在 Agent 执行前把 resolved persona 与相关 memory 渲染到 system instructions。
- 已将注入 trace 写入 `AgentContext.metadata`，包含 persona id/name、memory ids、scores、match reasons 和注入数量。
- 已接入 `PreProcessStage`，workspace memory policy 的 `maxInjectedMemories` 会限制本轮注入数量。
- 已补 persona controller 单测，覆盖 normalize、workspace 隔离、agent 专属优先级、disabled/deleted 不参与 resolve。
- 已补 memory controller/tools 测试，覆盖 scope、TTL、exact-id delete、检索排序和权限。
- 已补 injector 与 PreProcessStage 测试，覆盖 prompt 内容和 trace metadata。
- 已新增 Dashboard Persona/Memory API，覆盖 persona CRUD/resolve、memory list/save/search/delete/expire。
- 已新增 Dashboard `Persona & Memory` 工作台页面，支持 persona 管理和 memory 管理/检索。
- 已在 Dashboard Agent chat test response 中返回 `injectionTrace`，并在 Agent 测试页面展示 persona、memory id、score 和 match reason。

当前边界：

- Dashboard 侧已有无依赖 smoke test 覆盖 persona/memory API client、页面动作和 Agent chat injection trace 展示契约；当前尚未引入组件级前端测试框架。
- memory 检索仍是确定性 keyword/tag/recency/confidence 排序；embedding/vector store 属于后续演进。
- 自动记忆抽取策略尚未作为独立后台能力实现，目前由显式工具与 prompt injection 链路管理。

## Persona 模型

建议新增：

```kotlin
data class Persona(
    val id: String,
    val name: String,
    val description: String,
    val tone: String = "",
    val boundaries: List<String> = emptyList(),
    val systemPromptTemplate: String,
    val enabled: Boolean = true,
    val workspaceId: String,
    val agentNames: List<String> = emptyList(),
)
```

职责：

- 定义 Agent 的表达风格、边界、身份说明。
- 可按 workspace/agent 选择。
- 渲染后注入 system prompt。

## Memory 模型

记忆类型：

- `FACT`：用户或环境事实。
- `PREFERENCE`：偏好。
- `EVENT`：一次互动或重要事件。
- `SUMMARY`：会话摘要。

建议新增：

```kotlin
data class MemoryRecord(
    val id: String,
    val workspaceId: String,
    val scope: MemoryScope,
    val type: MemoryType,
    val content: String,
    val tags: List<String> = emptyList(),
    val confidence: Double = 1.0,
    val createdAt: Long,
    val updatedAt: Long,
    val expiresAt: Long? = null,
)
```

`MemoryScope`：

- global workspace。
- platform。
- session。
- user。
- agent。

## 关键模块

### PersonaController

接口：

- `list(workspaceId): List<Persona>`
- `get(id): Persona?`
- `upsert(persona): Persona`
- `delete(id)`
- `resolve(workspaceId, agentName): Persona?`

### MemoryController

接口：

- `save(record): MemoryRecord`
- `list(filter): List<MemoryRecord>`
- `search(query, scope, limit): List<MemorySearchResult>`
- `delete(id)`
- `expire(now)`

### MemoryRetriever

职责：

- 基于 query、workspace、session、user、agent 检索相关记忆。
- v3 初期可以 keyword 检索。
- 后续可接 embedding/vector store。

### PersonaMemoryInjector

职责：

- 在 Agent 执行前生成注入内容。
- 输出可解释元数据：
  - 使用了哪个 persona。
  - 注入了哪些 memory id。
  - 为什么匹配。

## Agent 集成

建议流程：

1. `PreProcessStage` 解析 workspace。
2. `PersonaMemoryInjector` 根据 workspace、agent、session、user、message 查询 persona/memory。
3. 生成 system prompt 附加段落。
4. `AgentContext.metadata` 记录 injected persona/memory。
5. `ReActRunner` 初始化 system message 时使用增强 instructions。

## Tool 集成

新增：

- `memory_save`
- `memory_recall`
- `memory_delete`

规则：

- `memory_save` 属于 `STATE_WRITE`，默认需要启用。
- `memory_delete` 必须按 id 删除，不支持模糊删除。
- `memory_recall` 默认只读，可默认开启。

## Dashboard API

新增建议路由：

- `GET /api/personas`
- `POST /api/personas`
- `PUT /api/personas/{id}`
- `DELETE /api/personas/{id}`
- `GET /api/memory`
- `POST /api/memory`
- `POST /api/memory/search`
- `DELETE /api/memory/{id}`
- `POST /api/memory/expire`

## Dashboard 页面

新增或扩展：

- `PersonaView`
- `MemoryView`
- Agent chat test 展示本轮注入 persona/memory。

## 可执行任务

- [x] 新增 Persona 数据模型和 controller。
- [x] 新增 Memory 数据模型和 controller。
- [x] 增加数据库表。
- [x] 实现 keyword memory retriever。
- [x] 实现 persona/memory prompt injector。
- [x] 将 injector 接入 `PreProcessStage` 或 AgentContext 创建流程。
- [x] 实现 memory tools。
- [x] 新增 Dashboard persona/memory API。
- [x] 新增 Dashboard persona/memory 页面。
- [x] Agent chat test 展示本轮注入 persona/memory。
- [x] 补齐 scope、ttl、删除、注入可解释性测试。
