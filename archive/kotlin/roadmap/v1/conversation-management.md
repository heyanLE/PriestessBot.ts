# conversation-management — 会话管理

提供对话会话和消息历史的持久化存储和管理。

## 核心功能

- `ConversationManager`：会话 CRUD（创建、查询、更新、删除），支持按平台、用户维度查找会话
- 会话过期清理：自动清理超过一定时间未活跃的会话
- 会话元数据存储：记录会话的创建时间、最后活跃时间、消息计数等
- `MessageHistory`：消息历史存储，持久化对话消息，支持分页查询和按时间范围检索
- 消息回滚：支持回退到某个时间点的对话状态，用于 Agent 重试

## 存储方案

使用 Exposed ORM + SQLite 持久化，会话和消息分表存储。消息支持存储角色（system/user/assistant/tool）、文本内容、关联的 Tool Call 与结果。
