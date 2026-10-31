# tool-mcp — Tool / MCP 体系

提供 LLM 可调用的工具系统，支持内置工具和 MCP 协议接入。

## 核心抽象

- `ToolSchema`：JSON Schema 定义工具的名称、描述、参数结构，使用 `@Tool` 注解声明
- `FunctionTool`：抽象基类，工具实例需要实现 `execute()` 方法，接收 Agent 上下文和参数 Map，返回 `ToolResult`
- `ToolSet`：工具集管理，支持添加/移除工具，提供 `toOpenAIFormat()` / `toAnthropicFormat()` / `toGeminiFormat()` 格式转换，适配不同 LLM 的工具调用格式
- `ToolExecutor`：工具调用执行器，负责解析 LLM 返回的 Tool Call 参数、找到对应 FunctionTool、执行并返回结果
- `ToolRegistry`：通过注解收集所有内置和 MCP 注册的工具

## MCP 协议支持

一期完整支持三种传输方式：

- `McpTransport`：传输层抽象接口，定义 `connect()` / `send()` / `receive()` / `disconnect()`
- `StdioTransport`：启动子进程，通过 stdin/stdout 通信，异常退出后自动重启子进程
- `SseTransport`：HTTP GET 建立 SSE 长连接，断连后指数退避重连
- `StreamableHttpTransport`：HTTP POST 请求-响应模式，超时后重试
- `McpClient`：MCP 客户端，根据 `McpConfig` 选择传输方式，统一管理连接生命周期和自动重连
- `McpTool`：将 MCP Server 暴露的 Tool 包装为 `FunctionTool`，对 Agent 透明
- `McpConfig`：MCP 连接配置（名称、传输协议类型、连接参数如 command/args/url 等）

## 内置工具（4 个）

- `WebSearchTool`：联网搜索，调用搜索引擎 API 获取最新信息
- `EarlyReplyTool`：提前回答工具，Agent 循环执行中如需长时间处理，可提前调用此工具给用户发送"请稍候"等消息，再继续后台处理
- `SendMessageTool`：主动消息推送，允许 Agent 在 Loop 中主动向用户发送消息（需要 Platform 支持 proactive message）
- `SystemInfoTool`：系统状态查询，返回当前运行状态、Agent 信息、工具列表等
