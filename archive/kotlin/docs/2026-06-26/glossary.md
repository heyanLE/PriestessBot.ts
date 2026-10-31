# 术语速查

日期：2026-06-26

这份文档把文档里经常出现的词和代码位置对齐，方便初次接触仓库的开发者快速消除陌生感。

## 核心术语

| 术语 | 含义 | 主要代码位置 |
| --- | --- | --- |
| `Case` | 对外稳定门面，跨模块优先通过它访问能力 | `*/ *Case.kt` |
| `Controller` | 模块内部的实际持有者或执行者 | `*/ *Controller.kt` |
| `Pipeline` | 消息处理阶段链 | `pipeline/PipelineController.kt` |
| `Agent` | LLM 推理执行单元 | `agent/Agent.kt`、`agent/runner/ReActRunner.kt` |
| `Provider` | LLM 服务接入实现 | `provider/*` |
| `Tool` | 可被 LLM 调用的函数能力 | `tool/*` |
| `Skill` | 轻量消息处理/提示文档能力 | `skill/*` |
| `Workspace` | 资源和能力作用域 | `workspace/*` |
| `Conversation` | 会话和消息历史 | `conversation/*` |
| `Persona` | 角色设定和注入信息 | `persona/*` |
| `Memory` | 长短期记忆 | `memory/*` |
| `Reminder` | 定时提醒 | `reminder/*` |
| `Knowledge` | 知识库与检索 | `knowledge/*` |
| `Plugin` | 插件生命周期和扩展 | `plugin/*` |
| `MCP` | 外部工具协议接入 | `tool/mcp/*`、`workspace/*` |

## 常见概念对照

- `AgentCase.createAgent(...)`：把配置变成可执行 Agent。
- `PlatformCase.handleIncomingMessage(...)`：平台消息进入系统的入口。
- `PipelineCase.process(...)`：消息进入阶段链。
- `ToolExecutor.execute(...)`：执行 LLM 发起的工具调用。
- `SkillCase.getWorkspaceSkillState(...)`：按 workspace 生成 skill 作用域。
- `WorkspaceController.resolve(...)`：解析当前消息适用的 workspace。

## 建议读法

先把这份表和 [navigation-map.md](./navigation-map.md) 对着看，再去具体模块页，就不会在类名和职责之间打结。

