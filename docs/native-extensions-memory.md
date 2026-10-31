# 原生扩展与记忆整理

## 原生扩展

扩展属于明确安装的本地 JavaScript 模块，推荐以严格 TypeScript 编写并编译为 `.js` / `.mjs`。它们是可信宿主机代码，能够通过 Node.js API 使用宿主机权限；窄上下文和调用权限校验不构成代码沙箱。不要安装不信任的模块。没有 Python 插件兼容层，也不会下载或自动执行远程包。

示例源码：`tools/examples/echo-extension.ts`（`npm run build` 后得到 `dist/tools/examples/echo-extension.js`）。使用 `defineExtension` 导出默认对象，清单包括 `id/name/version/description/configuration/tools/commands`；工具和指令都有名称、描述、能力需求和参数定义。参数目前支持有长度限制的字符串、有限数字、布尔值，全部必填，拒绝额外键。`execute(operation, parameters, context)` 返回字符串；可选 `start()` / `stop()` 管理生命周期。运行上下文只有取消信号、配置、当前身份以及当前扩展/Agent/平台/会话/发送者专属的字符串存储。

安装流程：

1. 编译并放置模块，进入 Dashboard → 扩展 → 原生扩展。
2. 填写服务器绝对模块路径、与导出对象一致的清单和初始配置；确认信任宿主机执行。
3. 安装只保存清单和配置，默认停用，不加载模块。
4. 启用才加载模块、校验导出清单并调用启动钩子。启用状态和配置持久化，重启恢复启用模块。失败显示不含运行数据的诊断。
5. 在 Agent 的 `resources.tools` 加入对应操作名称，并确保发送者与 Agent 的能力授权满足清单要求。指令使用 `/friendly_echo_command {"text":"你好"}`。

扩展不能覆盖内置工具/指令或其他已安装扩展的操作名。工具调用前、调用结束后和每次宿主存储操作都会校验最新授权；停用立即阻止新调用并发送取消信号给在途调用。扩展须主动响应取消；原生代码不受进程级强制沙箱控制。更改已加载模块代码后应重启运行时以清空 Node.js 模块缓存，再重新启用；清单变更请以新的扩展 ID 安装。

管理 API（需管理认证）：`GET/POST /api/ts/extensions`，`PUT /api/ts/extensions/:id`，更新参数 `{enabled, expectedRevision, configuration?}`。安装参数为 `{manifest,modulePath,configuration,trustedHostAcknowledged:true}`。配置中的凭据应使用服务器环境引用，不应写入清单或普通扩展配置。

## 模型辅助记忆整理

Dashboard → 记忆 → 语义记忆整理，选择已有记忆范围，生成预览后审核来源与合并文本，再手动应用。默认不会自动修改记忆。

每次最多选择同一 Agent、库、scope、平台和对应会话/发送者范围的 30 条有效记忆，输入文本上限 16,000 字符，输出上限 2,048 token，总量上限 12,000 token，超时 60 秒。复用该 Agent 的 Agents SDK 模型连接，不使用工具，不提供模型选择范围的权限。Responses 连接使用结构化输出；Chat Completions 连接通过提示要求纯 JSON，并在宿主端执行相同的严格 schema 校验，避免向不支持的兼容服务发送 `json_schema response_format`。自动记忆提取采用相同协议分支。模型返回的每个来源 ID 必须属于本次来源且不能重复。未提到的记忆保留。

预览保存完整来源快照、SHA-256 指纹、配置版本、建议文本。应用在 SQLite 事务中检查全部来源和配置版本；任何新增编辑、删除或配置变更导致原来源失效时拒绝应用，要求重新预览。合并记录保留源 ID、原始来源、最低源置信度和最早到期时间。不跨范围合并，不提升可信度。

可对每个范围显式启用周期任务（最少 5 分钟）。默认定期生成预览；勾选自动应用后才自动提交通过相同检查的结果。同一范围不并发整理。任务支持取消，服务停止时取消并等待在途模型调用；重启将未完成任务记为中断，随后按持久化策略恢复调度。禁用策略会取消此范围当前任务。

管理 API：`GET /api/ts/memory-maintenance`，`POST /preview`（请求体为 scope），`POST /apply/:proposalId`，`POST /cancel/:jobId`，`PUT /policy`（`{policy:{scope,enabled,intervalMinutes,autoApply},expectedRevision}`）。scope 字段是 `{agentId,libraryId,scope,principal}`，principal 延续已有身份契约。
