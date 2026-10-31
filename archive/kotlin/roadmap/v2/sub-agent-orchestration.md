# sub-agent-orchestration — 子 Agent 编排

支持多 Agent 协作和编排，从单 Agent 升级到多 Agent 系统。

## 核心概念

- `SubAgentOrchestrator`：主控编排器，管理多个 Agent 的注册、调用和状态
- `AgentRouter`：基于意图识别或规则，将用户请求路由到合适的 Agent
- `Handoff`：Agent 间上下文传递，一个 Agent 处理到中途可将控制权移交给另一个 Agent
- `AgentChain`：Agent 链式调用，A Agent 的输出作为 B Agent 的输入，串行处理

## 编排模式

- **路由模式**：根据用户意图自动分发到最合适的 Agent（如一个 Agent 负责搜索、另一个负责代码）
- **Handoff 模式**：Agent A 在处理中发现需要 B 的能力，主动将上下文 handoff 给 B
- **链式模式**：A → B → C 串行执行，每个 Agent 完成特定子任务
- **并行模式**：多个 Agent 同时处理不同子任务，结果聚合后输出

## 配置方式

Dashboard 提供子 Agent 编排视图，可通过流程图拖拽配置 Agent 之间的调用关系。支持 YAML/JSON 配置导出导入。
