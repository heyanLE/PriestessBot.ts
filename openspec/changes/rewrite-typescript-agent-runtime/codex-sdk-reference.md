# 未来扩展参考：官方 Codex SDK 能力核对

2026-10-25 决策更新：首期使用 OpenAI Agents SDK，本文只保留先前的 Codex SDK 静态调查。下文的接入计划是当时的候选方案，不是当前首期要求，也不计入 Agents SDK 实现或验证进度。当前方案见 design.md 和 sdk-evidence.md。

核对日期：2026-10-25。此文件记录静态证据，不代表真实模型或 IM 验收通过。

## 来源与版本

- 官方说明：https://learn.chatgpt.com/docs/codex-sdk
- 官方集成边界：https://developers.openai.com/blog/codex-as-a-platform
- npm 包：`@openai/codex-sdk@0.164.0`，本次 registry 查询返回该版本。
- 包中运行时依赖：`@openai/codex: 0.164.0`。
- 发布包 SHA-1：`11e628a0dcd9b0d0bbe823c2b540c33c585a6c6b`。
- 发布包 integrity：`sha512-FyhTWM4Xa8hXpWhkr9MOvROVhBqTeD+s/XCzVLzqSQXTSnGSNkdBWjv0IzZdOO29BX4LwtMjul6ogB8tOME5og==`。
- 检查对象：发布包 `package.json`、`dist/index.d.ts`、`dist/index.js`，下载时使用 `--ignore-scripts`，未执行模型调用。
- 仓库 `.research/` 的旧 SDK 快照、`codex_for_astrbot` 的 fork 源码不是这次官方 SDK 的能力证明。

## 已确认的公开接口

| 能力 | 静态证据 | 交付要求 |
|---|---|---|
| 新会话与恢复 | `Codex.startThread` / `resumeThread` | 持久化 thread ID；验证真正跨进程恢复 |
| 连续轮次 | `Thread.run` | 同一 thread 顺序调用，宿主负责排队 |
| 事件流 | `Thread.runStreamed` 返回 `AsyncGenerator<ThreadEvent>` | 验证 agent_message 的更新频度，不将事件流等同逐 token 流 |
| 取消 | `TurnOptions.signal: AbortSignal`，传入子进程 spawn | 验证取消后的子进程、MCP 调用和后台作业清理 |
| 图片输入 | `UserInput` 是 text / local_image 联合 | 下载并校验媒体后传授权本地文件；文件输入需宿主准备 |
| 配置与环境 | `CodexOptions.config/configOverrides/env` | 构造服务端白名单配置，固定依赖版本和凭据来源 |
| 沙箱与审批策略 | ThreadOptions 有 sandboxMode、approvalPolicy | 这是配置参数，不能当作应用内审批回调接口 |
| MCP 调用事件 | `McpToolCallItem` | 只能证明事件类型存在；宿主 MCP 桥接需独立验证 |

## 明确的接口边界

发布包实现通过子进程执行 `codex exec --experimental-json`，写入本轮输入后关闭 stdin。公开 Thread 类只有 id、run、runStreamed，未暴露 steer、动态工具回调注册或审批响应方法，也未提供 AstrBotX fork 的 additional_context/scopes 接口。

因此当前计划采用：

1. 同会话有界排队、跨会话并发、取消走 AbortSignal；同人追加先进入下一轮，不能宣称是真正运行中 steer。
2. 自定义业务工具通过宿主 MCP 服务暴露；授权在工具实际执行处校验。连接配置、结构化图片结果、恢复后的凭据更新是 P0 实验门禁。
3. 人格、记忆、检索结果由宿主构造有来源的本轮上下文，不因召回内容变化重新建 thread；缓存成本与上下文压缩效果需测量。
4. 原生 shell/文件能力必须受实际 OS/容器隔离和 SDK 支持的策略约束；无法证明满足当前运行态时关闭相关能力。不得以 `danger-full-access` 绕过桥接缺口。
5. code mode、原生记忆提取和交互式审批均不属于当前已验证交付能力；新版本若支持，只能在版本锁定、测试通过后改变能力声明。
6. 如后续明确要求 SDK 不能提供的能力，单独报告产品行为差异；不得静默改用 app-server、fork 或私有方法。

## 依赖打包检查

发布包的类型文件引用 `@modelcontextprotocol/sdk/types.js`，但该包在其 package.json 中只出现在 devDependencies。首个严格编译 smoke 必须检查干净安装下的类型解析，并明确安装所需 MCP 依赖；不得用 `skipLibCheck` 或 `any` 掩盖问题。

本次没有运行官方 SDK 的真实 turn、MCP bridge 或取消测试，以上运行效果仍待实施阶段验证。
