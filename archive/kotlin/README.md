# 已归档：PriestessBot Kotlin

当前 TypeScript 项目见 [根目录 README](../../README.md)。以下是旧版本历史说明，不作为当前服务操作指南。

# 普瑞赛斯 Bot

> 新版 TypeScript / OpenAI Agents SDK 运行时已加入 `typescript/`，保留独立 Agent 与暖金 Dashboard，并提供 Telegram、NapCat、微信 iLink 适配。启动、迁移、权限与验证边界见 [TypeScript 运行指南](./typescript/README.md)。下方保留 Kotlin 版本说明作为迁移参考。

<div align="center">

<img src="./image/icon.jpg" alt="PriestessBot" width="128" height="128">

**PriestessBot** — 基于 Kotlin 的 LLM Agent 聊天机器人框架

[简体中文](./README.md)

<br>

<img src="https://img.shields.io/badge/kotlin-2.3+-blue.svg" alt="kotlin">
<img src="https://img.shields.io/badge/jdk-21-red.svg" alt="jdk">

</div>

---

普瑞赛斯 Bot（PriestessBot）是一个开源的、基于 Kotlin 的 LLM Agent 聊天机器人框架。它提供类型安全、可扩展的对话 AI 基础设施，支持接入主流 IM 平台和 LLM 服务，帮助开发者快速构建生产级的 AI 应用。

## 特性

- **多平台接入** — 抽象 IM 平台接口，支持 Telegram、NapCat（QQ）和个人微信 iLink，可扩展更多平台
- **IM 路由** — 每个 IM 实体按顺序匹配路由，命中后交给独立 Agent 或内置指令
- **Agent 循环** — 内置 ReAct Runner，Thought → Action → Observation 推理循环
- **LLM Provider 抽象** — 统一接口接入 OpenAI、Ollama 等 LLM 服务
- **Tool / MCP 体系** — 内置工具 + MCP 协议支持（stdio / SSE / streamable HTTP）
- **类型安全** — 全链路 `@Serializable` data class，编译期类型检查
- **协程原生** — 基于 Kotlin Coroutines + Flow 的结构化并发

## 快速开始

需要 JDK 21。首次安装且尚无配置文件时，先将 `config.example.json` 复制为 `config.json`。执行 `./gradlew installDist -PbuildDashboard=true` 构建包含 Dashboard 的发行包，再运行 `./run-server.sh`。

配置采用 v3：系统运行参数、IM、LLM 连接、Agent 和资源目录在 `config.json` 中声明；凭据通过环境变量引用。平台人格和记忆数据保存在平台目录下的 `resources.sqlite`，执行链与会话记录保存在系统数据库中。

详见 [Agent、IM 与资源配置](./docs/configuration-v3.md)。v2 开发配置首次启动会直接迁移，不生成备份；旧 Workspace 配置文件会被移除。

## 路线图

Rust 重构位于 [`rust/`](./rust/README.md)：包含四个 crate、Codex/code mode、无 UI 路由图、SQLite 配置与会话持久化、旧配置迁移和会话控制指令。当前提供 CLI、本地事件流与 Telegram/NapCat 网关，已实测私聊指令和 Agent/code mode 回复，现支持图片与文本/PDF 输入、Telegram MarkdownV2 草稿/编辑和 NapCat 可读文本分段回复（可选文转图）；管理 UI 按 OpenSpec 分阶段实现。

详见 [Roadmap](./roadmap/index.md)

- **[v1](./roadmap/v1/v1.md)** — 核心闭环：IM 平台 + 管道 + ReAct Agent + Tool/MCP
- **[v2](./roadmap/v2/v2.md)** — 可扩展：插件系统 + 更多平台/Provider + Dashboard + RAG

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | Kotlin 2.3+ / JDK 21 |
| 构建 | Gradle Kotlin DSL |
| DI | Koin 4.x |
| 序列化 | kotlinx.serialization |
| 数据库 | Exposed ORM + SQLite |
| HTTP | Ktor Client / Ktor Server（二期） |
| 协程 | kotlinx.coroutines + Flow |

## 参考

本项目架构设计参考 [AstrBot](https://github.com/AstrBotDevs/AstrBot)，以 Kotlin 重新实现并优化类型安全、并发模型和可扩展性。

个人微信 iLink 平台支持从 Dashboard 扫码登录；配置、能力边界和运行说明见 [微信 iLink Platform](./docs/2026-07-22/weixin-platform.md)。

## License

MIT
