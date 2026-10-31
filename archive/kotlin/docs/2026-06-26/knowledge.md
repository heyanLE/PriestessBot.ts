# Knowledge 模块

日期：2026-06-26

## 代码结构

- `KnowledgeModels.kt`
- `KnowledgeController.kt`
- `KnowledgeCase.kt`
- `KeywordKnowledgeRetriever.kt`

## 暴露的 Case

- `KnowledgeCase.createBase(...)`
- `KnowledgeCase.listBases()`
- `KnowledgeCase.addTextDocument(...)`
- `KnowledgeCase.search(...)`

## 业务职责

Knowledge 模块提供知识库、分块、关键词检索和 Agent 可调用的知识查询能力。

## 结构图

```mermaid
flowchart TD
    A[KnowledgeCase] --> B[KnowledgeController]
    B --> C[KnowledgeBase]
    B --> D[KnowledgeChunk]
    A --> E[KeywordKnowledgeRetriever]
```

## 流程图

```mermaid
flowchart TD
    A[写入文本] --> B[分块]
    B --> C[保存 chunk]
    D[查询] --> E[拉取 chunk]
    E --> F[关键词检索]
    F --> G[返回结果]
```

