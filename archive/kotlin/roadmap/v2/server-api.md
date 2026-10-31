# server-api — Dashboard API 服务

基于 Ktor 3.x 提供 Dashboard 前端所需的 REST API 和实时推送能力。二期新增 `priestess-server` 模块。

## Ktor 服务器

`PriestessBotServer` 初始化 HTTP 服务器，注册所有路由，托管前端静态资源。

## REST API 路由

- `ConfigRoutes`：全局配置的读写（GET / PUT），平台配置的增删改查
- `PlatformRoutes`：平台列表查询，平台启停控制（POST /start /stop），平台状态查询
- `ProviderRoutes`：Provider 列表，模型列表，连通性测试（POST /test）
- `AgentRoutes`：Agent 配置读写，对话测试接口（POST /chat，同步和流式），Agent 状态查询
- `ToolRoutes`：工具列表（内置 + MCP），工具启停开关，MCP Server 的增删和重连
- `ConversationRoutes`：会话列表查询，消息历史查询，会话删除
- `PluginRoutes`：插件列表，安装/卸载/启停（配合插件系统）

## WebSocket

`LogSocket` 提供实时日志推送，前端 `LogView` 页面通过 WebSocket 接收后端日志流。支持日志级别过滤和暂停/恢复控制。
