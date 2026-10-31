# Agents SDK 与固定运行态权限

核对日期：2026-10-29。项目安装 `@openai/agents` 0.21.0。此次不升级 SDK。

## 职责划分

SDK 运行模型循环和工具调用。普瑞赛斯服务端决定调用者身份、固定运行态、可装配资源和执行权限。SDK 不会根据“普通干员”等业务名称自动建立权限。

| 机制 | 用途 | 本项目的使用方式 |
| --- | --- | --- |
| 本地 RunContext | 将可信身份与依赖传给工具代码 | 由 IM/管理端建立上下文，不从模型参数或提示词读取身份 |
| tools 列表 / isEnabled | 控制当前模型能看到的工具 | 先按工具装配、固定运行态和平台条件过滤；现有工厂已执行等价的列表过滤 |
| execute 内的授权检查 | 阻止不允许的实际操作 | 工具执行前调用 AuthorizationService.assert；校验当前授权版本、资源范围与会话身份 |
| needsApproval + RunState | 暂停并等待审批 | 对指定工具创建审批中断；恢复时重新检查授权，批准不能授予更高运行态 |
| 工具 guardrails | 校验参数或结果 | 可补充结构与业务检查，不能替代可信身份和权限判断 |

官方说明将本地上下文与模型上下文分开；本地上下文可携带认证身份和依赖，而不发送给模型。[Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)

官方审批流程使用 `needsApproval`、`interruptions` 和可恢复状态。官方也指出，针对每次工具调用的检查应放在产生副作用的工具边界。[Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)

`isEnabled` 与 `needsApproval` 的具体 TS 类型同时核对了本项目安装包 `node_modules/@openai/agents-core/dist/tool.d.ts`。目前的工具工厂在建立 `tools` 列表时过滤，再在执行时强制校验，无需仅为改写成 `isEnabled` 而增加重复机制。

## 三类“指令”

**聊天指令**：`/help`、`/stop`、`/new` 等由 CommandRegistry 分派。每个指令在代码中声明最低态和所需能力，在 execute 之前检查。它们无需先交给模型判断。

**模型工具**：读文件、执行命令、QQ群公告、MCP 工具等，通过 SDK function tool 运行。每个工具的能力要求映射到固定运行态，同时检查 Agent 是否装配、平台是否匹配、资源是否获准。

**Shell 命令文本**：`exec_command` 内的 `ls`、脚本、管道等不是独立的 SDK 工具。SDK 不会自动区分这些命令的权限。当前统一要求具备命令执行能力，并受沙箱、目录和身份限制。若以后需要区分“只读查询”和“修改系统”，应提供不同的受限工具/执行后端；不要把命令字符串黑名单作为权限边界。

当前 MCP 调用统一要求 `external.write`，因此至少需要资深干员态；具体服务与工具还必须在 Agent 中装配。不能仅凭 MCP 提供的只读提示自动降低权限。若需要让某个 MCP 查询工具向普通干员开放，应先在受信任的本地代码中声明该工具的权限映射。

本次补齐了 MCP 对 Agent 工具审批名单的处理：名单中的 MCP 工具也使用 SDK `needsApproval` 暂停，执行前的身份与资源复查仍然保留。

聊天指令不经过 SDK 模型工具循环。内置命令按 `minimumState` 和所需能力检查；原生扩展斜杠指令按其 manifest 能力和装配名称检查，当前不会读取 SDK 工具审批名单。插件可以实现自己的指令审批规则。因此，“模型工具审批”不能被理解为所有聊天指令都要经过 SDK 暂停。

本机执行模式不提供容器级隔离。固定运行态不是操作系统沙箱；需要隔离的命令应使用已配置的 Docker 执行环境。

## 当前实现证据

- `packages/core/src/commands.ts`：指令的最低运行态和能力检查。
- `packages/adapters/src/agents/tools.ts`：工具列表过滤、可信 runId 与调用去重、执行前后授权检查、逐工具审批。
- `packages/adapters/src/agents/mcp.ts`：MCP 服务和工具的资源授权，调用前复查。
- `apps/server/src/runtime.ts`：审批恢复与子 Agent 的上下文限制。
- `packages/core/src/authorization.ts`：运行态和资源授权的统一计算。

## 规则

运行态由管理员分配。用户输入不能改变运行态。提示词也不能授予权限。

固定运行态定义能力类别。Agent 装配决定具体工具、知识库、目录和执行环境。平台条件、人格限制和逐次审批继续生效。高级资深干员态不等于宿主机 root，也不自动开放未装配工具或未授权目录。

审批的作用是允许一次已经具备权限的操作继续执行。审批不能覆盖已撤销的授权、当前身份的运行态或资源范围。
