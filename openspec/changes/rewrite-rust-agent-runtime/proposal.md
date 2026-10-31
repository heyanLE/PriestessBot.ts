## Why

当前 Kotlin 运行时已有独立 Agent、IM、共享资源和管理界面，但 Codex 通过 JNI 接入，code mode、多模态、主动委派等能力尚未贯通。重构为 Rust，以 AstrBotX 的实际行为为参考，直接集成 Codex Rust Engine，并建立运行态和可视化路由的统一契约。

## What Changes

- **BREAKING**：服务端迁移至 Rust；保留 Agent 的独立身份、人格、模型连接、资源装配和会话归属，重新实现运行时。
- Codex 与 code mode 为首个交付引擎；保留引擎抽象，普通 ReAct、DeepSeek Harness 的兼容计划单独列出，禁止静默改换旧 Agent 引擎。
- 参考 AstrBotX 实现会话串行、同调用者追加、跨会话并发、执行环境、图片与附件输入、流式回复、长期记忆、知识库和主动子 Agent 委派。音频与语音不在本期范围。
- **BREAKING**：引入普通干员态、资深干员态、高级资深干员态，由路由运行态节点选择，统一约束命令、图节点、工具、MCP、记忆与子任务。身份只作为路由条件，不自动决定运行态。
- 指令抽象为名称、参数定义、执行和回复；本期只做 Rust 代码注册与抽象。
- **BREAKING**：顺序路由升级为节点图，支持编辑、校验、模拟、发布、执行追踪；正常对话路径最终调用一个具体 Agent。
- IM 适配参考 AstrBotX；先迁移现有 Telegram、NapCat、微信 iLink，其他平台逐批扩展；适配器只承担协议与能力转换。

## Capabilities

### New Capabilities
- `rust-agent-runtime`: Rust 边界、独立 Agent、配置代际与迁移交付。
- `codex-code-runtime`: Rust Engine、code mode、会话并发、动态上下文、多模态流式。
- `operator-runtime-state`: 三种运行态及权限传播与收窄。
- `command-definition`: 指令名称、类型化参数、执行、结构化回复。
- `visual-route-graph`: 节点图、类型端口、执行预算、版本发布与测试。
- `agent-execution-services`: 执行环境、记忆、知识库、主动委派与能力隔离。

### Modified Capabilities
- `agent-im-runtime`: 路由激活改为版本化图，继续保留独立 Agent 与调用者身份。
- `command-permission-controls`: 权限组改为运行态，命令由图显式分派。
- `platform-abstraction`: Rust trait、能力注册与统一多模态消息契约。

## Impact

影响服务端、配置格式、数据库迁移、镜像、工具权限、IM 接入和 Dashboard 路由编辑器。Vue Dashboard 可复用，Rust 化范围默认指服务端；Python/JVM 插件二进制不兼容。旧工作区和数据作为迁移来源，新版本使用独立数据目录；现有 OpenSpec 的 Kotlin 专属实现细节在切换前仍仅约束旧运行时。

本提案是整体重构的执行蓝图，不表示所有能力已实现。用户已确认可视化路由只参考节点编程的交互感觉，无具体 agentflow 产品；运行态由路由节点选择。
