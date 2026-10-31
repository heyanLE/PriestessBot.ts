# dashboard — 管理面板前端

基于 Vue 3.4 + Vite 6 + TypeScript + Pinia 从零搭建，不依赖第三方 UI 框架。

## 技术栈

Vue 3 Composition API（`<script setup>`）、Vue Router 4、Pinia 状态管理、ofetch HTTP 请求、ECharts 图表、原生 WebSocket。

## 布局

`AppLayout` 提供统一的侧边导航栏和顶部栏，`Sidebar` 展示模块入口，`TopBar` 显示系统状态。

## 页面（7 个）

### DashboardView — 概览

展示系统运行概览：平台状态卡片、在线 Provider 数量、今日消息吞吐量折线图、错误计数、最近消息实时流（WebSocket 推送）。

### PlatformView — IM 平台管理

平台列表展示，每个平台卡片显示状态指示灯（运行中/已停止/异常）、配置摘要。支持启停操作和配置编辑弹窗。支持添加新的平台实例。

### ProviderView — LLM Provider 管理

Provider 列表展示，每个 Provider 显示类型、状态、模型列表。支持连通性测试（一键调用 /models 接口验证）。支持配置编辑。

### AgentView — Agent 配置 + 测试

配置区：Agent 名称、System Prompt 编辑器、LLM 和模型下拉选择、最大步数、工具多选（内置工具 + MCP 工具）。

测试区：内嵌对话窗口 `ChatWindow`，显示用户消息气泡、Bot 回答气泡、Tool Call 卡片。支持输入消息实时测试 Agent 运行效果。

### ToolView — Tool / MCP 管理

左侧列出所有内置工具及启用状态。右侧管理 MCP Server 列表，每个 Server 显示连接状态、传输协议，支持断开和重连操作，支持添加新的 MCP Server。

### ConversationView — 会话查看

历史会话列表，可按平台和时间筛选。点击进入会话详情，展示完整消息历史（用户消息、Bot 回答、Tool 调用记录）。

### LogView — 实时日志

通过 WebSocket 接收实时日志流，支持日志级别过滤、暂停/恢复、清空、导出。日志条目含时间、级别、模块名、内容。
