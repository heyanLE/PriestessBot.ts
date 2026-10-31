# external-runner — 第三方 Agent Runner

桥接第三方 AI Agent 平台，复用其状态机和能力。

## ExternalRunner 接口

`ExternalRunner` 扩展 `AgentRunner` 接口，增加平台适配能力：
- 标准化外部 Agent 平台的输入映射（消息格式转换）
- 标准化输出映射（响应格式转换到统一的 `AgentResponse`）
- 流式响应适配（第三方流式 → priestess Flow）
- Tool Call 双向转换（第三方工具格式 ↔ priestess ToolSet 格式）

## 计划接入的平台

- `DifyRunner`：桥接 Dify 平台，复用其工作流和知识库
- `CozeRunner`：桥接 Coze 平台（字节跳动 Agent 平台）
- `CustomRunner`：自定义状态机接入点，允许通过配置定义状态迁移规则

## 使用场景

- 已有成熟的 Dify 工作流，不想重写为 ReAct
- 需要利用特定平台的插件生态（如 Dify 的工具市场）
- 自定义状态机无法用 ReAct 表达（如多轮确认流程）
