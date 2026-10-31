# Conversation 模块

日期：2026-06-26

## 代码结构

- `Conversation.kt`
- `ConversationController.kt`
- `ConversationCase.kt`
- `MessageHistory.kt`

## 暴露的 Case

- `ConversationCase.getOrCreate(...)`
- `ConversationCase.updateActivity(...)`
- `ConversationCase.getRecentMessages(...)`
- `ConversationCase.getAll()`
- `ConversationCase.getMessages(...)`
- `ConversationCase.searchMessages(...)`
- `ConversationCase.storeMessage(...)`

## 业务职责

Conversation 模块负责会话实体、消息历史、消息检索和活动时间维护，是消息流和 Agent 上下文的重要数据入口。

## 结构图

```mermaid
flowchart TD
    A[ConversationCase] --> B[ConversationController]
    A --> C[MessageHistory]
    B --> D[Conversation]
    C --> E[StoredMessage]
```

## 流程图

```mermaid
flowchart TD
    A[平台消息进入] --> B[定位 conversation]
    B --> C[更新 activity]
    C --> D[读取历史消息]
    D --> E[写入当前消息与 tool 消息]
```

