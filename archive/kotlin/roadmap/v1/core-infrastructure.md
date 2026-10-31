# core-infrastructure — 基础设施

提供 PriestessBot 运行所需的底层能力。

## 核心生命周期

`CoreLifecycle` 统一编排所有子模块的启动和停止，确保依赖顺序正确（数据库 → 事件总线 → 平台 → 管道调度 → 服务器）。

## 配置系统

`PriestessConfig` 为主配置类，使用 `@Serializable` data class 实现编译期类型安全。子配置包括：
- `PlatformConfig`：IM 平台配置模板
- `ProviderConfig`：LLM Provider 配置模板
- `AgentConfig`：Agent 运行参数（最大步数、温度等）

所有配置支持 JSON 文件持久化，可通过 Dashboard API 读写。

## 依赖注入

使用 Koin 4.x 的 `CoreModule` 注册所有组件，包括平台管理器、Provider 管理器、管道调度器、Agent Runner、工具注册表等。

## 事件总线

基于 Kotlin Channel 实现事件总线 `EventBus`，支持消息事件、系统事件、控制事件。IM 平台通过 `commitEvent()` 推送消息事件，管道调度器消费消息事件触发处理。

## 数据库

使用 Exposed ORM + SQLite，提供配置持久化和会话存储。`Database` 接口抽象数据库操作，`PriestessDb` 为内置实现。
