# 路由记录与 Agent 审计

## 两条记录链

- 路由记录：每条进入系统的消息均记录平台、群/私聊、会话与消息 ID、配置版本、准入/授权/路由决策及原因。结果分为 Agent、指令、忽略、拒绝、追加消息。记录总体路由耗时；节点 path 是决策路径，不伪装成逐节点实测耗时。
- Agent 记录：实际进入 Agent 执行阶段后记录上下文准备、模型调用、工具调用、回复、审批、用量、投递和结束状态。指令处理与未触发消息不混入 Agent 列表。
- 根任务用 runId 关联路由；追加消息有独立路由 ID 并指向同一 runId；子任务与后台续跑保留 parentRunId。会话、路由与 Agent 详情可互相定位。

历史 flow-traces 一次性转换成标记 legacy 的路由记录。没有来源的消息 ID、输入、精确模型、时间或用量保持空值。清空会话后，审计记录仍可查，但不会恢复已删除会话或模型上下文。

## 上报与存储口径

`RunEvent` 是强类型事件流，具有 runId、turnId、sequence、timestamp。模型调用具有 callId/modelCall、模型和用途（普通调用/压缩/收尾），工具调用具有 callId、状态和输入/输出预览。开始与结束分别上报；只有实际测量到的耗时、首字时间和 usage 才填写。

模型记录表示 SDK 模型调用，不声称能观测供应商内部重试。摘要页只汇总既有 usage 事件，新 model_call 中的 usage 是单次明细，不再累加一次；父任务不重复计入 delegation 汇总，子任务可单独查看。

工具预览取模型实际收到的结果，包括已生效的工具输出截断。输入/输出默认最多 4000 字符，契约上限 8000；超过 1M 原始字符的预览整段省略。保留 originalChars/truncated/redacted 标记。隐藏配置凭据、敏感字段、Authorization/Cookie、URL 查询值和内联附件；不记录或推测隐藏思考。读取与导出时再次按当前凭据检查已有预览。

每个运行最多保留最新 2000 条事件，接口报告首尾 sequence 与缺失前缀，旧记录缺失的调用/用量显示未知。列表使用 SQLite 聚合、索引及分页，不反序列化每条任务的完整模型上下文。

事件只保存在本机数据库。没有新增向第三方上报遥测的网络请求。

## 管理 API 与导出

- `GET /api/ts/route-records`、`GET /api/ts/agent-records`：默认50、最大200条，支持offset分页以及平台、会话类型/ID、Agent、关键词、时间和状态过滤。
- `GET /api/ts/{route-records|agent-records}/:id`：记录详情，Agent id 就是 runId。
- `GET /api/ts/{route-records|agent-records}/:id/export`：带版本、导出时间、关联记录、事件与限制说明的 JSON，最多4 MB。导出操作写入管理审计日志。
- 原有 `/api/ts/runs/:id/events`、取消和审批接口保留，前端使用关联的 runId 操作。界面 `/runs` 跳转到 Agent 记录。

所有接口要求管理认证和同源检查。导出的是受限审计副本，不是凭据文件、原始附件全集或完整数据库备份。默认不生成模型撰写的审计结论，执行成功与否以实际事件和投递状态为依据。

## DeepSeek Harness 参考

参考仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，本地检查版本 `ddefc45fbc7f8e46dd73185e68295696d1297887`。

- `packages/core/session/src/types.ts`：序列事件与 turn/step/tool call/result 结构。
- `packages/core/agent-loop/src/tool-calls.ts`：通过 callId 配对实际工具输入与结果。
- `packages/client/ui-trajectory/README.md`：时间线、Input/Output/Timing 检查器与真实耗时口径。
- `packages/session-query/session-log-export/README.md`：结构化会话日志导出与父子任务关联。

PriestessBot 采用这些观测原则，并加入默认脱敏、长度上限、既有权限控制与 Vue Dashboard。没有导入参考项目运行时或无限量复制其原始日志。
