# Dashboard 完整模型请求与响应

从本次更新起，Agent 记录页按模型调用保存完整正文。打开「Agent 记录 → 一次运行 → 模型调用」，默认查看「实际发送请求」。同一个选择框可切换实际响应、SDK 输入和 SDK 输出。

正文不经过脱敏或预览截断。页面将系统指令、输入消息、人格/示例锚点、动态上下文、工具定义和参数分开显示。图片 Base64 与长文本默认折叠；展开、原始 JSON、复制和下载使用完整保存内容。消息和事件列表分批展开，不删除未显示的数据。

## 记录来源

- `provider_request`：官方 OpenAI 客户端实际传给 fetch 的请求正文，保留完整工具 schema 和图像数据。HTTP 重试分别编号。
- `provider_response`：实际响应的 UTF-8 文本，JSON 或 SSE 按读取顺序写入文件。没有 clone/tee 分支积攒整个响应。
- `sdk_request`：动态上下文等转换完成后的 SDK ModelRequest；不包括 AbortSignal 这个进程内控制对象。
- `sdk_response`：SDK 完整响应，或 `{events:[...],complete:boolean}` 格式的流事件。自定义模型没有 HTTP 正文时可使用这份数据。

认证头不属于模型正文，不进入文件。正文内的字符串保持原样，即使看起来像密钥或令牌。普通调用、上下文压缩和收尾都使用相同记录机制。仅展示服务实际返回的内容，不推测服务内部未返回的思考或动作。

连接失败、取消、SDK 放弃某次重试的响应、服务重启或保存失败，均标为未完成。已收到并保存的内容仍可查看。记录失败不会覆盖模型的正常返回结果。

## 存储与接口

原文文件位于运行数据库同目录的 `model-records/`，目录权限 0700，文件 0600。SQLite 和事件流只保存元信息。原文不进入公开附件目录、静态资源或列表响应。

接口沿用管理令牌/会话与同源校验：

- `GET /api/ts/agent-records/:runId/model-calls/:callId`：正文列表及保存状态。
- `GET /api/ts/agent-records/:runId/model-calls/:callId/:documentId`：对应正文。
- 追加 `?download=1`：下载原文。

读取校验任务、调用和文件 ID 的绑定，拒绝链接文件。正文接口固定返回纯文本、nosniff 和 no-store，不转发上游 HTML 类型到管理页面。默认只在展开模型调用后读取正文，避免大图片拖慢任务列表。

完整正文会随调用持续占用磁盘；本次没有增加自动删除策略。已取消的响应可能只有收到的部分，不能标为完整。

## 固定配置预览

「Agent → 固定提示词结构」使用与实际引擎相同的根指令拼接函数。人格和示例作为独立的 user 角色 context_anchor 展示，不再误合并进 systemPrompt。实时检索、群历史及当前消息以实际调用记录为准。

## 历史兼容

旧记录只有当时保存的预览，已省略的原文无法恢复。例如 2026-10-31 21:19:47（Asia/Shanghai）的任务 `6322caf3-e9d1-4dbe-ac4d-478aba680120`，最后一次 SDK 输入记录原始长度 5,088,236 字符，但旧审计只留了整体省略标记；新界面不会伪造这份原始请求。

实现参考当前安装的 Agents SDK 0.21.0 与 OpenAI 客户端 7.43.0。显式客户端通过 SDK provider 接入，保持模型配置和请求行为。官方说明见 [Models and providers](https://developers.openai.com/api/docs/guides/agents/models)。
