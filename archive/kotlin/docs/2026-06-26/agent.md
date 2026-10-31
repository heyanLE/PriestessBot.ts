# Agent 模块

日期：2026-06-26

## 代码结构

- `Agent.kt`
- `AgentContext.kt`
- `AgentRunner.kt`
- `AgentResponse.kt`
- `AgentState.kt`
- `AgentHooks.kt`
- `CompressStrategy.kt`
- `AgentCase.kt`
- `runner/ReActRunner.kt`
- `context/ContextManager.kt`
- `context/ContextCompressStrategy.kt`
- `context/RoundTruncationStrategy.kt`
- `context/TokenWindowStrategy.kt`
- `context/LLMCompressStrategy.kt`
- `context/TokenCounter.kt`
- `orchestration/SubAgentOrchestrator.kt`

## 暴露的 Case

- `AgentCase.createAgent(config)`

## 业务职责

Agent 模块负责把配置转换成可执行的 Agent 运行时对象，并承载 ReAct 执行、上下文压缩、hook 回调和子 Agent 编排。

## 结构图

```mermaid
flowchart TD
    A[AgentCase] --> B[Agent]
    B --> C[ReActRunner]
    C --> D[ContextManager]
    C --> E[ToolExecutor]
    C --> F[ChatProvider]
    C --> G[AgentHooks]
    C --> H[SubAgentOrchestrator]
```

## 流程图

```mermaid
flowchart TD
    A[创建 Agent] --> B[选择压缩策略]
    B --> C[构造 Agent]
    C --> D[Runner 进入 stepUntilDone]
    D --> E[压缩上下文]
    E --> F[请求 LLM]
    F --> G{是否有 tool call}
    G -- 是 --> H[执行工具并注入 observation]
    H --> E
    G -- 否 --> I[返回 Final]
```

