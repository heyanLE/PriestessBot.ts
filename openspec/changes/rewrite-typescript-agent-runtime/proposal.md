## Why

将 PriestessBot 的下一代运行时统一为强类型 TypeScript，保留独立 Agent 的产品概念，并参考 AstrBotX 补齐执行和消息能力。首期使用官方 OpenAI Agents SDK（`@openai/agents`），通过独立引擎接口保留未来接入 Codex SDK 的可能，使运行态权限、可编辑路由节点和现有 Dashboard 视觉在同一套可验证契约下工作。

## What Changes

- **BREAKING**：目标服务端改为 TypeScript；复用 Vue Dashboard，保留 Agent 身份、模型/引擎选择、人格、资源装配、目录和会话归属。
- 首个引擎使用官方 `@openai/agents`。项目 AgentDefinition 保持独立，SDK Agent 只作为适配器内部执行对象；领域层、配置、路由和 Dashboard 不依赖 SDK 类型。Codex SDK 留作未来可选引擎，不是首期依赖或交付项。
- 参考 AstrBotX 实现有界会话队列、跨会话并发、执行环境、图片/文件与流式输出、长期记忆、混合检索知识库、主动多 Agent 和 IM 适配。音频、语音不在本期范围。
- **BREAKING**：新增普通干员态、资深干员态、高级资深干员态，表示当前发送者在当前会话中一次执行的有效权限；服务端校验切换，子任务不得超过父任务权限。
- 指令以 TypeScript 代码声明名称、类型化参数、执行和结构化回复；首版不提供用户编写指令的 UI。
- **BREAKING**：首版只提供一套系统内置路由流程。流程可视化、节点参数可编辑；拓扑和连接固定，不提供自由增删节点、连线或自定义流程。正常对话最终选择并执行一个明确 Agent。
- Dashboard 保留当前米白/暖金色、字体、布局、Logo 和组件视觉；新增流程视图沿用现有设计。
- 强类型作为交付门禁：严格编译、运行时边界校验、共享契约和穷尽分支；禁止 `any`、不安全类型断言和通过关闭检查绕过类型错误。

## Capabilities

### New Capabilities
- `typescript-agent-runtime`: TypeScript 工程、共享契约、独立 Agent、事件和迁移交付。
- `agents-sdk-engine`: Agents SDK 适配、类型化本地工具、会话与流式控制，以及未来引擎扩展边界。
- `operator-turn-state`: 三种运行态、服务端授权、会话与子任务权限传播。
- `typed-command-definition`: 名称、参数、执行和回复的代码抽象。
- `fixed-route-flow`: 单一固定拓扑、节点配置、校验、模拟、发布和追踪。
- `agent-execution-services`: 执行环境、Skills/MCP、长期记忆和媒体处理。
- `message-processing`: AstrBotX 风格消息元信息、引用/群历史、发言人切换与平台回复格式。

### Modified Capabilities
- `agent-im-runtime`: 配置升级、独立 Agent、固定流程路由和有备份的显式迁移。
- `command-permission-controls`: 从旧角色组转为本轮运行态和能力校验。
- `platform-abstraction`: 强类型适配契约、图片/文件、流式降级和可靠回复。
- `dashboard-frontend`: Vue/TypeScript 契约、现有视觉保持、固定流程节点编辑。
- `knowledge-rag`: 增加文档导入、向量与稀疏混合检索、可选重排和删除一致性。
- `sub-agent-orchestration`: 独立 Agent 下的路由与受权限约束的主动委派。

## Impact

涉及服务端、Dashboard API、配置与数据迁移、运行权限、工具和平台适配、打包与 CI。新实现直接位于仓库根目录，现有 `dashboard/` 接入共享 TypeScript 契约；不要求改变前端框架。

本提案取代 `rewrite-rust-agent-runtime` 作为后续目标技术方向，其实现与验收记录仅作为可迁移证据，不自动标记为 TypeScript 已完成；旧 Kotlin/JNI 已按用户于 2026-10-30 的要求归档至 `archive/kotlin/`。旧语言插件不能直接加载。首批保持 Telegram、NapCat、微信 iLink，其他 AstrBotX 平台按清单分批验收。

用户于 2026-10-25 明确：agentflow 仅指节点连线式展示；首版只有一套固定路由且节点可编辑；运行态按发送者在当前会话中的有效权限设计。用户随后确认先使用 Agents SDK，保留当前 Agent 概念，后续可能扩展 Codex SDK。SDK 能力差异须在实施前期验证，具体能力矩阵为设计建议。
