# OpenAI Agents SDK 选型与验证依据

日期：2026-10-25。用户已确认先使用 Agents SDK，保留项目 Agent 概念，未来可能扩展 Codex SDK。

## 官方依据

- [Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk)：SDK 在应用内执行 Agent 循环；应用控制部署、工具实现、存储和审批决策。
- [Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)：Agent 配置模型、指令、工具、MCP、handoff 等；本地 context 可以给工具传递应用状态，不自动发送给模型。
- [Running agents](https://developers.openai.com/api/docs/guides/agents/running-agents)：提供模型/工具循环、会话续接、流式以及暂停恢复；每个会话应选择一种一致的历史续接策略。
- [Sandbox Agents](https://developers.openai.com/api/docs/guides/agents/sandboxes)：沙箱执行可以与 SDK Agent 组合；具体隔离和后端生命周期仍须应用配置和验证。

实施结果：已固定 @openai/agents 0.21.0、zod 4.6.7、TypeScript 5.9.3、Node 22.22.2。已执行真实官方 SDK 的 mock Model/工具/流式/Session/RunState/取消/委派测试、真实 MCP HTTP 往返及取消，并用现有 DeepSeek 调试连接验证 memory_save 工具往返。Codex SDK 的旧结果未计入这些验证。

声明修补：agents-core 0.21.0 的 RunResultData.agentToolInvocation 可选字段与实际 getter 在 exactOptionalPropertyTypes 下不一致；tools/patch-sdk-types.ts 仅将声明补为允许 undefined，保留 skipLibCheck:false。该脚本也恢复 node-pty 发布包 spawn-helper 的可执行权限；macOS 和 Linux 发行验收均已通过。

## 本项目边界

| 对象 | 权威归属 |
|---|---|
| AgentDefinition、Agent ID、资源装配、模型选择 | 本项目领域层 |
| RunContext、三态、principal、资源授权、预算 | 本项目；通过可信本地 context 传入工具 |
| SDK Agent、Runner、SDK 事件/结果和暂停状态格式 | AgentsSdkEngine 适配器内部 |
| 业务会话历史和长期记忆 | 本项目持久层；SDK Session 适配历史，MemoryService 管理长期记忆 |
| 队列、去重、重置、流式投递、固定路由 | 本项目核心服务 |
| 本地工具执行 | SDK schema/execute 对接统一 ToolExecutor；不强制通过 MCP 绕行 |
| 外部 MCP | SDK/客户端适配器连接，仍执行当前轮次授权检查 |
| 主动子 Agent | DelegationService 控制权限和预算，内部适配 SDK 子运行 |

领域、API、数据库与 Dashboard 不得导入 SDK 类类型。持久化 session/run state 带 engine ID 和版本；未来增加 CodexSdkEngine 不意味着状态可跨 SDK 互相恢复。

## 首期验证门禁

1. 锁定 SDK、Node、TypeScript、schema、模型 provider 与 MCP 依赖，干净安装通过严格编译。
2. 验证类型化工具、可信 context、拒绝权限、结构化结果和取消；防止参数伪造 principal/state。
3. 验证持久 Session、暂停/恢复、重置和迟到结果；避免同时 replay 本地历史和复用服务端 conversation 导致重复上下文。
4. 验证图片/文件与真实流式事件，声明所选模型和适配器实际能力，不沿用 Codex 的 local_image/Thread 类型。
5. 验证子运行预算、权限上限和取消；Agent-as-tool 的返回父任务语义与 handoff 的控制权切换必须区分。
6. 明确 SDK tracing 的导出目标和输入/输出采集策略，保持本地追踪脱敏和授权数据范围。

Codex SDK 不属于首期依赖、打包或实现任务。既有静态调查保存于 [codex-sdk-reference.md](codex-sdk-reference.md)，未来接入时须重新检查所选发布版本。
