# 代码仓库导览

日期：2026-06-26

这份文档直接展开 `src/main/kotlin/com/heyanle/priestess/bot` 的目录树，帮助第一次进仓库的人快速形成空间感。

## 顶层模块

```text
com.heyanle.priestess.bot
├── agent
├── config
├── conversation
├── core
├── knowledge
├── memory
├── observability
├── persona
├── pipeline
├── platform
├── plugin
├── provider
├── reminder
├── server
├── skill
├── tool
└── workspace
```

## 目录职责

| 目录 | 作用 |
| --- | --- |
| `agent` | Agent、上下文压缩、ReAct 执行和子 Agent 编排 |
| `config` | 全局配置、热更新和配置流 |
| `conversation` | 会话实体和消息历史 |
| `core` | 基础控制器、数据库和 DI |
| `knowledge` | 知识库和检索 |
| `memory` | 记忆存取和过期管理 |
| `observability` | 指标和运行时观测 |
| `persona` | Persona 管理和注入 |
| `pipeline` | 消息处理阶段链 |
| `platform` | 平台适配和消息入口 |
| `plugin` | 插件生命周期和扩展 |
| `provider` | LLM provider 接入 |
| `reminder` | 提醒和投递 |
| `server` | Dashboard API 和运行时服务 |
| `skill` | Skill 注册、派发和 prompt 文档 |
| `tool` | 工具、MCP 和执行器 |
| `workspace` | 工作区配置、快照和作用域 |

## 子目录热点

### `platform`

- `adapters/telegram`
- `adapters/napcat4_18_6`

这些目录负责把外部平台的原始事件变成统一消息模型。

### `tool`

- `annotation`
- `builtin`
- `mcp`

这些目录分别负责工具声明、内建工具和 MCP 接入。

### `agent`

- `context`
- `orchestration`
- `runner`

这些目录负责上下文压缩、子 Agent 协作和 ReAct 执行。

## 代码阅读顺序

1. `core`
2. `config`
3. `platform`
4. `pipeline`
5. `agent`
6. `provider`
7. `tool`
8. `workspace`

## 适合新人的看法

- 先看目录名，再看 `Case`。
- 再看每个模块页的结构图。
- 最后回到 `message-flow.md` 和 `llm-flow.md` 把目录放回主链路里。

