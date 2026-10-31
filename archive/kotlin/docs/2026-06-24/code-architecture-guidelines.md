# Code Architecture Guidelines

整理时间：2026-06-24

本文记录 v3 起新增的代码结构规范。目标是让模块边界更稳定，避免 Controller 被跨包随意注入后形成隐式耦合。

## 1. Controller 命名规范

所有继承 `BaseController` 的生产类必须以 `Controller` 结尾。

原因：

- `BaseController` 表示长期运行、持有资源或后台任务的模块控制器。
- 统一后缀能让生命周期对象在 DI、shutdown、测试和文档中一眼可见。
- 避免 `Manager`、`Service`、`Runtime` 等名称混用，导致职责不清。

示例：

| 合规 | 不合规 |
| --- | --- |
| `PluginController : BaseController(...)` | `PluginManager : BaseController(...)` |
| `WorkspaceController : BaseController(...)` | `WorkspaceRuntime : BaseController(...)` |

质量门禁：

- `ArchitectureRefactorTest.BaseController subclasses use Controller suffix` 会扫描 `src/main/kotlin`，发现违规类名时失败。

## 2. 包间依赖规范

模块间依赖尽量只注入 `Case`，不要跨包直接注入 `Controller` 或模块内部类。

允许：

- 同包内：`Case` 可以持有本模块的 `Controller`，并把稳定能力暴露成方法。
- 同包内：`Controller` 可以持有本模块内部 helper、model、repository。
- Controller 业务太复杂时，可以拆出模块内工具类/helper/repository/renderer；这些工具类命名没有强制后缀要求。
- `Case` 可以暴露稳定的 `getXX` 方法返回模块工具类或能力对象，供其他包使用。
- DI 装配层：`CoreModule` 可以创建 Controller 和 Case，并在极少数启动/关闭边界持有 Controller。
- 测试：可以直接构造 Controller 做模块内单元测试。

不鼓励：

- A 包的生产类直接注入 B 包的 `BController`。
- A 包的生产类直接调用 B 包内部 helper，绕过 B 包的 `Case`。
- Dashboard/API/service 层直接暴露 Controller 细节，而不是依赖 Case 门面。
- 其他包直接注入某模块拆出的工具类；如果确实需要，应由该模块的 `Case.getXX()` 暴露。

推荐模式：

```kotlin
class PluginCase(
    private val controller: PluginController,
) {
    fun list(): List<PluginDescriptor> = controller.list()

    suspend fun stop() {
        controller.stop()
    }
}

class PriestessRuntime(
    pluginCase: PluginCase,
) {
    // Runtime only needs the module capability, not the plugin controller internals.
}
```

## 3. Case 暴露规则

Case 应该暴露跨模块需要的稳定能力。命名可以按业务能力设计，而不是机械转发所有 Controller 方法。

建议：

- 查询能力：`list`, `get`, `resolve`, `search`。
- 生命周期能力：`reload`, `stop`, `enable`, `disable`。
- 执行动作：`save`, `delete`, `execute`, `handleIncomingMessage`。
- 调试/状态：`status`, `diagnostics`, `extensions`。
- 工具能力：`getRetriever`, `getRenderer`, `getResolver`, `getExecutor`。

不建议：

- 暴露 Controller 的可变集合或内部 map。
- 让调用方知道 Controller 的同步锁、scope、task 等细节。
- 为了绕过边界在 Case 里返回 Controller 实例。

工具类示例：

```kotlin
class PersonaCase(
    private val controller: PersonaController,
    private val renderer: PersonaPromptRenderer,
) {
    fun resolve(workspaceId: String, agentName: String): Persona? = controller.resolve(workspaceId, agentName)

    fun getRenderer(): PersonaPromptRenderer = renderer
}
```

这里 `PersonaPromptRenderer` 不需要以 `Controller` 结尾；但跨包使用时应通过 `PersonaCase.getRenderer()` 获得，避免直接注入 renderer 造成隐式耦合。

## 4. 当前执行状态

已落实：

- `PluginManager` 已改名为 `PluginController`。
- `PluginCase` 已作为插件模块门面暴露 `stop()`。
- `PriestessRuntime` 已改为通过 `PluginCase` 停止插件模块。
- 新增架构测试约束所有 `BaseController` 子类必须以 `Controller` 结尾。

待推进：

- 逐步减少 `PipelineController`、`WorkspaceController`、`RuntimeHealthProvider`、`DashboardService` 等跨包直接依赖 Controller 的位置。
- 对确实需要 Controller 生命周期控制的启动/关闭边界，保留在 DI/runtime 层，并在文档中注明原因。
- 后续新增模块必须先设计 Case 门面，再让其他包依赖该 Case。
