# agent-loop — Agent 循环

实现 Agent 运行时，管理 LLM 推理与工具调用的循环执行。

## 运行隔离

每个 `AgentRunner` 实例只服务于一条消息链。ProcessStage 收到消息事件后创建新的 Runner 实例，执行完成后即销毁。不同消息链之间完全隔离，互不冲突。

## 核心抽象

- `Agent`：数据类，定义 Agent 的名称、System Prompt（instructions）、关联的工具列表
- `AgentRunner`：运行器接口，定义 `reset()` 重置状态、`step()` 单步执行、`stepUntilDone()` 循环执行直到完成、`isDone()` 判断是否结束。每个实例绑定一条消息链，线程安全无需考虑并发
- `AgentState`：状态机，IDLE → RUNNING → DONE / ERROR
- `AgentHooks`：生命周期钩子，含 `onAgentBegin` / `onToolStart` / `onToolEnd` / `onAgentDone`，用于日志记录和监控
- `AgentContext`：运行上下文，包含对话消息历史、Agent 配置、工具超时、当前 Platform 和 MessageSession 引用等参数
- `AgentResponse`：密封类，Thinking（LLM 思考内容）、ToolResult（工具调用结果）、Final（最终回答）、Error。一期不做流式，StreamChunk 预留给二期

## ReActRunner（唯一内置实现）

`ReActRunner` 实现 Thought → Action → Observation 循环：

1. 检查上下文是否需要压缩，超过阈值则调用 ContextCompressor
2. 调用 LLM ChatProvider 传入消息历史和工具定义，**内部积累完整响应**（不做流式转发，流式响应预留给二期）
3. 如果响应包含 Tool Call → 通过 ToolExecutor 执行工具 → 返回 Observation，回到第 2 步继续循环
4. 如果响应不包含 Tool Call → 视为最终回答，返回 Final
5. 达到 maxSteps 上限 → 返回 Error

## 上下文管理

`ContextManager` 管理对话消息窗口，`TokenCounter` 估算 Token 数量。上下文压缩采用可配置的策略模式，接口预埋方便扩展：

### 压缩策略（通过配置切换）

- `RoundTruncationStrategy`：按轮次截断，只保留最近 N 轮对话，最早的消息直接丢弃
- `TokenWindowStrategy`：按 Token 数截断，超出窗口上限的消息从最早开始丢弃
- `LLMCompressStrategy`：调用 LLM 对历史消息做摘要压缩，将压缩后的摘要作为 context 注入（一期实现前两种，LLM 压缩接口预埋）

### 扩展接口

```kotlin
interface ContextCompressStrategy {
    suspend fun compress(messages: List<ConversationMessage>, maxTokens: Int): List<ConversationMessage>
}
```

`AgentConfig` 中增加 `compressStrategy` 配置项，支持运行时切换压缩策略。
